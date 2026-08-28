import { defineConfig } from '@playwright/test';

/**
 * Tests de bout en bout (§102).
 *
 * Le navigateur est celui préinstallé dans l'environnement : on ne télécharge
 * rien, on pointe l'exécutable directement.
 */
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
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
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
