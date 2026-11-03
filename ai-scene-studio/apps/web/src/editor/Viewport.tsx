'use client';

import type { Camera as SceneCamera, Light as SceneLight, SceneNode } from '@ass/scene-schema';
import { setTransformAtFrame } from '@ass/animation-engine';
import { evaluatedScene } from '@ass/editor-ui';
import {
  childrenOf,
  evaluateFrame,
  isLocked,
  nodeColor,
  worldMatrix,
  type Entity,
} from '@ass/scene-engine';
import {
  createMaterial,
  createPrimitiveGeometry,
  linearColor,
  readTransform,
} from '@ass/scene-engine/three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  Line,
  OrthographicCamera,
  PerspectiveCamera,
  TransformControls,
  useGLTF,
} from '@react-three/drei';
import {
  Component,
  Suspense,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import {
  Box3,
  MathUtils,
  Object3D,
  Vector3,
  type DirectionalLight,
  type Group,
  type SpotLight,
} from 'three';
import { useEditor, useEditorContext } from './context';

export type ViewDirection = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'free';
export interface ViewSettings {
  projection: 'perspective' | 'orthographic';
  direction: ViewDirection;
  /** Incrémenté pour réappliquer une même vue. */
  nonce: number;
}

const DIRECTIONS: Record<Exclude<ViewDirection, 'free'>, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
};

const ACCENT = '#4f8cff';

/** Options d'une vue : la vue libre est interactive ; la vue caméra n'affiche que la scène. */
export const ViewOptions = createContext({ interactive: true, helpers: true });

/** Enregistre l'objet Three.js d'une entité et déclenche le rendu du gizmo quand il change. */
function useRegister(id: string, ref: React.RefObject<Object3D | null>, onChange: () => void) {
  const { objects } = useEditorContext();
  const { interactive } = useContext(ViewOptions);
  useLayoutEffect(() => {
    const object = ref.current;
    if (!object || !interactive) return;
    objects.set(id, object);
    onChange();
    return () => {
      if (objects.get(id) === object) objects.delete(id);
      onChange();
    };
  }, [id, objects, ref, onChange, interactive]);
}

function useSelectHandler(id: string) {
  const { store } = useEditorContext();
  const { interactive } = useContext(ViewOptions);
  return (event: ThreeEvent<MouseEvent>) => {
    if (!interactive) return;
    event.stopPropagation();
    if (event.delta > 4) return; // fin d'une rotation de vue, pas un clic
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    store.getState().select([id], additive ? 'toggle' : 'replace');
  };
}

function PrimitiveMesh({ node, selected }: { node: SceneNode; selected: boolean }) {
  const geometry = useMemo(
    () => createPrimitiveGeometry(node.primitive ?? 'cube'),
    [node.primitive],
  );
  const color = useEditor((state) => nodeColor(evaluatedScene(state), node.id));
  const material = useMemo(() => {
    const result = createMaterial(null);
    if (color) result.color = linearColor(color);
    return result;
  }, [color]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.emissive.set(selected ? ACCENT : '#000000');
    material.emissiveIntensity = selected ? 0.35 : 0;
  }, [material, selected]);
  const onClick = useSelectHandler(node.id);
  return (
    <mesh
      geometry={geometry}
      material={material}
      castShadow={node.castShadow}
      receiveShadow={node.receiveShadow}
      onClick={onClick}
    />
  );
}

function GltfModel({ node, url }: { node: SceneNode; url: string }) {
  const gltf = useGLTF(url, false, false, (loader) => {
    loader.setWithCredentials(true);
  });
  const object = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((child) => {
      child.castShadow = node.castShadow;
      child.receiveShadow = node.receiveShadow;
    });
    return clone;
  }, [gltf, node.castShadow, node.receiveShadow]);
  const onClick = useSelectHandler(node.id);
  return <primitive object={object} onClick={onClick} />;
}

/** Affichage de repli d'un modèle en chargement ou en erreur : boîte filaire d'un mètre. */
function Placeholder({ color }: { color: string }) {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} wireframe />
    </mesh>
  );
}

class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <Placeholder color="#f85149" /> : this.props.children;
  }
}

