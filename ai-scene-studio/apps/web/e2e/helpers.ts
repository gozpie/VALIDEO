import { expect, type Page } from '@playwright/test';

export const EMAIL = process.env['E2E_EMAIL'];
export const PASSWORD = process.env['E2E_PASSWORD'];
export const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:8000';

/** Se connecte, crée workspace → projet → séquence → plan par l'API et renvoie l'ID du plan. */
export async function createShot(page: Page, durationFrames = 48): Promise<string> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL ?? '');
  await page.getByLabel('Mot de passe').fill(PASSWORD ?? '');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
  const session = await (await page.request.get(`${API_URL}/auth/session`)).json();
  const headers = { 'X-CSRF-Token': session.csrfToken as string };
  const post = async (path: string, data: object) => {
    const response = await page.request.post(`${API_URL}${path}`, { data, headers });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as { id: string };
  };
  const workspace = await post('/workspaces', { name: `Éditeur E2E ${Date.now().toString(36)}` });
  const project = await post(`/workspaces/${workspace.id}/projects`, {
    name: 'Pilote',
    fps: { numerator: 24, denominator: 1 },
  });
  const sequence = await post(`/projects/${project.id}/sequences`, { name: 'Ouverture' });
  const shot = await post(`/sequences/${sequence.id}/shots`, { name: 'Plan 1', durationFrames });
  return shot.id;
}
