/**
 * Caméras : mouvements de tournage (dolly, truck, pedestal, pan, tilt, orbite) et évaluation complète
 * d'une frame (animation puis contraintes de visée). Fonctions pures.
 */
import { evaluateScene } from '@ass/animation-engine';
import type { Camera, SceneDocument } from '@ass/scene-schema';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { matrixToTransform, transformToMatrix } from './math';
import { findEntity, setTransform, worldMatrix } from './ops';

export type CameraMove = 'dolly' | 'truck' | 'pedestal' | 'pan' | 'tilt' | 'orbit';

/**
 * Applique un mouvement de caméra dans son repère local : dolly (avant/arrière, −Z), truck (latéral, X),
 * pedestal (vertical, Y) en mètres ; pan (lacet autour de Y monde), tilt (tangage autour de X local),
 * orbit (autour de la cible de visée, ou d'un point à `orbitDistance` devant la caméra) en radians.
 */
export function moveCamera(
  scene: SceneDocument,
  id: string,
  move: CameraMove,
  amount: number,
  orbitDistance = 5,
): SceneDocument {
  const entity = findEntity(scene, id);
  if (entity?.kind !== 'camera') throw new Error('Caméra attendue');
  if (entity.value.locked) throw new Error('Caméra verrouillée');
  const local = transformToMatrix(entity.value.transform);
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  local.decompose(position, rotation, scale);
  const axis = (x: number, y: number, z: number) => new Vector3(x, y, z).applyQuaternion(rotation);
  switch (move) {
    case 'dolly':
      position.addScaledVector(axis(0, 0, -1), amount);
      break;
    case 'truck':
      position.addScaledVector(axis(1, 0, 0), amount);
      break;
    case 'pedestal':
      position.addScaledVector(axis(0, 1, 0), amount);
      break;
    case 'pan':
      rotation.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), amount));
      break;
    case 'tilt':
      rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), amount));
      break;
    case 'orbit': {
      const pivot = position.clone().addScaledVector(axis(0, 0, -1), orbitDistance);
      const turn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), amount);
      position.sub(pivot).applyQuaternion(turn).add(pivot);
      rotation.premultiply(turn);
      break;
    }
  }
  const transform = matrixToTransform(new Matrix4().compose(position, rotation.normalize(), scale));
  return setTransform(scene, id, transform);
}

/** Oriente une caméra vers sa cible (−Z vers la cible, +Y vers le haut), puis applique le roulis. */
function applyLookAt(scene: SceneDocument, camera: Camera): void {
  if (camera.lookAtTargetId === null || !findEntity(scene, camera.lookAtTargetId)) return;
  const eye = new Vector3().setFromMatrixPosition(worldMatrix(scene, camera.id));
  const target = new Vector3().setFromMatrixPosition(worldMatrix(scene, camera.lookAtTargetId));
  if (eye.distanceToSquared(target) < 1e-12) return;
  const up =
    Math.abs(target.clone().sub(eye).normalize().y) > 0.9999
      ? new Vector3(0, 0, -1)
      : new Vector3(0, 1, 0);
  const world = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, up));
  world.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), camera.rollRadians));
  const parent =
    camera.parentId === null
      ? new Quaternion()
      : new Quaternion().setFromRotationMatrix(
          new Matrix4().extractRotation(worldMatrix(scene, camera.parentId)),
        );
  const local = parent.invert().multiply(world).normalize();
  camera.transform = { ...camera.transform, rotation: [local.x, local.y, local.z, local.w] };
}

/**
 * État exact d'une frame : évaluation de l'animation, puis contraintes (visée des caméras). C'est
 * l'unique source de ce qu'affichent la vue 3D, la vue caméra et, plus tard, le rendu.
 */
export function evaluateFrame(scene: SceneDocument, frame: number): SceneDocument {
  const evaluated = evaluateScene(scene, frame);
  if (!evaluated.cameras.some((c) => c.lookAtTargetId !== null)) return evaluated;
  const constrained = evaluated === scene ? structuredClone(scene) : evaluated;
  for (const camera of constrained.cameras) applyLookAt(constrained, camera);
  return constrained;
}
