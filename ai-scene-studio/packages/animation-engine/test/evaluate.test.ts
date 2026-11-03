import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateScene, type AnimationTrack, type SceneDocument } from '@ass/scene-schema';
import { EASINGS, evaluateScene, evaluateTrack, slerp, type Quat } from '../src';

const FIXTURES = new URL('../../../tests/fixtures/', import.meta.url);
const load = <T>(path: string): T =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, FIXTURES)), 'utf8')) as T;

function track(
  partial: Partial<AnimationTrack> & Pick<AnimationTrack, 'keyframes'>,
): AnimationTrack {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    targetId: '00000000-0000-4000-8000-000000000002',
    propertyPath: 'light.intensity',
    valueType: 'scalar',
    extrapolation: 'constant',
    ...partial,
  };
}
const key = (
  frame: number,
  value: AnimationTrack['keyframes'][number]['value'],
  interpolation: AnimationTrack['keyframes'][number]['interpolation'] = 'linear',
) => ({
  frame,
  value,
  interpolation,
  inHandle: null,
  outHandle: null,
});

describe('interpolations', () => {
  it('passe exactement par les clés et interpole linéairement', () => {
    const t = track({ keyframes: [key(0, 0), key(10, 100), key(20, 50)] });
    expect(evaluateTrack(t, 0)).toBe(0);
    expect(evaluateTrack(t, 10)).toBe(100);
    expect(evaluateTrack(t, 5)).toBe(50);
    expect(evaluateTrack(t, 15)).toBe(75);
    expect(evaluateTrack(t, 2.5)).toBe(25);
  });

  it('maintient la valeur en step et applique les courbes ease', () => {
    expect(evaluateTrack(track({ keyframes: [key(0, 0, 'step'), key(10, 1)] }), 9.99)).toBe(0);
    for (const [name, curve] of Object.entries(EASINGS)) {
      const t = track({ keyframes: [key(0, 0, name as keyof typeof EASINGS), key(10, 1)] });
      expect(evaluateTrack(t, 3)).toBeCloseTo(curve(0.3), 12);
      expect(curve(0)).toBe(0);
      expect(curve(1)).toBe(1);
    }
    expect(EASINGS.ease_in_out(0.5)).toBe(0.5);
  });

  it('évalue une Bézier sans poignée comme une droite et respecte les poignées', () => {
    const straight = track({ keyframes: [key(0, 0, 'bezier'), key(30, 30)] });
    expect(evaluateTrack(straight, 12) as number).toBeCloseTo(12, 9);
    const eased = track({
      keyframes: [
        { ...key(0, 0, 'bezier'), outHandle: { frameOffset: 10, valueOffset: [0] } },
        { ...key(30, 30), inHandle: { frameOffset: -10, valueOffset: [0] } },
      ],
    });
    expect(evaluateTrack(eased, 15) as number).toBeCloseTo(15, 9); // symétrique
    expect(evaluateTrack(eased, 3) as number).toBeLessThan(3); // départ lent
  });

  it('interpole les rotations par slerp, par le plus court chemin', () => {
    const half = Math.SQRT1_2;
    const a: Quat = [0, 0, 0, 1];
    const b: Quat = [0, half, 0, half]; // 90° autour de Y
    const mid = slerp(a, b, 0.5);
    expect(mid[1]).toBeCloseTo(Math.sin(Math.PI / 8), 12);
    expect(Math.hypot(...mid)).toBeCloseTo(1, 12);
    const opposite = slerp(a, [0, -half, 0, -half], 0.5); // même rotation, signe inversé
    expect(opposite[1]).toBeCloseTo(mid[1], 12);
  });

  it('extrapole en constant, linéaire et cycle', () => {
    const keys = [key(10, 0), key(20, 10)];
    expect(evaluateTrack(track({ keyframes: keys }), 0)).toBe(0);
    expect(evaluateTrack(track({ keyframes: keys }), 30)).toBe(10);
    expect(evaluateTrack(track({ keyframes: keys, extrapolation: 'linear' }), 25)).toBe(15);
    expect(evaluateTrack(track({ keyframes: keys, extrapolation: 'linear' }), 5)).toBe(-5);
    expect(evaluateTrack(track({ keyframes: keys, extrapolation: 'cycle' }), 25)).toBe(5);
    expect(evaluateTrack(track({ keyframes: keys, extrapolation: 'cycle' }), 5)).toBe(5);
    expect(evaluateTrack(track({ keyframes: [key(3, 7)] }), 100)).toBe(7);
  });

  it('booléens en step', () => {
    const t = track({
      propertyPath: 'visible',
      valueType: 'boolean',
      keyframes: [key(0, true, 'step'), key(10, false, 'step')],
    });
    expect(evaluateTrack(t, 9)).toBe(true);
    expect(evaluateTrack(t, 10)).toBe(false);
  });
});

