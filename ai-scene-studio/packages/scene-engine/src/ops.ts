/**
 * Opérations d'édition pures sur la scène canonique : chaque fonction renvoie une nouvelle scène
 * sans modifier l'entrée (l'historique annuler/rétablir repose sur cette propriété).
 */
import { Matrix4 } from 'three';
import type {
  Camera,
  Light,
  LinearRgb,
  SceneDocument,
  SceneNode,
  Transform,
} from '@ass/scene-schema';
import { createGroupNode, createMaterial, newId } from './factories';
import { matrixToTransform, transformToMatrix } from './math';

export type EntityKind = 'node' | 'camera' | 'light';
export type Entity =
  | { kind: 'node'; value: SceneNode }
  | { kind: 'camera'; value: Camera }
  | { kind: 'light'; value: Light };

const copy = (scene: SceneDocument): SceneDocument => structuredClone(scene);

function must<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error('Identifiant de copie manquant');
  return value;
}

export function findEntity(scene: SceneDocument, id: string): Entity | null {
  const node = scene.nodes.find((item) => item.id === id);
  if (node) return { kind: 'node', value: node };
  const camera = scene.cameras.find((item) => item.id === id);
  if (camera) return { kind: 'camera', value: camera };
  const light = scene.lights.find((item) => item.id === id);
  return light ? { kind: 'light', value: light } : null;
}

/** Enfants directs d'un nœud (ou racine si `parentId` est null), dans l'ordre du document. */
export function childrenOf(scene: SceneDocument, parentId: string | null): Entity[] {
  return [
    ...scene.nodes
      .filter((n) => n.parentId === parentId)
      .map((value) => ({ kind: 'node', value }) as const),
    ...scene.cameras
      .filter((c) => c.parentId === parentId)
      .map((value) => ({ kind: 'camera', value }) as const),
    ...scene.lights
      .filter((l) => l.parentId === parentId)
      .map((value) => ({ kind: 'light', value }) as const),
  ];
}

