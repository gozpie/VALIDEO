import type { LinearRgb, PrimitiveKind, Quaternion, SceneDocument, Vec3 } from '@ass/scene-schema';
import { createCamera, createGroupNode, createPrimitiveNode } from './factories';
import { addEntity, setActiveCamera, setNodeColor } from './ops';

/**
 * Plateau gris : doublures et caméras préréglées, comme sur un vrai tournage. Un mannequin n'est pas un
 * personnage : il dit seulement qui est où, à quelle taille. Le générateur d'images fera le reste.
 */
export type Pose = 'debout' | 'assis';

interface Partie {
  nom: string;
  primitive: PrimitiveKind;
  position: Vec3;
  scale: Vec3;
}

const PARTIES: Record<Pose, Partie[]> = {
  debout: [
    { nom: 'tête', primitive: 'sphere', position: [0, 1.6, 0], scale: [0.22, 0.27, 0.24] },
    { nom: 'buste', primitive: 'sphere', position: [0, 1.16, 0], scale: [0.46, 0.72, 0.3] },
    { nom: 'jambes', primitive: 'cylinder', position: [0, 0.43, 0], scale: [0.34, 0.86, 0.24] },
  ],
  assis: [
    { nom: 'tête', primitive: 'sphere', position: [0, 1.24, 0], scale: [0.22, 0.27, 0.24] },
    { nom: 'buste', primitive: 'sphere', position: [0, 0.8, 0], scale: [0.46, 0.66, 0.3] },
    { nom: 'cuisses', primitive: 'cube', position: [0, 0.46, 0.2], scale: [0.36, 0.16, 0.5] },
    { nom: 'tibias', primitive: 'cube', position: [0, 0.22, 0.42], scale: [0.3, 0.44, 0.13] },
  ],
};

/** Teintes claires et distinctes : on reconnaît chaque doublure d'un coup d'œil. */
const TEINTES: readonly LinearRgb[] = [
  [0.72, 0.68, 0.6],
  [0.42, 0.52, 0.66],
  [0.62, 0.45, 0.42],
  [0.45, 0.58, 0.46],
  [0.58, 0.5, 0.66],
];

const nomMannequin = (nom: string) => `Mannequin - ${nom}`.slice(0, 200);

export function mannequins(scene: SceneDocument) {
  return scene.nodes.filter((n) => n.type === 'group' && n.name.startsWith('Mannequin - '));
}

/** Ajoute une doublure, à côté des précédentes. Rend la scène et l'identifiant du mannequin. */
export function addMannequin(
  scene: SceneDocument,
  nom: string,
  pose: Pose = 'debout',
): { scene: SceneDocument; id: string } {
  const rang = mannequins(scene).length;
  const groupe = createGroupNode(nomMannequin(nom));
  groupe.transform.position = [rang * 0.8, 0, 0];
  let suivante = addEntity(scene, { kind: 'node', value: groupe });
  for (const partie of PARTIES[pose]) {
    const noeud = createPrimitiveNode(partie.primitive);
    noeud.name = `${nom} - ${partie.nom}`.slice(0, 200);
    noeud.parentId = groupe.id;
    noeud.transform.position = partie.position;
    noeud.transform.scale = partie.scale;
    suivante = addEntity(suivante, { kind: 'node', value: noeud });
    suivante = setNodeColor(suivante, noeud.id, TEINTES[rang % TEINTES.length] as LinearRgb);
  }
  return { scene: suivante, id: groupe.id };
}

export const CAMERAS_PLATEAU = [
  { id: 'large', nom: 'Large', focale: 24, recul: 4.2, cote: 0, baisse: 0.35 },
  { id: 'moyen', nom: 'Plan moyen', focale: 35, recul: 2.6, cote: 0, baisse: 0.1 },
  { id: 'epaule', nom: 'Par-dessus l’épaule', focale: 50, recul: 1.7, cote: 0.42, baisse: 0 },
  { id: 'gros', nom: 'Gros plan', focale: 85, recul: 1.35, cote: 0, baisse: 0 },
] as const;
export type CameraPlateau = (typeof CAMERAS_PLATEAU)[number]['id'];

/** Hauteur où viser le mannequin : sa tête, ou 1,2 m sans mannequin. */
function cible(scene: SceneDocument, mannequinId: string | null): Vec3 {
  const groupe = scene.nodes.find((n) => n.id === mannequinId) ?? mannequins(scene)[0] ?? null;
  if (!groupe) return [0, 1.2, 0];
  const tete = scene.nodes.find((n) => n.parentId === groupe.id && n.name.endsWith(' - tête'));
  const [x, y, z] = groupe.transform.position;
  return [x, y + (tete?.transform.position[1] ?? 1.2), z];
}

/** Orientation d'une caméra (qui regarde vers -Z) de `depuis` vers `vers`, sans roulis. */
export function regarderVers(depuis: Vec3, vers: Vec3): Quaternion {
  const [dx, dy, dz] = [vers[0] - depuis[0], vers[1] - depuis[1], vers[2] - depuis[2]];
  const lacet = Math.atan2(-dx, -dz);
  const tangage = Math.atan2(dy, Math.hypot(dx, dz));
  const [sy, cy] = [Math.sin(lacet / 2), Math.cos(lacet / 2)];
  const [sx, cx] = [Math.sin(tangage / 2), Math.cos(tangage / 2)];
  // Lacet puis tangage : q = qy * qx.
  return [cy * sx, sy * cx, -sy * sx, cy * cx];
}

/** Ajoute une caméra préréglée, cadrée sur le mannequin, et en fait la caméra active. */
export function addCameraPlateau(
  scene: SceneDocument,
  preset: CameraPlateau,
  mannequinId: string | null = null,
): { scene: SceneDocument; id: string } {
  const reglage = CAMERAS_PLATEAU.find((c) => c.id === preset);
  if (!reglage) throw new Error('Caméra inconnue');
  const [tx, ty, tz] = cible(scene, mannequinId);
  const vise: Vec3 = [tx, ty - reglage.baisse, tz];
  const position: Vec3 = [tx + reglage.cote, ty, tz + reglage.recul];
  const camera = createCamera(`Caméra ${scene.cameras.length + 1} - ${reglage.nom}`);
  camera.focalLengthMm = reglage.focale;
  camera.transform.position = position;
  camera.transform.rotation = regarderVers(position, vise);
  return {
    scene: setActiveCamera(addEntity(scene, { kind: 'camera', value: camera }), camera.id),
    id: camera.id,
  };
}
