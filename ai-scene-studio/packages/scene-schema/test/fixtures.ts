import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = new URL('../../../tests/fixtures/scenes/', import.meta.url);

/** Charge une fixture de scène partagée avec les tests Python. */
export function loadSceneFixture(name: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(name, FIXTURES_DIR));
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}
