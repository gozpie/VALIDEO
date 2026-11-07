import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { createEmptyScene, validateScene } from '@ass/scene-schema';
import { evaluateFrame } from '../src/camera';
import { mouvementCamera } from '../src/mouvements';
import { worldMatrix } from '../src/ops';
import { addCameraPlateau, addMannequin } from '../src/plateau';

/** Plateau de 48 frames : un mannequin et la caméra « Plan moyen » qui le cadre. */
function plateau() {
  const vide = createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000bb' });
  const mannequin = addMannequin(
    {
      ...vide,
      durationFrames: 48,
      renderSettings: { ...vide.renderSettings, frameStart: 0, frameEnd: 47 },
    },
    'Léa',
  );
  const camera = addCameraPlateau(mannequin.scene, 'moyen', mannequin.id);
  return { scene: camera.scene, cameraId: camera.id, mannequinId: mannequin.id };
}

function pose(scene: ReturnType<typeof plateau>['scene'], id: string, frame: number) {
  const m = worldMatrix(evaluateFrame(scene, frame), id);
  return {
    oeil: new Vector3().setFromMatrixPosition(m),
    devant: new Vector3(0, 0, -1).applyQuaternion(
      new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m)),
    ),
  };
}

describe('mouvements de caméra', () => {
  it('le travelling avant part du cadrage validé et avance de la distance demandée', () => {
    const { scene, cameraId } = plateau();
    const avant = pose(scene, cameraId, 0);
    const bouge = mouvementCamera(scene, cameraId, { type: 'travelling_avant', amplitude: 1.2 });
    expect(validateScene(bouge).success).toBe(true);
    const debut = pose(bouge, cameraId, 0);
    const fin = pose(bouge, cameraId, 47);
    expect(debut.oeil.distanceTo(avant.oeil)).toBeLessThan(1e-6);
    expect(debut.devant.angleTo(avant.devant)).toBeLessThan(1e-6);
    expect(fin.oeil.distanceTo(debut.oeil)).toBeCloseTo(1.2, 5);
    // Il avance droit devant lui, à l'horizontale, sans tourner.
    const trajet = fin.oeil.clone().sub(debut.oeil).normalize();
    expect(trajet.y).toBeCloseTo(0, 6);
    expect(fin.devant.angleTo(debut.devant)).toBeLessThan(1e-4);
    // Départ et arrivée adoucis : à mi-plan, la moitié du chemin.
    expect(pose(bouge, cameraId, 24).oeil.distanceTo(debut.oeil)).toBeGreaterThan(0.55);
    expect(pose(bouge, cameraId, 3).oeil.distanceTo(debut.oeil)).toBeLessThan(0.05);
  });

  it('le panoramique tourne sur place de l’angle demandé', () => {
    const { scene, cameraId } = plateau();
    const bouge = mouvementCamera(scene, cameraId, { type: 'panoramique_gauche', amplitude: 40 });
    const debut = pose(bouge, cameraId, 0);
    const fin = pose(bouge, cameraId, 47);
    expect(fin.oeil.distanceTo(debut.oeil)).toBeLessThan(1e-6);
    const a = new Vector3(debut.devant.x, 0, debut.devant.z).normalize();
    const b = new Vector3(fin.devant.x, 0, fin.devant.z).normalize();
    expect((a.angleTo(b) * 180) / Math.PI).toBeCloseTo(40, 3);
    // Vers la gauche : le regard tourne dans le sens direct autour de +Y.
    expect(a.clone().cross(b).y).toBeGreaterThan(0);
  });

  it('l’orbite tourne autour de la cible en la gardant au centre', () => {
    const { scene, cameraId, mannequinId } = plateau();
    const bouge = mouvementCamera(scene, cameraId, {
      type: 'orbite_droite',
      amplitude: 60,
      cibleId: mannequinId,
      debut: 12,
      fin: 36,
    });
    const centre = new Vector3().setFromMatrixPosition(worldMatrix(bouge, mannequinId));
    const debut = pose(bouge, cameraId, 12);
    const fin = pose(bouge, cameraId, 36);
    const rayon = (p: Vector3) => Math.hypot(p.x - centre.x, p.z - centre.z);
    expect(rayon(fin.oeil)).toBeCloseTo(rayon(debut.oeil), 5);
    expect(fin.devant.angleTo(centre.clone().sub(fin.oeil).normalize())).toBeLessThan(1e-4);
    // Avant le début et après la fin, la caméra reste immobile.
    expect(pose(bouge, cameraId, 0).oeil.distanceTo(debut.oeil)).toBeLessThan(1e-6);
    expect(pose(bouge, cameraId, 47).oeil.distanceTo(fin.oeil)).toBeLessThan(1e-6);
  });

  it('un nouveau mouvement remplace le précédent', () => {
    const { scene, cameraId } = plateau();
    const un = mouvementCamera(scene, cameraId, { type: 'grue_montee' });
    const deux = mouvementCamera(un, cameraId, { type: 'travelling_gauche', amplitude: 0.5 });
    const pistes = deux.animations.filter((t) => t.targetId === cameraId);
    expect(pistes.map((t) => t.propertyPath).sort()).toEqual([
      'transform.position',
      'transform.rotation',
    ]);
    // Le second repart de la pose de la frame 0, qui n'a pas bougé.
    const fin = pose(deux, cameraId, 47);
    expect(fin.oeil.y).toBeCloseTo(pose(scene, cameraId, 0).oeil.y, 6);
    expect(deux.cameras.find((c) => c.id === cameraId)?.lookAtTargetId).toBeNull();
  });
});
