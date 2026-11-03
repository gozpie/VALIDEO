import { describe, expect, it } from 'vitest';
import { validateScene } from '../src';
import { loadSceneFixture } from './fixtures';

interface SharedCase {
  name: string;
  set: { path: (string | number)[]; value: unknown }[];
  expectedPath: string;
}

const { base, cases } = loadSceneFixture('invalid-cases.json') as unknown as {
  base: string;
  cases: SharedCase[];
};

function apply(scene: Record<string, unknown>, path: (string | number)[], value: unknown) {
  let target = scene as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[path[path.length - 1]!] = value;
}

describe('cas invalides partagés avec le backend Python', () => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, sharedCase) => {
    const scene = structuredClone(loadSceneFixture(base));
    for (const { path, value } of sharedCase.set) apply(scene, path, value);
    const result = validateScene(scene);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => issue.path)).toContain(sharedCase.expectedPath);
    }
  });
});
