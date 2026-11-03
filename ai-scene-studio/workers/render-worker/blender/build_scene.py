"""Construit une scène Blender depuis une description AI Scene Studio, l'enregistre et/ou la rend.

Exécuté par Blender 4.5 LTS (`blender -b --factory-startup --python build_scene.py -- …`). Ce script
est un générateur interne : il ne lit que la description produite par `ass_api.render.prepare` et
n'exécute jamais de code fourni par un utilisateur.

Repère : la scène canonique est en Y vers le haut (glTF). Tout est placé sous un objet racine tourné
de +90° autour de X : à l'intérieur, les transformations canoniques s'appliquent telles quelles et
l'ensemble apparaît en Z vers le haut dans Blender. Caméras et lumières regardent -Z local dans
les deux conventions : aucune correction individuelle n'est nécessaire.

Sorties : `exr/frame_####.exr` (OpenEXR multicouche : beauty RGBA, profondeur, normales, index
d'objet, cryptomatte, vecteurs), `png/frame_####.png` (beauty affichable), `scene.blend`.
Progression : une ligne `ASS_FRAME <n>` par frame rendue sur la sortie standard.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

ROOT_NAME = "AI Scene Studio (repère glTF, Y vers le haut)"
PROBE_KIND = {"node": "nodes", "camera": "cameras", "light": "lights"}
EASING = {"ease_in": "EASE_IN", "ease_out": "EASE_OUT", "ease_in_out": "EASE_IN_OUT"}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--description", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--blend")
    parser.add_argument("--render", action="store_true")
    parser.add_argument("--probe", help="frames séparées par des virgules ; écrit probe.json")
    return parser.parse_args(argv)


# --- Courbes d'animation ---------------------------------------------------------------------


def find_fcurve(id_data, path: str, index: int):
    action = id_data.animation_data.action
    if hasattr(action, "fcurves"):
        return action.fcurves.find(path, index=index)
    slot = id_data.animation_data.action_slot
    for layer in action.layers:
        for strip in layer.strips:
            bag = strip.channelbag(slot)
            if bag is not None:
                found = bag.fcurves.find(path, index=index)
                if found is not None:
                    return found
    return None


def as_list(value) -> list[float]:
    if isinstance(value, bool):
        return [1.0 if value else 0.0]
    if isinstance(value, int | float):
        return [float(value)]
    return [float(v) for v in value]


def native_curve(owner, prop: str, id_data, path: str, track: dict, convert=None) -> None:
    """Clés natives avec interpolation, poignées et extrapolation exactes (voir prepare.py)."""
    keys = track["keyframes"]
    factor = track["factor"]
    convert = convert or (lambda values: values)
    values = [convert([v * factor for v in as_list(k["value"])]) for k in keys]
    components = len(values[0])
    for key, value in zip(keys, values, strict=True):
        current = getattr(owner, prop)
        if components == 1 and not hasattr(current, "__len__"):
            setattr(owner, prop, type(current)(value[0]))
        else:
            setattr(owner, prop, value)
        owner.keyframe_insert(prop, frame=key["frame"])
    for index in range(components):
        fcurve = find_fcurve(id_data, path, index if components > 1 else 0)
        if fcurve is None:
            continue
        points = sorted(fcurve.keyframe_points, key=lambda p: p.co[0])
        for i, (key, point) in enumerate(zip(keys, points, strict=True)):
            interpolation = key["interpolation"]
            last = i == len(keys) - 1
            if interpolation == "step":
                point.interpolation = "CONSTANT"
            elif interpolation in EASING:
                point.interpolation = "CUBIC"
                point.easing = EASING[interpolation]
            elif interpolation == "bezier" and not last:
                point.interpolation = "BEZIER"
            else:
                # Dernière clé : rien à interpoler ; LINEAR évite l'extrapolation par poignée.
                point.interpolation = "LINEAR"
            point.handle_left_type = "FREE"
            point.handle_right_type = "FREE"
        for i in range(len(keys) - 1):
            a, b = keys[i], keys[i + 1]
            pa, pb = points[i], points[i + 1]
            va, vb = values[i][index], values[i + 1][index]
            span = b["frame"] - a["frame"]
            out, inn = a["outHandle"], b["inHandle"]
            if out:
                dx = max(out["frameOffset"], 0.0)
                dy = out["valueOffset"][index] * factor if out["frameOffset"] >= 0 else 0.0
            else:
                dx, dy = span / 3, (vb - va) / 3
            pa.handle_right = (a["frame"] + dx, va + dy)
            if inn:
                dx = max(-inn["frameOffset"], 0.0)
                dy = inn["valueOffset"][index] * factor if inn["frameOffset"] <= 0 else 0.0
            else:
                dx, dy = span / 3, (va - vb) / 3
            pb.handle_left = (b["frame"] - dx, vb + dy)
        if track["extrapolation"] == "cycle":
            fcurve.modifiers.new("CYCLES")
        else:
            fcurve.extrapolation = "LINEAR" if track["extrapolation"] == "linear" else "CONSTANT"


def sampled_curve(owner, prop: str, samples: dict, convert=None) -> None:
    """Une clé par frame, interpolation linéaire (rotations, valeurs sans équivalent natif)."""
    convert = convert or (lambda value: value)
    for frame, value in samples.items():
        setattr(owner, prop, convert(value))
        owner.keyframe_insert(prop, frame=int(frame))


def visibility_curve(obj, track: dict) -> None:
    for key in track["keyframes"]:
        hidden = not key["value"]
        obj.hide_render = hidden
        obj.hide_viewport = hidden
        obj.keyframe_insert("hide_render", frame=key["frame"])
        obj.keyframe_insert("hide_viewport", frame=key["frame"])
    for path in ("hide_render", "hide_viewport"):
        fcurve = find_fcurve(obj, path, 0)
        for point in fcurve.keyframe_points:
            point.interpolation = "CONSTANT"
        if track["extrapolation"] == "cycle":
            fcurve.modifiers.new("CYCLES")


def quaternion_wxyz(q) -> tuple[float, float, float, float]:
    x, y, z, w = q
    return (w, x, y, z)


def apply_transform(obj, transform: dict) -> None:
    obj.rotation_mode = "QUATERNION"
    obj.location = transform["position"]
    obj.rotation_quaternion = quaternion_wxyz(transform["rotation"])
    obj.scale = transform["scale"]


def animate_object(obj, animation: dict) -> None:
    native = animation["native"]
    if "location" in native:
        native_curve(obj, "location", obj, "location", native["location"])
    if "scale" in native:
        native_curve(obj, "scale", obj, "scale", native["scale"])
    if "visible" in native:
        visibility_curve(obj, native["visible"])
    sampled = animation["sampled"]
    if "location" in sampled:
        sampled_curve(obj, "location", sampled["location"])
    if "scale" in sampled:
        sampled_curve(obj, "scale", sampled["scale"])
    if "rotation" in sampled:
        sampled_curve(obj, "rotation_quaternion", sampled["rotation"], quaternion_wxyz)


# --- Construction ------------------------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def make_material(name: str, spec: dict | None):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if spec is None:
        bsdf.inputs["Base Color"].default_value = (0.6, 0.6, 0.6, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.6
        return material
    bsdf.inputs["Base Color"].default_value = (*spec["baseColor"], 1.0)
    bsdf.inputs["Metallic"].default_value = spec["metallic"]
    bsdf.inputs["Roughness"].default_value = spec["roughness"]
    bsdf.inputs["Emission Color"].default_value = (*spec["emissive"], 1.0)
    bsdf.inputs["Emission Strength"].default_value = spec["emissiveStrength"]
    bsdf.inputs["Alpha"].default_value = spec["opacity"]
    return material


def primitive_mesh(kind: str, name: str):
    """Géométries unitaires de SCENE_SCHEMA.md, axe principal +Y (repère canonique)."""
    ops = {
        "cube": lambda: bpy.ops.mesh.primitive_cube_add(size=1),
        "sphere": lambda: bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.5, segments=48, ring_count=24
        ),
        "cylinder": lambda: bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=1, vertices=48),
        "cone": lambda: bpy.ops.mesh.primitive_cone_add(
            radius1=0.5, radius2=0, depth=1, vertices=48
        ),
        "plane": lambda: bpy.ops.mesh.primitive_plane_add(size=1),
        "torus": lambda: bpy.ops.mesh.primitive_torus_add(
            major_radius=0.5, minor_radius=0.125, major_segments=64, minor_segments=24
        ),
    }
    ops[kind]()
    temporary = bpy.context.active_object
    mesh = temporary.data
    mesh.name = name
    # Axe Z de Blender vers l'axe +Y canonique : rotation de -90° des sommets autour de X.
    mesh.transform(Matrix.Rotation(-math.pi / 2, 4, "X"))
    if kind in ("sphere", "cylinder", "cone", "torus"):
        mesh.shade_smooth()
    bpy.data.objects.remove(temporary)
    return mesh


def import_model(path: str, holder, name: str) -> None:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    # L'importeur convertit Y-up → Z-up ; on annule cette conversion sous la racine canonique.
    compensation = bpy.data.objects.new(f"{name} (compensation glTF)", None)
    bpy.context.scene.collection.objects.link(compensation)
    compensation.parent = holder
    compensation.rotation_euler = (-math.pi / 2, 0, 0)
    for obj in imported:
        if obj.parent is None:
            obj.parent = compensation


def build(description: dict):
    scene = reset_scene()
    collection = scene.collection
    root = bpy.data.objects.new(ROOT_NAME, None)
    collection.objects.link(root)
    root.rotation_euler = (math.pi / 2, 0, 0)
    objects: dict[str, object] = {}
    pending_parents: list[tuple[object, str | None]] = []

    for node in description["nodes"]:
        if node["type"] == "primitive":
            mesh = primitive_mesh(node["primitive"], node["name"])
            mesh.materials.append(make_material(f"{node['name']} — matériau", node["material"]))
            obj = bpy.data.objects.new(node["name"], mesh)
        else:
            obj = bpy.data.objects.new(node["name"], None)
            obj.empty_display_size = 0.5
        collection.objects.link(obj)
        apply_transform(obj, node["transform"])
        obj.hide_render = not node["visible"] or not node["rendered"]
        obj.hide_viewport = not node["visible"]
        obj.visible_shadow = node["castShadow"]
        obj.pass_index = node["passIndex"]
        obj["ass_id"] = node["id"]
        objects[node["id"]] = obj
        pending_parents.append((obj, node["parentId"]))
        if node["type"] == "model" and node["modelPath"]:
            import_model(node["modelPath"], obj, node["name"])
            if node["material"]:
                material = make_material(f"{node['name']} — matériau", node["material"])
                for child in obj.children_recursive:
                    if child.type == "MESH":
                        child.data.materials.clear()
                        child.data.materials.append(material)
            for child in obj.children_recursive:
                child.pass_index = node["passIndex"]
                child.visible_shadow = node["castShadow"]
                child.hide_render = obj.hide_render

    for camera in description["cameras"]:
        data = bpy.data.cameras.new(camera["name"])
        data.sensor_fit = "HORIZONTAL"
        data.sensor_width = camera["sensorWidthMm"]
        data.sensor_height = camera["sensorHeightMm"]
        data.lens = camera["focalLengthMm"]
        data.clip_start = camera["nearClip"]
        data.clip_end = camera["farClip"]
        if camera["projection"] == "orthographic":
            data.type = "ORTHO"
            data.ortho_scale = camera["orthoScale"]
        data.dof.use_dof = camera["focusDistance"] is not None
        data.dof.focus_distance = camera["focusDistance"] or 10.0
        data.dof.aperture_fstop = camera["aperture"]
        obj = bpy.data.objects.new(camera["name"], data)
        collection.objects.link(obj)
        apply_transform(obj, camera["transform"])
        obj["ass_id"] = camera["id"]
        objects[camera["id"]] = obj
        pending_parents.append((obj, camera["parentId"]))
        native = camera["animation"]["native"]
        if "lens" in native:
            native_curve(data, "lens", data, "lens", native["lens"])
        if "fstop" in native:
            native_curve(data.dof, "aperture_fstop", data, "dof.aperture_fstop", native["fstop"])
        if "focus_distance" in native:
            native_curve(
                data.dof, "focus_distance", data, "dof.focus_distance", native["focus_distance"]
            )
        animate_object(obj, camera["animation"])

    kinds = {"directional": "SUN", "point": "POINT", "spot": "SPOT"}
    for light in description["lights"]:
        data = bpy.data.lights.new(light["name"], kinds[light["kind"]])
        data.color = light["color"]
        data.energy = light["energy"]
        data.use_shadow = light["castShadow"]
        # Lumières ponctuelles glTF : source infiniment petite (comme l'importeur glTF de Blender).
        if light["kind"] == "directional":
            data.angle = 0.0
        else:
            data.shadow_soft_size = 0.0
        if light["kind"] == "spot":
            data.spot_size = 2 * light["outerConeAngle"]
            data.spot_blend = 1 - light["innerConeAngle"] / light["outerConeAngle"]
        obj = bpy.data.objects.new(light["name"], data)
        collection.objects.link(obj)
        apply_transform(obj, light["transform"])
        obj.hide_render = not light["visible"]
        obj.hide_viewport = not light["visible"]
        obj["ass_id"] = light["id"]
        objects[light["id"]] = obj
        pending_parents.append((obj, light["parentId"]))
        native = light["animation"]["native"]
        if "energy" in native:
            native_curve(data, "energy", data, "energy", native["energy"])
        if "color" in native:
            native_curve(data, "color", data, "color", native["color"])
        animate_object(obj, light["animation"])

    for obj, parent_id in pending_parents:
        obj.parent = objects[parent_id] if parent_id else root
    for node in description["nodes"]:
        animate_object(objects[node["id"]], node["animation"])
        alpha = node["animation"]["native"].get("alpha")
        if alpha and objects[node["id"]].type == "MESH":
            bsdf = objects[node["id"]].data.materials[0].node_tree.nodes["Principled BSDF"]
            native_curve(
                bsdf.inputs["Alpha"],
                "default_value",
                objects[node["id"]].data.materials[0].node_tree,
                'nodes["Principled BSDF"].inputs[4].default_value',
                alpha,
            )

    if description["activeCameraId"] in objects:
        scene.camera = objects[description["activeCameraId"]]
    configure_render(scene, description)
    return scene, objects, root


def configure_render(scene, description: dict) -> None:
    render = description["render"]
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = render["samples"]
    scene.cycles.seed = 0
    scene.cycles.use_denoising = False
    scene.render.resolution_x = render["width"]
    scene.render.resolution_y = render["height"]
    scene.render.resolution_percentage = render["resolutionPercent"]
    scene.render.fps = description["fps"]["numerator"]
    scene.render.fps_base = description["fps"]["denominator"]
    scene.frame_start = description["frameStart"]
    scene.frame_end = description["frameEnd"]
    # Toujours transparent en interne : la couche alpha est disponible même pour un fond opaque.
    scene.render.film_transparent = True
    scene.render.use_motion_blur = render["motionBlur"]
    scene.cycles.filter_width = {"none": 0.01, "fxaa": 1.0, "msaa4": 1.5, "msaa8": 2.0}[
        render["antiAliasing"]
    ]
    scene.view_settings.view_transform = render["viewTransform"]
    scene.display_settings.display_device = "sRGB"

    world = bpy.data.worlds.new("Monde")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    ambient = 0.6 if description["previewLighting"] else 0.15
    background.inputs["Color"].default_value = (ambient, ambient, ambient, 1)
    background.inputs["Strength"].default_value = 1.0
    scene.world = world
    if description["previewLighting"]:
        # Même aide que l'éditeur quand la scène n'a aucune lumière : soleil d'aperçu.
        sun = bpy.data.lights.new("Éclairage d'aperçu", "SUN")
        sun.energy = 2.5
        sun_obj = bpy.data.objects.new("Éclairage d'aperçu", sun)
        scene.collection.objects.link(sun_obj)
        sun_obj.rotation_euler = (math.radians(50), 0, math.radians(30))

    layer = scene.view_layers[0]
    passes = set(render["passes"])
    maps = description["conditioningMaps"]
    layer.use_pass_z = "depth" in passes or maps
    layer.use_pass_normal = "normal" in passes or maps
    layer.use_pass_object_index = "object_id" in passes
    layer.use_pass_vector = "motion_vector" in passes and not render["motionBlur"]
    layer.use_pass_cryptomatte_object = "cryptomatte" in passes

    settings = scene.render.image_settings
    settings.file_format = "OPEN_EXR_MULTILAYER"
    settings.color_depth = "32"
    settings.exr_codec = "ZIP"
    scene.render.use_file_extension = True

    scene.use_nodes = True
    tree = scene.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    layers = tree.nodes.new("CompositorNodeRLayers")
    composite = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(layers.outputs["Image"], composite.inputs["Image"])
    png = tree.nodes.new("CompositorNodeOutputFile")
    png.format.file_format = "PNG"
    png.format.color_mode = "RGBA" if render["transparentBackground"] else "RGB"
    png.format.color_depth = "8"
    png.file_slots[0].path = "frame_"
    if render["transparentBackground"]:
        tree.links.new(layers.outputs["Image"], png.inputs[0])
    else:
        over = tree.nodes.new("CompositorNodeAlphaOver")
        over.inputs[1].default_value = (ambient, ambient, ambient, 1)
        tree.links.new(layers.outputs["Image"], over.inputs[2])
        tree.links.new(over.outputs["Image"], png.inputs[0])
    scene["ass_png_node"] = png.name
    scene["ass_frames"] = description["renderFrames"]
    if description["conditioningMaps"]:
        add_conditioning_outputs(scene, tree, layers)


def data_output(tree, path: str):
    """Sortie PNG de données : valeurs brutes, sans transformation d'affichage."""
    node = tree.nodes.new("CompositorNodeOutputFile")
    node.format.file_format = "PNG"
    node.format.color_mode = "RGB"
    node.format.color_depth = "16"
    node.format.color_management = "OVERRIDE"
    node.format.view_settings.view_transform = "Raw"
    node.file_slots[0].path = path
    return node


