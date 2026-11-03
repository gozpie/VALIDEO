import { expect, test, type Page } from '@playwright/test';
import { API_URL, EMAIL, PASSWORD } from './helpers';

/**
 * Phase 6 : studio de production contre la vraie pile. Génération simulée (gratuite) pour la
 * bible et les plans ; le découpage par Claude réel ne s'exécute qu'avec E2E_CLAUDE=1.
 */
async function createProject(page: Page): Promise<{ projectId: string; shotId: string }> {
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
  const workspace = await post('/workspaces', {
    name: `Studio de production E2E ${Date.now().toString(36)}`,
  });
  const project = await post(`/workspaces/${workspace.id}/projects`, {
    name: 'Le phare',
    fps: { numerator: 24, denominator: 1 },
  });
  const sequence = await post(`/projects/${project.id}/sequences`, { name: 'La tempête' });
  const shot = await post(`/sequences/${sequence.id}/shots`, {
    name: 'Marc rallume la lampe',
    durationFrames: 96,
    description: 'Plan rapproché : Marc, à gauche du cadre, force la manivelle.',
    shotSize: 'Plan rapproché',
  });
  return { projectId: project.id, shotId: shot.id };
}

test.describe('studio de production', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');
  test.setTimeout(180_000);

  test('script versionné, bible illustrée, plan généré, version retenue et A/B', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { projectId } = await createProject(page);
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('link', { name: /Ouvrir le studio de production/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/studio$`));
    const steps = page.getByRole('complementary', { name: 'Navigation' });

    // 1. Script : deux versions immuables.
    await page.getByLabel('Brief ou script').fill('INT. PHARE — NUIT\nMarc rallume la lampe.');
    await page.getByRole('button', { name: 'Enregistrer une version' }).click();
    await expect(page.getByRole('list', { name: 'Versions du script' })).toContainText('v1');
    await page
      .getByLabel('Brief ou script')
      .fill('INT. PHARE — NUIT\nMarc rallume la lampe.\nLéa monte.');
    await page.getByRole('button', { name: 'Enregistrer une version' }).click();
    await expect(
      page.getByRole('list', { name: 'Versions du script' }).getByRole('button'),
    ).toHaveCount(2);
    await expect(steps.getByRole('button', { name: /Script/ })).toContainText('v2');

    // 3. Bible : un personnage, sa fiche, son image (simulation).
    await steps.getByRole('button', { name: /Bible/ }).click();
    const characters = page.getByRole('region', { name: 'Personnages' });
    await characters.getByRole('button', { name: 'Ajouter : Personnage' }).click();
    await characters.getByLabel('Nom : Personnage').fill('Marc');
    await characters.getByRole('button', { name: 'Créer' }).click();
    const card = page.getByRole('article', { name: 'Marc' });
    await card.getByLabel('Prompt — Marc').fill('a 64-year-old lighthouse keeper, weathered face');
    await card.getByLabel('Fiche — Marc').click(); // sortie du champ : enregistrement
    await card.getByLabel('Modèle — Image').selectOption({ label: 'Simulation image' });
    await expect(card.getByTestId('studio-cost')).toContainText('Simulation');
    await card.getByRole('button', { name: 'Image', exact: true }).click();
    await expect(card.getByRole('img', { name: 'Image clé — Marc' })).toBeVisible({
      timeout: 120_000,
    });

    // 4. Plans : lier Marc, générer une image, la retenir, une 2e version, comparer A/B.
    await steps.getByRole('button', { name: /Plans/ }).click();
    await page.getByRole('button', { name: /Plan 1\.1 — Marc rallume la lampe/ }).click();
    const drawer = page.getByRole('complementary', { name: 'Plan — Marc rallume la lampe' });
    await drawer.getByRole('tab', { name: 'Dans le plan' }).click();
    await drawer.getByRole('button', { name: 'Marc', exact: true }).click();
    await expect(drawer.getByRole('button', { name: 'Marc', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await drawer.getByRole('tab', { name: 'Fabrication' }).click();
    await drawer.getByLabel('Modèle — Générer l’image').selectOption({ label: 'Simulation image' });
    await drawer.getByRole('button', { name: 'Générer l’image' }).click();
    const tree = drawer.getByRole('list', { name: 'Arbre des versions' });
    await expect(tree.getByText('v1', { exact: true })).toBeVisible({ timeout: 120_000 });
    await drawer.getByRole('button', { name: 'Retenir cette version' }).click();
    await expect(drawer.getByRole('button', { name: 'Version retenue' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Plan 1\.1/ }).getByRole('img', { name: /Version retenue/ }),
    ).toBeVisible();

    await drawer.getByRole('button', { name: 'Générer l’image' }).click();
    await expect(tree.getByText('v2', { exact: true })).toBeVisible({ timeout: 120_000 });
    await drawer.getByRole('button', { name: 'Comparer A/B' }).click();
    await expect(drawer.getByRole('img', { name: /Version A/ })).toBeVisible();
    await expect(drawer.getByRole('img', { name: /Version B/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Plan 1\.1/ })).toContainText('v1 / 2');
    expect(errors).toEqual([]);
  });

  test('Claude découpe le script puis le découpage s’applique au storyboard', async ({ page }) => {
    test.skip(process.env['E2E_CLAUDE'] !== '1', 'E2E_CLAUDE=1 requis (abonnement Claude)');
    test.setTimeout(600_000);
    const { projectId } = await createProject(page);
    await page.goto(`/projects/${projectId}/studio`);
    await page
      .getByLabel('Brief ou script')
      .fill(
        'INT. PHARE — NUIT\nMARC (64 ans) monte l’escalier, force la manivelle grippée : la lumière revient. Au large, un chalutier évite les récifs.',
      );
    await page.getByRole('button', { name: 'Enregistrer une version' }).click();
    await page.getByLabel('Consigne pour Claude').fill('Trois plans maximum.');
    await page.getByLabel('Modèle — Découper le film').selectOption({ label: 'Claude Opus' });
    await page.getByRole('button', { name: 'Découper le film' }).click();
    await page
      .getByTestId('toast')
      .getByRole('button', { name: 'Voir' })
      .click({ timeout: 540_000 });
    await expect(page.getByRole('heading', { name: 'Découpage proposé' })).toBeVisible();
    await page.getByRole('button', { name: 'Appliquer au storyboard' }).click();
    await expect(
      page.getByRole('region', { name: /tempête|Phare|phare|.+/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Plan 2\.1/ })).toBeVisible();
  });
});
