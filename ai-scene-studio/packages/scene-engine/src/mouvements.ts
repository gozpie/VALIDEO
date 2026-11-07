import { setKey } from '@ass/animation-engine';
import type { Quaternion as Quat, SceneDocument, Vec3 } from '@ass/scene-schema';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { evaluateFrame } from './camera';
import { findEntity, worldMatrix } from './ops';

/**
 * Mouvements de caméra du plateau, comme sur un tournage : travelling, panoramique, grue, orbite.
 * Ils deviennent de simples clés de position et de rotation (une clé toutes les 6 frames, départ et
 * arrivée adoucis) : la vue caméra, la vidéo grise et le rendu les jouent à l'identique, sans
 * contrainte à recalculer.
 */
export type TypeMouvement =
  | 'travelling_avant'
  | 'travelling_arriere'
  | 'travelling_gauche'
  | 'travelling_droite'
  | 'panoramique_gauche'
  | 'panoramique_droite'
  | 'grue_montee'
  | 'grue_descente'
  | 'orbite_gauche'
  | 'orbite_droite'
  | 'arc_avant';

export const MOUVEMENTS: Record<
  TypeMouvement,
  { label: string; amplitude: number; unite: string }
> = {
  travelling_avant: { label: 'Travelling avant', amplitude: 1, unite: 'm' },
  travelling_arriere: { label: 'Travelling arrière', amplitude: 1, unite: 'm' },
  travelling_gauche: { label: 'Travelling latéral gauche', amplitude: 1, unite: 'm' },
  travelling_droite: { label: 'Travelling latéral droite', amplitude: 1, unite: 'm' },
  panoramique_gauche: { label: 'Panoramique gauche', amplitude: 30, unite: '°' },
  panoramique_droite: { label: 'Panoramique droite', amplitude: 30, unite: '°' },
  grue_montee: { label: 'Grue montante', amplitude: 1, unite: 'm' },
  grue_descente: { label: 'Grue descendante', amplitude: 1, unite: 'm' },
  orbite_gauche: { label: 'Orbite gauche', amplitude: 30, unite: '°' },
  orbite_droite: { label: 'Orbite droite', amplitude: 30, unite: '°' },
  arc_avant: { label: 'Arc avant (approche en courbe)', amplitude: 1, unite: 'm' },
};

export interface Mouvement {
  type: TypeMouvement;
  /** Mètres (travelling, grue, arc) ou degrés (panoramique, orbite) ; valeur par défaut sinon. */
  amplitude?: number;
  /** Première et dernière frame du mouvement ; tout le plan par défaut. */
  debut?: number;
  fin?: number;
  /**
   * Ce que la caméra garde au centre pendant le mouvement (nœud de la scène). Sans cible : elle
   * garde son orientation (travelling, grue) ou vise le point situé devant elle (orbite, arc).
   */
  cibleId?: string | null;
}

const PAS = 6;
const adoucir = (t: number) => t * t * (3 - 2 * t);

/** Rotation qui oriente une caméra (−Z vers la cible, +Y en haut) de `oeil` vers `cible`. */
function viser(oeil: Vector3, cible: Vector3): Quaternion {
  const haut =
    Math.abs(cible.clone().sub(oeil).normalize().y) > 0.9999
      ? new Vector3(0, 0, -1)
      : new Vector3(0, 1, 0);
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(oeil, cible, haut));
}

/**
 * Remplace le mouvement de la caméra par celui demandé. La pose de départ est celle de la caméra à
 * la première frame : le cadrage validé reste le point de départ du plan.
 */