def add_conditioning_outputs(scene, tree, layers) -> None:
    """Cartes de contrôle IA : profondeur (blanc = proche), normales monde (n/2 + 0,5)."""
    normalize = tree.nodes.new("CompositorNodeNormalize")
    invert = tree.nodes.new("CompositorNodeInvert")
    tree.links.new(layers.outputs["Depth"], normalize.inputs[0])
    tree.links.new(normalize.outputs[0], invert.inputs["Color"])
    depth = data_output(tree, "frame_")
    tree.links.new(invert.outputs[0], depth.inputs[0])
    scene["ass_depth_node"] = depth.name
    half = tree.nodes.new("CompositorNodeMixRGB")
    half.blend_type = "MULTIPLY"
    half.inputs[2].default_value = (0.5, 0.5, 0.5, 1)
    offset = tree.nodes.new("CompositorNodeMixRGB")
    offset.blend_type = "ADD"
    offset.inputs[2].default_value = (0.5, 0.5, 0.5, 1)
    tree.links.new(layers.outputs["Normal"], half.inputs[1])
    tree.links.new(half.outputs[0], offset.inputs[1])
    normal = data_output(tree, "frame_")
    tree.links.new(offset.outputs[0], normal.inputs[0])
    scene["ass_normal_node"] = normal.name


