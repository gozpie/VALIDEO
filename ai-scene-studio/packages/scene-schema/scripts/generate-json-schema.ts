/**
 * Génère le JSON Schema structurel de la scène à partir du schéma Zod.
 * Ce fichier est consommé par le backend Python (validation structurelle) : le regénérer
 * après toute modification de src/scene.ts (`pnpm schema:generate`).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildJsonSchema } from '../src/json-schema';

const content = `${JSON.stringify(buildJsonSchema(), null, 2)}\n`;
// Copie embarquée dans le package Python de l'API (image Docker autonome) ; un test vérifie l'égalité.
for (const relative of [
  '../schema/scene.v1.schema.json',
  '../../../apps/api/src/ass_api/scenes/scene.v1.schema.json',
]) {
  const target = fileURLToPath(new URL(relative, import.meta.url));
  writeFileSync(target, content);
  console.warn(`JSON Schema écrit dans ${target}`);
}