function CameraIcon({ camera, selected }: { camera: SceneCamera; selected: boolean }) {
  const onClick = useSelectHandler(camera.id);
  const active = useEditor((state) => state.scene.activeCameraId === camera.id);
  if (!useContext(ViewOptions).helpers) return null;
  return (
    <mesh rotation={[Math.PI / 2, 0, Math.PI / 4]} position={[0, 0, -0.25]} onClick={onClick}>
      <coneGeometry args={[0.3, 0.5, 4, 1, true]} />
      <meshBasicMaterial color={selected ? ACCENT : active ? '#3fb950' : '#e6e8ee'} wireframe />
    </mesh>
  );
}

function LightObject({ light, selected }: { light: SceneLight; selected: boolean }) {
  const onClick = useSelectHandler(light.id);
  const target = useMemo(() => {
    const object = new Object3D();
    object.position.set(0, 0, -1); // −Z local : direction d'éclairage canonique
    return object;
  }, []);
  const directional = useRef<DirectionalLight>(null);
  const spot = useRef<SpotLight>(null);
  useEffect(() => {
    if (directional.current) directional.current.target = target;
    if (spot.current) spot.current.target = target;
  }, [target, light.kind]);
  const color = linearColor(light.color);
  const { helpers } = useContext(ViewOptions);
  return (
    <>
      <primitive object={target} />
      {light.kind === 'directional' && (
        <directionalLight
          ref={directional}
          color={color}
          intensity={light.intensity}
          castShadow={light.castShadow}
        />
      )}
      {light.kind === 'point' && (
        <pointLight
          color={color}
          intensity={light.intensity}
          distance={light.range ?? 0}
          castShadow={light.castShadow}
        />
      )}
      {light.kind === 'spot' && (
        <spotLight
          ref={spot}
          color={color}
          intensity={light.intensity}
          distance={light.range ?? 0}
          angle={light.outerConeAngle ?? 0.5}
          penumbra={
            light.outerConeAngle ? 1 - (light.innerConeAngle ?? 0) / light.outerConeAngle : 0
          }
          castShadow={light.castShadow}
        />
      )}
      <mesh onClick={onClick} visible={helpers}>
        <sphereGeometry args={[0.15, 16, 8]} />
        <meshBasicMaterial
          color={selected ? ACCENT : '#d29922'}
          wireframe={light.kind !== 'point'}
        />
      </mesh>
    </>
  );
}

function EntityObject({ entity, onRegistered }: { entity: Entity; onRegistered: () => void }) {
  const { assetUrl } = useEditorContext();
  const ref = useRef<Group>(null);
  const id = entity.value.id;
  const { interactive } = useContext(ViewOptions);
  const selected = useEditor((state) => interactive && state.selection.includes(id));
  useRegister(id, ref, onRegistered);
  const { position, rotation, scale } = entity.value.transform;
  const visible = entity.kind === 'camera' ? true : entity.value.visible;

  let content: ReactNode = null;
  if (entity.kind === 'node') {
    const node = entity.value;
    if (node.type === 'primitive') content = <PrimitiveMesh node={node} selected={selected} />;
    if (node.type === 'model' && node.assetId) {
      content = (
        <ModelBoundary>
          <Suspense fallback={<Placeholder color="#9aa3b2" />}>
            <GltfModel node={node} url={assetUrl(node.assetId)} />
          </Suspense>
        </ModelBoundary>
      );
    }
  }
  if (entity.kind === 'camera') content = <CameraIcon camera={entity.value} selected={selected} />;
  if (entity.kind === 'light') content = <LightObject light={entity.value} selected={selected} />;

  return (
    <group
      ref={ref}
      name={entity.value.name}
      position={position}
      quaternion={rotation}
      scale={scale}
      visible={visible}
      userData={{ entityId: id }}
    >
      {content}
      {entity.kind === 'node' && <EntityChildren parentId={id} onRegistered={onRegistered} />}
    </group>
  );
}

export function EntityChildren({
  parentId,
  onRegistered,
}: {
  parentId: string | null;
  onRegistered: () => void;
}) {
  // Toujours la scène évaluée à la frame courante : l'animation et les contraintes sont appliquées.
  const scene = useEditor(evaluatedScene);
  const children = useMemo(() => childrenOf(scene, parentId), [scene, parentId]);
  return (
    <>
      {children.map((entity) => (
        <EntityObject key={entity.value.id} entity={entity} onRegistered={onRegistered} />
      ))}
    </>
  );
}