def probe(scene, objects: dict, root, frames: list[int], path: Path) -> None:
    """Valeurs évaluées par Blender, ramenées au repère canonique (tests de cohérence)."""
    to_canonical = root.matrix_world.inverted()
    result = {}
    for frame in frames:
        scene.frame_set(frame)
        entries = {}
        for entity_id, obj in objects.items():
            world = to_canonical @ obj.matrix_world
            entry = {"world": list(world.translation), "hidden": obj.hide_render}
            if obj.type == "CAMERA":
                entry["lens"] = obj.data.lens
                entry["fstop"] = obj.data.dof.aperture_fstop
            if obj.type == "LIGHT":
                entry["energy"] = obj.data.energy
            entries[entity_id] = entry
        result[str(frame)] = entries
    path.write_text(json.dumps(result))


def render_frames(scene, output: Path) -> None:
    (output / "exr").mkdir(parents=True, exist_ok=True)
    png = scene.node_tree.nodes[scene["ass_png_node"]]
    png.base_path = str(output / "png")
    for name, folder in (("ass_depth_node", "depth"), ("ass_normal_node", "normal")):
        if name in scene:
            scene.node_tree.nodes[scene[name]].base_path = str(output / folder)
    for frame in scene["ass_frames"]:
        scene.frame_set(frame)
        # Blender ajoute .exr ; le nœud de sortie PNG ajoute le numéro de frame et .png.
        scene.render.filepath = str(output / "exr" / f"frame_{frame:04d}")
        bpy.ops.render.render(write_still=True)
        print(f"ASS_FRAME {frame}", flush=True)


def main() -> None:
    args = parse_args()
    description = json.loads(Path(args.description).read_text(encoding="utf-8"))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    scene, objects, root = build(description)
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend, compress=True)
    if args.probe:
        frames = [int(value) for value in args.probe.split(",")]
        probe(scene, objects, root, frames, output / "probe.json")
    if args.render:
        if scene.camera is None:
            raise SystemExit("Aucune caméra active : impossible de rendre")
        render_frames(scene, output)


main()
