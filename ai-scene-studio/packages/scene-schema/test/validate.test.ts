import { describe, expect, it } from 'vitest';
import { createEmptyScene, validateScene, type SceneDocument } from '../src';
import { loadSceneFixture } from './fixtures';

const clone = <T>(value: T): T => structuredClone(value);

function animated(): SceneDocument {
  const result = validateScene(loadSceneFixture('cube-camera-animated.v2.json'));
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  return result.data;
}

function expectIssue(scene: unknown, pathFragment: string, messageFragment: string): void {
  const result = validateScene(scene);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining(pathFragment),
          message: expect.stringContaining(messageFragment),
        }),
      ]),
    );
  }
}

describe('validateScene — fixtures valides', () => {
  it.each(['empty.v2.json', 'cube-camera-animated.v2.json'])('accepte %s', (name) => {
    const result = validateScene(loadSceneFixture(name));
    expect(result.success ? [] : result.issues).toEqual([]);
  });

  it('accepte une scène vide créée par la fabrique', () => {
    const scene = createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000aa' });
    expect(validateScene(scene).success).toBe(true);
  });

  it('représente exactement 23.976 i/s en rationnel', () => {
    expect(animated().fps).toEqual({ numerator: 24000, denominator: 1001 });
  });
});

describe('validateScene — règles structurelles', () => {
  it('refuse un quaternion non normalisé', () => {
    const scene = clone(animated());
    scene.nodes[1]!.transform.rotation = [0, 0.5, 0, 0.5];
    expectIssue(scene, 'nodes.1.transform.rotation', 'normalisé');
  });

  it('refuse une frame non entière', () => {
    const scene = clone(animated()) as unknown as {
      animations: { keyframes: { frame: number }[] }[];
    };
    scene.animations[0]!.keyframes[1]!.frame = 47.5;
    expectIssue(scene, 'animations.0.keyframes.1.frame', '');
  });

  it('refuse une version de schéma inconnue', () => {
    expectIssue({ ...animated(), schemaVersion: 3 }, 'schemaVersion', '');
  });

  it("refuse une convention d'axes différente", () => {
    const scene = {
      ...animated(),
      coordinateSystem: { handedness: 'right', upAxis: '+Z', forwardAxis: '-Z' },
    };
    expectIssue(scene, 'coordinateSystem.upAxis', '');
  });
});

describe('validateScene — intégrité référentielle', () => {
  it('refuse les identifiants dupliqués entre collections', () => {
    const scene = clone(animated());
    scene.cameras[0]!.id = scene.nodes[0]!.id;
    expectIssue(scene, 'cameras.0.id', 'dupliqué');
  });

  it('refuse un parent inexistant', () => {
    const scene = clone(animated());
    scene.nodes[1]!.parentId = '99999999-0000-4000-8000-000000000000';
    expectIssue(scene, 'nodes.1.parentId', 'Parent inexistant');
  });

  it('détecte un cycle de parentage', () => {
    const scene = clone(animated());
    scene.nodes[0]!.parentId = scene.nodes[1]!.id;
    expectIssue(scene, 'nodes.0.parentId', 'Cycle');
  });

  it('refuse un override vers un matériau inexistant', () => {
    const scene = clone(animated());
    scene.materials = [];
    expectIssue(scene, 'nodes.1.materialOverrides.0.materialId', 'Matériau inexistant');
  });

  it('refuse une primitive sans type de primitive', () => {
    const scene = clone(animated());
    scene.nodes[1]!.primitive = null;
    expectIssue(scene, 'nodes.1.primitive', 'primitive');
  });

  it('refuse un modèle sans asset', () => {
    const scene = clone(animated());
    scene.nodes[1]!.type = 'model';
    scene.nodes[1]!.primitive = null;
    expectIssue(scene, 'nodes.1.assetId', 'asset');
  });

  it('refuse deux passIndex identiques', () => {
    const scene = clone(animated());
    scene.nodes[0]!.passIndex = 1;
    expectIssue(scene, 'nodes.1.passIndex', 'déjà utilisé');
  });
});

describe('validateScene — caméras, lumières et rendu', () => {
  it('refuse farClip <= nearClip', () => {
    const scene = clone(animated());
    scene.cameras[0]!.farClip = 0.05;
    expectIssue(scene, 'cameras.0.farClip', 'nearClip');
  });

  it('exige orthographicHeight en orthographique', () => {
    const scene = clone(animated());
    scene.cameras[0]!.projection = 'orthographic';
    expectIssue(scene, 'cameras.0.orthographicHeight', 'orthographique');
  });

  it('exige les angles de cône pour un spot', () => {
    const scene = clone(animated());
    scene.lights[0]!.kind = 'spot';
    expectIssue(scene, 'lights.0.outerConeAngle', 'spot');
  });

  it('refuse une plage de rendu hors durée', () => {
    const scene = clone(animated());
    scene.renderSettings.frameEnd = 96;
    expectIssue(scene, 'renderSettings.frameEnd', 'durationFrames');
  });
});

describe('validateScene — animation', () => {
  it('refuse une cible inexistante', () => {
    const scene = clone(animated());
    scene.animations[0]!.targetId = '99999999-0000-4000-8000-000000000000';
    expectIssue(scene, 'animations.0.targetId', 'Cible inexistante');
  });

  it('refuse une propriété non animable', () => {
    const scene = clone(animated());
    scene.animations[0]!.propertyPath = 'transform.skew';
    expectIssue(scene, 'animations.0.propertyPath', 'non animable');
  });

  it('refuse une propriété incompatible avec la cible', () => {
    const scene = clone(animated());
    scene.animations[1]!.targetId = scene.nodes[1]!.id;
    expectIssue(scene, 'animations.1.propertyPath', 'pas applicable');
  });

  it('refuse des keyframes non triés', () => {
    const scene = clone(animated());
    scene.animations[1]!.keyframes[1]!.frame = 0;
    expectIssue(scene, 'animations.1.keyframes.1.frame', 'croissante');
  });

  it('refuse une valeur du mauvais type', () => {
    const scene = clone(animated());
    scene.animations[1]!.keyframes[0]!.value = [1, 2, 3];
    expectIssue(scene, 'animations.1.keyframes.0.value', 'scalar');
  });

  it('refuse Bézier sur une rotation', () => {
    const scene = clone(animated());
    scene.animations[2]!.keyframes[0]!.interpolation = 'bezier';
    expectIssue(scene, 'animations.2.keyframes.0.interpolation', 'Bézier');
  });

  it('refuse une poignée de dimension incorrecte', () => {
    const scene = clone(animated());
    scene.animations[0]!.keyframes[0]!.outHandle = { frameOffset: 4, valueOffset: [1] };
    expectIssue(scene, 'animations.0.keyframes.0.outHandle.valueOffset', '3 composante');
  });
});
