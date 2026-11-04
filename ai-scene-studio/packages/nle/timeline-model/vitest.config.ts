import { defineConfig } from 'vitest/config';

// Le test de robustesse enchaîne des milliers d'opérations aléatoires.
export default defineConfig({ test: { testTimeout: 60_000 } });
