import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['WEB_PORT'] ?? 3000);
/** Si E2E_BASE_URL est défini (ex. conteneur Docker déjà démarré), aucun serveur n'est lancé. */
const EXTERNAL_BASE_URL = process.env['E2E_BASE_URL'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: EXTERNAL_BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(EXTERNAL_BASE_URL
    ? {}
    : {
        webServer: {
          // L'E2E s'exécute sur le build de production, comme en déploiement.
          command: `pnpm build && pnpm start --port ${PORT}`,
          url: `http://localhost:${PORT}`,
          reuseExistingServer: !process.env['CI'],
          timeout: 180_000,
        },
      }),
});
