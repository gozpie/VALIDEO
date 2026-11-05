import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createEmptyScene, validateScene } from '@ass/scene-schema';
import {
  CAMERAS_PLATEAU,
  addCameraPlateau,
  addMannequin,
  mannequins,
  regarderVers,
} from '../src/plateau';

const scene = () => createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000aa' });

describe('plateau gris', () => {
  it('un mannequin est un groupe de volumes, posé à côté du précédent', () => {
    const un = addMannequin(scene(), 'Léa');
    const deux = addMannequin(un.scene, 'Marc', 'assis');
    expect(mannequins(deux.scene).map((m) => m.name)).toEqual([
      'Mannequin - Léa',
      'Mannequin - Marc',
    ]);
    const groupeMarc = deux.scene.nodes.find((n) => n.id === deux.id);
    expect(groupeMarc?.transform.position).toEqual([0.8, 0, 0]);
    const parties = deux.scene.nodes.filter((n) => n.parentId === deux.id);
    expect(parties.map((n) => n.name)).toContain('Marc - tête');
    expect(parties.every((n) => n.materialOverrides.length === 1)).toBe(true);
    expect(validateScene(deux.scene).success).toBe(true);
  });

  it('regarderVers oriente bien la caméra, qui regarde vers -Z', () => {
    for (const [depuis, vers] of [
      [
        [0, 1, 5],
        [0, 1, 0],
      ],
      [
        [2, 1.5, 3],
        [0, 1, 0],
      ],
      [
        [-3, 0.5, -2],
        [1, 2, 4],
      ],
    ] as [[number, number, number], [number, number, number]][]) {
      const q = regarderVers(depuis, vers);
      const regard = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...q));
      const attendu = new Vector3(...vers).sub(new Vector3(...depuis)).normalize();
      expect(regard.distanceTo(attendu)).toBeLessThan(1e-6);
    }
  });

  it('chaque caméra préréglée vise le mannequin, à sa focale, et devient active', () => {
    const { scene: avec, id } = addMannequin(scene(), 'Léa');
    let courante = avec;
    CAMERAS_PLATEAU.forEach((reglage, rang) => {
      const pose = addCameraPlateau(courante, reglage.id, id);
      courante = pose.scene;
      expect(courante.activeCameraId).toBe(pose.id);
      const camera = courante.cameras.find((c) => c.id === pose.id);
      expect(camera?.focalLengthMm).toBe(reglage.focale);
      expect(camera?.name).toBe(`Caméra ${rang + 1} - ${reglage.nom}`);
    });
    expect(courante.cameras).toHaveLength(CAMERAS_PLATEAU.length);
    expect(validateScene(courante).success).toBe(true);
  });

  it('sans mannequin, la caméra vise le centre du plateau', () => {
    const { scene: avec, id } = addCameraPlateau(scene(), 'moyen');
    expect(avec.cameras.find((c) => c.id === id)?.transform.position).toEqual([0, 1.2, 2.6]);
  });
});
