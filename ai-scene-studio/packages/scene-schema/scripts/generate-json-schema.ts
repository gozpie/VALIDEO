/**
 * Génère le JSON Schema structurel de la scène à partir du schéma Zod.
 * Ce fichier est consommé par le backend Python (validation structurelle) : le regénérer
 * après toute modification de src/scene.ts (`pnpm schema:generate`).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildJsonSchema } from '../src/json-schema';

const target = fileURLToPath(new URL('../schema/scene.v1.schema.json', import.meta.url));
writeFileSync(target, `${JSON.stringify(buildJsonSchema(), null, 2)}\n`);
console.warn(`JSON Schema écrit dans ${target}`);
