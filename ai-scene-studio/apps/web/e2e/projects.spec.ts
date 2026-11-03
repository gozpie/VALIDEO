import { expect, test, type Page } from '@playwright/test';

/**
 * Parcours de la phase 1 contre la vraie pile (API, PostgreSQL, Redis). Le compte est créé au
 * préalable : `python -m ass_api.cli create-user --email … --password-stdin` (voir TESTING.md).
 */
const EMAIL = process.env['E2E_EMAIL'];
const PASSWORD = process.env['E2E_PASSWORD'];

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(EMAIL ?? '');
  await page.getByLabel('Mot de passe').fill(PASSWORD ?? '');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/workspaces$/);
}

test.describe('projets persistants', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');

  test('une page protégée renvoie vers la connexion', async ({ page }) => {
    await page.goto('/workspaces');
    await expect(page).toHaveURL(/\/login\?next=%2Fworkspaces$/);
  });

  test('un mauvais mot de passe est refusé', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(EMAIL ?? '');
    await page.getByLabel('Mot de passe').fill('mauvais mot de passe');
    await page.getByRole('button', { name: 'Se connecter' }).click();
    // Next.js ajoute son propre role="alert" (annonce des routes) : filtrer sur le message.
    await expect(
      page.getByRole('alert').filter({ hasText: 'E-mail ou mot de passe incorrect' }),
    ).toBeVisible();
  });

  test('créer un projet, ses séquences et ses plans, puis les retrouver', async ({ page }) => {
    const suffix = Date.now().toString(36);
    const workspaceName = `Studio E2E ${suffix}`;
    const projectName = `Pilote ${suffix}`;

    await login(page);
    await page.getByLabel('Nom').fill(workspaceName);
    await page.getByRole('button', { name: 'Créer' }).click();
    await page.getByRole('main').getByRole('link', { name: workspaceName }).click();

    await page.getByLabel('Nom du projet').fill(projectName);
    await page.getByLabel('Images par seconde').selectOption({ label: '25' });
    await page.getByRole('button', { name: 'Créer le projet' }).click();
    await page.getByRole('main').getByRole('link', { name: projectName }).click();
    // La carte ouvre le studio ; séquences et réglages sont dans « Structure et réglages ».
    await expect(page).toHaveURL(/\/studio$/);
    await page.getByRole('link', { name: 'Structure et réglages' }).click();
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    await expect(page.getByText('1920×1080 · 25 i/s · srgb')).toBeVisible();

    await page.getByLabel('Nom', { exact: true }).fill('Ouverture');
    await page.getByRole('button', { name: 'Ajouter la séquence' }).click();
    const sequence = page.getByRole('article', { name: 'Séquence Ouverture' });
    for (const [name, frames] of [
      ['Plan large', '50'],
      ['Gros plan', '25'],
    ] as const) {
      await sequence.getByLabel('Nouveau plan').fill(name);
      await sequence.getByLabel('Durée (frames)').fill(frames);
      await sequence.getByRole('button', { name: 'Ajouter le plan' }).click();
      await expect(sequence.getByText(name)).toBeVisible();
    }
    await expect(sequence.getByText('50 frames · 2,00 s · 25 i/s')).toBeVisible();
    await sequence.getByRole('button', { name: 'Monter Gros plan' }).click();
    await expect(sequence.getByRole('listitem').first()).toContainText('Gros plan');

    // Rechargement complet : tout vient de la base.
    await page.reload();
    const reloaded = page.getByRole('article', { name: 'Séquence Ouverture' });
    await expect(reloaded.getByRole('listitem').first()).toContainText('Gros plan');
    await expect(reloaded.getByRole('listitem').nth(1)).toContainText('Plan large');

    // Nouvelle session : le projet est retrouvé.
    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/login/);
    await login(page);
    await page.getByRole('main').getByRole('link', { name: workspaceName }).click();
    await expect(page.getByRole('main').getByRole('link', { name: projectName })).toBeVisible();
  });
});
