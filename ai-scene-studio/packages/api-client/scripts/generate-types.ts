import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TYPES_URL, renderTypes } from './render-types';

await writeFile(TYPES_URL, await renderTypes(), 'utf8');
process.stdout.write(`Types écrits dans ${fileURLToPath(TYPES_URL)}\n`);
