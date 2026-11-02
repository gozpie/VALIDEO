import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildJsonSchema } from '../src/json-schema';

describe('JSON Schema exporté', () => {
  it('est à jour par rapport au schéma Zod (lancer `pnpm schema:generate` sinon)', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../schema/scene.v1.schema.json', import.meta.url), 'utf8'),
    ) as unknown;
    expect(committed).toEqual(buildJsonSchema());
  });
});
