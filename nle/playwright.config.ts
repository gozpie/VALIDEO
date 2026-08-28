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
  use: {
    baseURL: 'http://localhost:4188',
    viewport: { width: 1600, height: 1000 },
    launchOptions: { executablePath: '/opt/pw-browsers/chromium' },
  },
  webServer: {
    command:
      'pnpm --filter @valideo/web run build && pnpm --filter @valideo/web exec vite preview --port 4188 --strictPort',
    port: 4188,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