describe('evaluateScene', () => {
  const scene = validateScene(load('scenes/cube-camera-animated.v2.json'));
  if (!scene.success) throw new Error('fixture invalide');
  const document = scene.data;
  const FRAMES = [-5, 0, 1, 12, 24, 30.5, 47, 48, 60, 95, 200];

  function snapshot(doc: SceneDocument) {
    return Object.fromEntries(
      FRAMES.map((frame) => {
        const evaluated = evaluateScene(doc, frame);
        return [
          String(frame),
          {
            cube: evaluated.nodes[1]!.transform,
            camera: {
              transform: evaluated.cameras[0]!.transform,
              focalLengthMm: evaluated.cameras[0]!.focalLengthMm,
            },
          },
        ];
      }),
    );
  }

  it('anime le roulis d’une caméra', () => {
    const doc = structuredClone(document);
    doc.animations.push({
      id: '00000000-0000-4000-8000-0000000000f1',
      targetId: doc.cameras[0]!.id,
      propertyPath: 'camera.rollRadians',
      valueType: 'scalar',
      extrapolation: 'constant',
      keyframes: [key(0, 0), key(10, 1)],
    });
    expect(evaluateScene(doc, 5).cameras[0]!.rollRadians).toBe(0.5);
  });

  it('ne modifie pas la scène d’entrée et reste valide', () => {
    const before = structuredClone(document);
    const evaluated = evaluateScene(document, 30);
    expect(document).toEqual(before);
    expect(validateScene(evaluated).success).toBe(true);
  });

  it('est déterministe : mêmes valeurs à chaque évaluation et conformes à la référence', () => {
    const golden = 'animation/cube-camera-animated.expected.json';
    const computed = snapshot(document);
    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(
        fileURLToPath(new URL(golden, FIXTURES)),
        `${JSON.stringify(computed, null, 2)}\n`,
      );
    }
    expect(snapshot(document)).toEqual(computed);
    const expected = load<typeof computed>(golden);
    for (const frame of Object.keys(expected)) {
      const want = expected[frame]!;
      const got = computed[frame]!;
      expect(got.camera.focalLengthMm).toBeCloseTo(want.camera.focalLengthMm, 9);
      for (const field of ['position', 'rotation', 'scale'] as const) {
        got.cube[field].forEach((value, index) =>
          expect(value).toBeCloseTo(want.cube[field][index]!, 9),
        );
        got.camera.transform[field].forEach((value, index) =>
          expect(value).toBeCloseTo(want.camera.transform[field][index]!, 9),
        );
      }
    }
  });

  it('donne la même frame entière quelle que soit la séquence de lecture', () => {
    // Évaluer 24 directement ou après d'autres frames donne le même état (aucun état caché).
    const direct = evaluateScene(document, 24);
    for (const frame of [95, 3, 60, 24.0000001]) evaluateScene(document, frame);
    expect(evaluateScene(document, 24)).toEqual(direct);
  });
});