function SelectionGizmo({ version }: { version: number }) {
  const { store, objects, canEdit } = useEditorContext();
  const primary = useEditor((state) => state.selection.at(-1) ?? null);
  const locked = useEditor((state) => (primary ? isLocked(state.scene, primary) : false));
  const tool = useEditor((state) => state.tool);
  const snapping = useEditor((state) => state.snapping);
  const axis = useEditor((state) => state.axisLock);
  const object = primary ? objects.get(primary) : undefined;
  void version;
  if (!canEdit || !primary || !object || locked) return null;
  return (
    <TransformControls
      object={object}
      mode={tool}
      showX={axis === null || axis === 'x'}
      showY={axis === null || axis === 'y'}
      showZ={axis === null || axis === 'z'}
      translationSnap={snapping.enabled ? snapping.translate : null}
      rotationSnap={snapping.enabled ? MathUtils.degToRad(snapping.rotateDegrees) : null}
      scaleSnap={snapping.enabled ? snapping.scale : null}
      onMouseDown={() => store.getState().beginGesture()}
      onObjectChange={() =>
        store
          .getState()
          .updateGesture((scene) =>
            setTransformAtFrame(scene, primary, readTransform(object), store.getState().frame),
          )
      }
      onMouseUp={() => store.getState().endGesture()}
    />
  );
}

/** Trajectoire (travelling) de l'élément sélectionné s'il est animé : positions monde échantillonnées. */
function MotionPath() {
  const scene = useEditor((state) => state.scene);
  const primary = useEditor((state) => state.selection.at(-1) ?? null);
  const points = useMemo(() => {
    if (
      !primary ||
      !scene.animations.some(
        (t) => t.targetId === primary && t.propertyPath.startsWith('transform.'),
      )
    ) {
      return null;
    }
    const step = Math.max(1, Math.ceil(scene.durationFrames / 240));
    const result: [number, number, number][] = [];
    for (let frame = 0; frame < scene.durationFrames; frame += step) {
      const position = new Vector3().setFromMatrixPosition(
        worldMatrix(evaluateFrame(scene, frame), primary),
      );
      result.push([position.x, position.y, position.z]);
    }
    return result.length > 1 ? result : null;
  }, [scene, primary]);
  return points ? <Line points={points} color="#d29922" lineWidth={1.5} /> : null;
}

/** Commandes de vue : vues prédéfinies, perspective/orthographique, cadrage de la sélection. */
function ViewController({ view }: { view: ViewSettings }) {
  const { camera, controls } = useThree();
  const { store, objects, viewport } = useEditorContext();
  const orbit = controls as unknown as { target: Vector3; update: () => void } | null;

  useEffect(() => {
    if (view.direction === 'free' || !orbit) return;
    const target = orbit.target.clone();
    const distance = Math.max(camera.position.distanceTo(target), 4);
    camera.position.copy(
      target.add(new Vector3(...DIRECTIONS[view.direction]).normalize().multiplyScalar(distance)),
    );
    camera.lookAt(orbit.target);
    orbit.update();
  }, [view, camera, orbit]);

  useEffect(() => {
    const frame = (all: boolean) => {
      if (!orbit) return;
      const box = new Box3();
      const ids = all ? [] : store.getState().selection;
      for (const id of ids.length > 0 ? ids : [...objects.keys()]) {
        const object = objects.get(id);
        if (object) box.expandByObject(object);
      }
      if (box.isEmpty()) box.setFromCenterAndSize(new Vector3(), new Vector3(2, 2, 2));
      const center = box.getCenter(new Vector3());
      const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.5);
      const direction = camera.position.clone().sub(orbit.target).normalize();
      orbit.target.copy(center);
      camera.position.copy(center.clone().add(direction.multiplyScalar(radius * 2.5)));
      if ('zoom' in camera && camera.type === 'OrthographicCamera') {
        (camera as unknown as { zoom: number; updateProjectionMatrix: () => void }).zoom =
          400 / radius;
        (camera as unknown as { updateProjectionMatrix: () => void }).updateProjectionMatrix();
      }
      orbit.update();
    };
    viewport.current = { frameSelection: () => frame(false), frameAll: () => frame(true) };
    return () => {
      viewport.current = null;
    };
  }, [camera, orbit, objects, store, viewport]);
  return null;
}