export function mouvementCamera(
  scene: SceneDocument,
  cameraId: string,
  mouvement: Mouvement,
): SceneDocument {
  const camera = scene.cameras.find((c) => c.id === cameraId);
  if (!camera) throw new Error('Caméra introuvable');
  if (camera.parentId !== null)
    throw new Error('Caméra rattachée à un parent : détachez-la d’abord');
  const debut = Math.max(0, Math.min(mouvement.debut ?? 0, scene.durationFrames - 1));
  const fin = Math.max(
    debut + 1,
    Math.min(mouvement.fin ?? scene.durationFrames - 1, scene.durationFrames - 1),
  );
  if (fin <= debut) throw new Error('Le plan est trop court pour un mouvement');
  const amplitude = mouvement.amplitude ?? MOUVEMENTS[mouvement.type].amplitude;

  // Pose de départ (animation et visée comprises), puis on repart d'une caméra sans clés.
  const depart = evaluateFrame(scene, debut);
  const pose = worldMatrix(depart, cameraId);
  const oeil0 = new Vector3().setFromMatrixPosition(pose);
  const rotation0 = new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(pose));
  const devant = new Vector3(0, 0, -1).applyQuaternion(rotation0);
  const droite = new Vector3(1, 0, 0).applyQuaternion(rotation0);
  const horizontal = new Vector3(devant.x, 0, devant.z).normalize();
  const cibleNoeud =
    mouvement.cibleId && findEntity(depart, mouvement.cibleId)
      ? new Vector3().setFromMatrixPosition(worldMatrix(depart, mouvement.cibleId))
      : null;
  // Point visé par défaut : 3 m devant la caméra, ou la cible donnée.
  const vise = cibleNoeud ?? oeil0.clone().addScaledVector(devant, 3);

  let suivante: SceneDocument = {
    ...structuredClone(scene),
    animations: scene.animations.filter(
      (t) =>
        t.targetId !== cameraId ||
        (t.propertyPath !== 'transform.position' && t.propertyPath !== 'transform.rotation'),
    ),
    cameras: scene.cameras.map((c) =>
      c.id === cameraId
        ? {
            ...structuredClone(c),
            lookAtTargetId: null,
            transform: {
              ...c.transform,
              position: oeil0.toArray() as Vec3,
              rotation: [rotation0.x, rotation0.y, rotation0.z, rotation0.w] as Quat,
            },
          }
        : structuredClone(c),
    ),
  };

  const poseA = (t: number): { oeil: Vector3; rotation: Quaternion } => {
    const e = adoucir(t);
    const garderVisee = (oeil: Vector3) =>
      cibleNoeud ? viser(oeil, cibleNoeud) : rotation0.clone();
    switch (mouvement.type) {
      case 'travelling_avant':
      case 'travelling_arriere': {
        const sens = mouvement.type === 'travelling_avant' ? 1 : -1;
        const oeil = oeil0.clone().addScaledVector(horizontal, sens * amplitude * e);
        return { oeil, rotation: garderVisee(oeil) };
      }
      case 'travelling_gauche':
      case 'travelling_droite': {
        const sens = mouvement.type === 'travelling_droite' ? 1 : -1;
        const oeil = oeil0.clone().addScaledVector(droite, sens * amplitude * e);
        return { oeil, rotation: garderVisee(oeil) };
      }
      case 'grue_montee':
      case 'grue_descente': {
        const sens = mouvement.type === 'grue_montee' ? 1 : -1;
        const oeil = oeil0.clone().add(new Vector3(0, sens * amplitude * e, 0));
        return { oeil, rotation: garderVisee(oeil) };
      }
      case 'panoramique_gauche':
      case 'panoramique_droite': {
        const sens = mouvement.type === 'panoramique_gauche' ? 1 : -1;
        const tour = new Quaternion().setFromAxisAngle(
          new Vector3(0, 1, 0),
          (sens * amplitude * e * Math.PI) / 180,
        );
        return { oeil: oeil0.clone(), rotation: tour.multiply(rotation0.clone()) };
      }
      case 'orbite_gauche':
      case 'orbite_droite': {
        const sens = mouvement.type === 'orbite_droite' ? 1 : -1;
        const angle = (sens * amplitude * e * Math.PI) / 180;
        const rayon = oeil0
          .clone()
          .sub(vise)
          .applyAxisAngle(new Vector3(0, 1, 0), angle);
        const oeil = vise.clone().add(rayon);
        return { oeil, rotation: viser(oeil, vise) };
      }
      case 'arc_avant': {
        // Approche en courbe : on avance de `amplitude` m en glissant de côté (moitié), visée tenue.
        const oeil = oeil0
          .clone()
          .addScaledVector(horizontal, amplitude * e)
          .addScaledVector(droite, amplitude * 0.5 * Math.sin((e * Math.PI) / 2));
        return { oeil, rotation: viser(oeil, vise) };
      }
    }
  };

  const frames: number[] = [];
  for (let f = debut; f < fin; f += PAS) frames.push(f);
  frames.push(fin);
  for (const frame of frames) {
    const { oeil, rotation } = poseA((frame - debut) / (fin - debut));
    rotation.normalize();
    suivante = setKey(suivante, {
      targetId: cameraId,
      propertyPath: 'transform.position',
      frame,
      value: oeil.toArray() as Vec3,
      interpolation: 'linear',
    });
    suivante = setKey(suivante, {
      targetId: cameraId,
      propertyPath: 'transform.rotation',
      frame,
      value: [rotation.x, rotation.y, rotation.z, rotation.w] as Quat,
      interpolation: 'linear',
    });
  }
  return suivante;
}
