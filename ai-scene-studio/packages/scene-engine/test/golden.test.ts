import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateScene, type SceneDocument } from '@ass/scene-schema';
import { Vector3 } from 'three';
import { evaluateFrame, worldMatrix } from '../src';

/**
 * Référence inter-langages : états évalués (animation + contraintes) d'une scène avec hiérarchie, visée
 * et roulis animé. Le portage Python (rendu Blender) doit reproduire ces valeurs.
 */
const FIXTURES = new URL('../../../tests/fixtures/', import.meta.url);
const read = (path: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, FIXTURES)), 'utf8')) as unknown;
const FRAMES = [0, 7, 24, 39, 40, 41.5, 60, 70, 95, 130];

function snapshot(scene: SceneDocument) {
  return Object.fromEntries(
    FRAMES.map((frame) => {
      const evaluated = evaluateFrame(scene, frame);
      const entities = [...evaluated.nodes, ...evaluated.cameras, ...evaluated.lights];
      return [
        String(frame),
        Object.fromEntries(
          entities.map((entity) => [
            entity.id,
            {
              transform: entity.transform,
              world: new Vector3()
                .setFromMatrixPosition(worldMatrix(evaluated, entity.id))
                .toArray(),
              ...('visible' in entity ? { visible: entity.visible } : {}),
              ...('focalLengthMm' in entity
                ? { focalLengthMm: entity.focalLengthMm, rollRadians: entity.rollRadians }
                : {}),
            },
          ]),
        ),
      ];
    }),
  );
}

describe('référence inter-langages', () => {
  it('reproduit la référence look-at (hiérarchie, visée, roulis, visibilité)', () => {
    const result = validateScene(read('scenes/look-at.v2.json'));
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    const computed = JSON.parse(JSON.stringify(snapshot(result.data))) as Record<string, unknown>;
    const golden = 'animation/look-at.expected.json';
    if (process.env['UPDATE_GOLDEN'] === '1') {
      writeFileSync(
        fileURLToPath(new URL(golden, FIXTURES)),
        `${JSON.stringify(computed, null, 2)}\n`,
      );
    }
    const expected = read(golden) as Record<string, Record<string, Record<string, unknown>>>;
    for (const [frame, entities] of Object.entries(expected)) {
      for (const [id, values] of Object.entries(entities)) {
        const got = (computed[frame] as Record<string, Record<string, unknown>>)[id]!;
        expect(JSON.stringify(Object.keys(got))).toBe(JSON.stringify(Object.keys(values)));
        const flat = (value: unknown): number[] =>
          typeof value === 'number'
            ? [value]
            : typeof value === 'boolean'
              ? [Number(value)]
              : Array.isArray(value)
                ? value.flatMap(flat)
                : Object.values(value as object).flatMap(flat);
        flat(got).forEach((value, index) => expect(value).toBeCloseTo(flat(values)[index]!, 9));
      }
    }
  });
});
