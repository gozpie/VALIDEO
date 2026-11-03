import { readFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';

export const CONTRACT_URL = new URL('../openapi.json', import.meta.url);
export const TYPES_URL = new URL('../src/schema.gen.ts', import.meta.url);

const BANNER = `/**
 * Fichier généré depuis openapi.json par « pnpm api:generate ». Ne pas modifier à la main.
 */

`;

/** Types TypeScript du contrat OpenAPI de l'API (rendu déterministe). */
export async function renderTypes(): Promise<string> {
  const contract = JSON.parse(await readFile(CONTRACT_URL, 'utf8')) as Parameters<
    typeof openapiTS
  >[0];
  // defaultNonNullable: false — un champ d'entrée doté d'une valeur par défaut reste facultatif.
  const ast = await openapiTS(contract, { alphabetize: true, defaultNonNullable: false });
  return BANNER + astToString(ast);
}