/** Identifiants de l'entité et de tous ses descendants. */
export function subtreeIds(scene: SceneDocument, id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of [...scene.nodes, ...scene.cameras, ...scene.lights]) {
      if (item.parentId !== null && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function worldMatrix(scene: SceneDocument, id: string): Matrix4 {
  const entity = findEntity(scene, id);
  if (!entity) throw new Error(`Entité inconnue : ${id}`);
  const local = transformToMatrix(entity.value.transform);
  const parentId = entity.value.parentId;
  return parentId === null ? local : worldMatrix(scene, parentId).multiply(local);
}

function mutate(scene: SceneDocument, id: string, change: (entity: Entity) => void): SceneDocument {
  const next = copy(scene);
  const entity = findEntity(next, id);
  if (!entity) throw new Error(`Entité inconnue : ${id}`);
  change(entity);
  return next;
}

export function addEntity(scene: SceneDocument, entity: Entity): SceneDocument {
  const next = copy(scene);
  if (entity.kind === 'node') next.nodes.push(structuredClone(entity.value));
  if (entity.kind === 'camera') next.cameras.push(structuredClone(entity.value));
  if (entity.kind === 'light') next.lights.push(structuredClone(entity.value));
  return next;
}

/** Supprime les entités, leurs descendants, les pistes qui les animent et leurs matériaux propres. */
export function removeEntities(scene: SceneDocument, ids: Iterable<string>): SceneDocument {
  const removed = new Set<string>();
  for (const id of ids) for (const sub of subtreeIds(scene, id)) removed.add(sub);
  const next = copy(scene);
  next.nodes = next.nodes.filter((n) => !removed.has(n.id));
  next.cameras = next.cameras.filter((c) => !removed.has(c.id));
  next.lights = next.lights.filter((l) => !removed.has(l.id));
  next.animations = next.animations.filter((track) => !removed.has(track.targetId));
  if (next.activeCameraId !== null && removed.has(next.activeCameraId)) {
    next.activeCameraId = next.cameras[0]?.id ?? null;
  }
  for (const camera of next.cameras) {
    if (camera.lookAtTargetId !== null && removed.has(camera.lookAtTargetId))
      camera.lookAtTargetId = null;
  }
  const usedMaterials = new Set(
    next.nodes.flatMap((n) => n.materialOverrides.map((o) => o.materialId)),
  );
  next.materials = next.materials.filter((m) => usedMaterials.has(m.id));
  return next;
}

export function renameEntity(scene: SceneDocument, id: string, name: string): SceneDocument {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 200) throw new Error('Nom vide ou trop long');
  return mutate(scene, id, (entity) => {
    entity.value.name = trimmed;
  });
}

export function setTransform(
  scene: SceneDocument,
  id: string,
  transform: Transform,
): SceneDocument {
  return mutate(scene, id, (entity) => {
    entity.value.transform = structuredClone(transform);
  });
}

/** Visibilité : nœuds et lumières (une caméra n'est jamais rendue). */
export function setVisible(scene: SceneDocument, id: string, visible: boolean): SceneDocument {
  return mutate(scene, id, (entity) => {
    if (entity.kind === 'camera') throw new Error('Une caméra n’a pas de visibilité');
    entity.value.visible = visible;
  });
}

/** Verrouillage des paramètres : objets et caméras. */
export function setLocked(scene: SceneDocument, id: string, locked: boolean): SceneDocument {
  return mutate(scene, id, (entity) => {
    if (entity.kind === 'light') throw new Error('Une lumière ne se verrouille pas');
    entity.value.locked = locked;
  });
}

export function isLocked(scene: SceneDocument, id: string): boolean {
  const entity = findEntity(scene, id);
  return entity !== null && entity.kind !== 'light' && entity.value.locked;
}

/** Caméra active du plan (vue caméra, rendu) ; null pour aucune. */
export function setActiveCamera(scene: SceneDocument, cameraId: string | null): SceneDocument {
  if (cameraId !== null && !scene.cameras.some((c) => c.id === cameraId)) {
    throw new Error('Caméra inconnue');
  }
  return { ...copy(scene), activeCameraId: cameraId };
}

/**
 * Change le parent d'une entité. Par défaut, la position dans le monde est conservée (la
 * transformation locale est recalculée). Refuse un parent qui n'est pas un objet, ou qui est
 * l'entité elle-même ou l'un de ses descendants (cycle).
 */
export function setParent(
  scene: SceneDocument,
  id: string,
  parentId: string | null,
  { keepWorld = true }: { keepWorld?: boolean } = {},
): SceneDocument {
  if (parentId !== null) {
    if (subtreeIds(scene, id).has(parentId)) throw new Error('Parentage circulaire refusé');
    if (findEntity(scene, parentId)?.kind !== 'node')
      throw new Error('Le parent doit être un objet');
  }
  const world = worldMatrix(scene, id);
  return mutate(scene, id, (entity) => {
    entity.value.parentId = parentId;
    if (keepWorld) {
      const parentWorld = parentId === null ? new Matrix4() : worldMatrix(scene, parentId);
      entity.value.transform = matrixToTransform(parentWorld.invert().multiply(world));
    }
  });
}

/** Duplique les entités (et leurs descendants) ; renvoie la scène et les ID des copies racines. */
export function duplicateEntities(
  scene: SceneDocument,
  ids: string[],
): { scene: SceneDocument; ids: string[] } {
  const next = copy(scene);
  const roots: string[] = [];
  for (const id of ids) {
    const subtree = subtreeIds(scene, id);
    const mapping = new Map([...subtree].map((old) => [old, newId()]));
    const remap = (parentId: string | null, isRoot: boolean) =>
      isRoot ? parentId : parentId === null ? null : (mapping.get(parentId) ?? parentId);
    for (const node of scene.nodes.filter((n) => subtree.has(n.id))) {
      next.nodes.push({
        ...structuredClone(node),
        id: must(mapping, node.id),
        parentId: remap(node.parentId, node.id === id),
        name: node.id === id ? `${node.name} copie`.slice(0, 200) : node.name,
        // passIndex doit rester unique : la copie n'en a pas.
        passIndex: 0,
      });
    }
    for (const camera of scene.cameras.filter((c) => subtree.has(c.id))) {
      next.cameras.push({
        ...structuredClone(camera),
        id: must(mapping, camera.id),
        parentId: remap(camera.parentId, camera.id === id),
        name: camera.id === id ? `${camera.name} copie`.slice(0, 200) : camera.name,
        lookAtTargetId:
          camera.lookAtTargetId === null
            ? null
            : (mapping.get(camera.lookAtTargetId) ?? camera.lookAtTargetId),
      });
    }
    for (const light of scene.lights.filter((l) => subtree.has(l.id))) {
      next.lights.push({
        ...structuredClone(light),
        id: must(mapping, light.id),
        parentId: remap(light.parentId, light.id === id),
        name: light.id === id ? `${light.name} copie`.slice(0, 200) : light.name,
      });
    }
    roots.push(must(mapping, id));
  }
  return { scene: next, ids: roots };
}

/**
 * Regroupe des entités sous un nouveau groupe placé sous leur parent commun (ou à la racine),
 * sans changer leur position dans le monde.
 */
export function groupEntities(
  scene: SceneDocument,
  ids: string[],
  name = 'Groupe',
): { scene: SceneDocument; groupId: string } {
  if (ids.length === 0) throw new Error('Rien à grouper');
  const parents = new Set(ids.map((id) => findEntity(scene, id)?.value.parentId ?? null));
  const group = createGroupNode(name);
  group.parentId = parents.size === 1 ? ([...parents][0] ?? null) : null;
  let next = addEntity(scene, { kind: 'node', value: group });
  // Les descendants d'un élément déjà sélectionné suivent leur ancêtre.
  const topLevel = ids.filter(
    (id) => !ids.some((other) => other !== id && subtreeIds(scene, other).has(id)),
  );
  for (const id of topLevel) next = setParent(next, id, group.id);
  return { scene: next, groupId: group.id };
}

/** Couleur de base d'un objet : crée au besoin un matériau propre (emplacement « * »). */
export function setNodeColor(scene: SceneDocument, id: string, color: LinearRgb): SceneDocument {
  const next = copy(scene);
  const node = next.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`Objet inconnu : ${id}`);
  const override = node.materialOverrides.find((o) => o.slot === '*');
  const material = override && next.materials.find((m) => m.id === override.materialId);
  if (material) {
    material.baseColor = color;
  } else {
    const created = createMaterial(`Matériau ${node.name}`.slice(0, 200), color);
    next.materials.push(created);
    node.materialOverrides = [
      ...node.materialOverrides.filter((o) => o.slot !== '*'),
      { slot: '*', materialId: created.id },
    ];
  }
  return next;
}

export function nodeColor(scene: SceneDocument, id: string): LinearRgb | null {
  const node = scene.nodes.find((n) => n.id === id);
  const override = node?.materialOverrides.find((o) => o.slot === '*');
  return scene.materials.find((m) => m.id === override?.materialId)?.baseColor ?? null;
}

export function updateCamera(
  scene: SceneDocument,
  id: string,
  patch: Partial<Camera>,
): SceneDocument {
  return mutate(scene, id, (entity) => {
    if (entity.kind !== 'camera') throw new Error('Caméra attendue');
    Object.assign(entity.value, patch, { id: entity.value.id });
  });
}

export function updateLight(
  scene: SceneDocument,
  id: string,
  patch: Partial<Light>,
): SceneDocument {
  return mutate(scene, id, (entity) => {
    if (entity.kind !== 'light') throw new Error('Lumière attendue');
    Object.assign(entity.value, patch, { id: entity.value.id });
  });
}
