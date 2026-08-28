import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * Tests de bout en bout (§102).
 *
 * Le navigateur préinstallé du conteneur de développement est utilisé QUAND IL
 * EXISTE. Le chemin était codé en dur, ce qui rendait la suite inexécutable
 * partout ailleurs -- sur un poste de développement, Playwright échouait en
 * cherchant un exécutable absent au lieu d'utiliser celui qu'il a lui-même
 * installé. On ne force donc le chemin que s'il est là.
 */
const CHROMIUM_PREINSTALLE = '/opt/pw-browsers/chromium';
const navigateurLocal = existsSync(CHROMIUM_PREINSTALLE);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: [['list']],
  // Les attributs de test du projet sont `data-test`, pas `data-testid`.
  use: {
    testIdAttribute: 'data-test',
    baseURL: 'http://localhost:4188',
    viewport: { width: 1600, height: 1000 },
    ...(navigateurLocal ? { launchOptions: { executablePath: CHROMIUM_PREINSTALLE } } : {}),
  },
  webServer: {
    command:
      'pnpm --filter @valideo/web run build && pnpm --filter @valideo/web exec vite preview --port 4188 --strictPort',
    port: 4188,
    // Surtout PAS de réutilisation : un serveur d'aperçu resté en vie d'une
    // exécution précédente sert l'ancien bundle, et les tests valident alors du
    // code qui n'existe plus. Le coût est une reconstruction de quelques
    // secondes ; le risque évité est de croire vert ce qui est rouge.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
