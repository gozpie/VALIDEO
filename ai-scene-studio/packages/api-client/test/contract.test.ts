import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { TYPES_URL, renderTypes } from '../scripts/render-types';

describe('types générés', () => {
  it('correspondent au contrat OpenAPI versionné', async () => {
    const committed = await readFile(TYPES_URL, 'utf8');
    // En cas d'échec : « pnpm api:generate » puis commiter openapi.json et schema.gen.ts.
    expect(committed).toBe(await renderTypes());
  });
});