/** Sélection rectangle : entités dont le centre se projette dans le rectangle tracé. */
function RectangleSelector({
  rect,
}: {
  rect: { x0: number; y0: number; x1: number; y1: number; additive: boolean } | null;
}) {
  const { camera, size } = useThree();
  const { store, objects } = useEditorContext();
  useEffect(() => {
    if (!rect) return;
    const [left, right] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)];
    const [top, bottom] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
    const hits: string[] = [];
    for (const [id, object] of objects) {
      if (!object.visible) continue;
      const point = new Vector3().setFromMatrixPosition(object.matrixWorld).project(camera);
      const x = ((point.x + 1) / 2) * size.width;
      const y = ((1 - point.y) / 2) * size.height;
      if (point.z < 1 && x >= left && x <= right && y >= top && y <= bottom) hits.push(id);
    }
    store.getState().select(hits, rect.additive ? 'add' : 'replace');
  }, [rect, camera, size, objects, store]);
  return null;
}

export function Viewport({ view, boxSelect }: { view: ViewSettings; boxSelect: boolean }) {
  const { store } = useEditorContext();
  const [version, setVersion] = useState(0);
  const bump = useMemo(() => () => setVersion((value) => value + 1), []);
  const [drag, setDrag] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    additive: boolean;
  } | null>(null);
  const [rect, setRect] = useState<typeof drag>(null);
  const hasLights = useEditor((state) => state.scene.lights.some((light) => light.visible));

  return (
    <div className="relative h-full w-full" data-testid="viewport">
      <Canvas
        shadows
        gl={{ preserveDrawingBuffer: true }}
        onPointerMissed={(event) => {
          if (!boxSelect && !(event.shiftKey || event.metaKey)) store.getState().select([]);
        }}
      >
        {view.projection === 'perspective' ? (
          <PerspectiveCamera makeDefault position={[6, 4, 8]} fov={40} near={0.05} far={5000} />
        ) : (
          <OrthographicCamera makeDefault position={[6, 4, 8]} zoom={80} near={-1000} far={5000} />
        )}
        <OrbitControls makeDefault enabled={!boxSelect} />
        <ViewController view={view} />
        <RectangleSelector rect={rect} />
        {/* Éclairage d'aperçu de l'éditeur (n'appartient pas à la scène). */}
        <hemisphereLight args={['#ffffff', '#444444', hasLights ? 0.4 : 1.2]} />
        {!hasLights && <directionalLight position={[5, 8, 4]} intensity={1.5} castShadow />}
        <Grid
          infiniteGrid
          cellSize={0.5}
          sectionSize={5}
          cellColor="#2a2f3a"
          sectionColor="#4a5160"
          fadeDistance={60}
        />
        <EntityChildren parentId={null} onRegistered={bump} />
        <MotionPath />
        <SelectionGizmo version={version} />
        <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
          <GizmoViewport axisColors={['#f85149', '#3fb950', '#4f8cff']} labelColor="#0f1115" />
        </GizmoHelper>
      </Canvas>
      {boxSelect && (
        <div
          className="absolute inset-0 cursor-crosshair"
          aria-label="Zone de sélection rectangle"
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - box.left;
            const y = event.clientY - box.top;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDrag({ x0: x, y0: y, x1: x, y1: y, additive: event.shiftKey });
          }}
          onPointerMove={(event) => {
            if (!drag) return;
            const box = event.currentTarget.getBoundingClientRect();
            setDrag({ ...drag, x1: event.clientX - box.left, y1: event.clientY - box.top });
          }}
          onPointerUp={() => {
            setRect(drag);
            setDrag(null);
          }}
        >
          {drag && (
            <div
              className="absolute border border-accent bg-accent/10"
              style={{
                left: Math.min(drag.x0, drag.x1),
                top: Math.min(drag.y0, drag.y1),
                width: Math.abs(drag.x1 - drag.x0),
                height: Math.abs(drag.y1 - drag.y0),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
