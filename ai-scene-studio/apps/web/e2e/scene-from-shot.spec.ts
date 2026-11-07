import { expect, test } from '@playwright/test';
import { API_URL, EMAIL, PASSWORD } from './helpers';

/**
 * Plan → scène 3D : la chaîne complète avec le moteur simulé (aucune IA) : lancement depuis le plan,
 * proposition, ouverture de l'éditeur, application, annulation. La qualité de ce que Claude propose
 * se juge avec le vrai moteur, pas ici.
 */

// PNG 16×9 opaque, bleu.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR4nGPQiDpBEmIY1TAoNAAAk1q5oYIl8kcAAAAASUVORK5CYII=',
  'base64',
);

test.describe('plan → scène 3D', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');
  test.setTimeout(120_000);

  test('une version du plan devient une proposition, appliquée dans l’éditeur', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
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
    const workspace = await post('/workspaces', { name: `Scène E2E ${Date.now().toString(36)}` });
    const project = await post(`/workspaces/${workspace.id}/projects`, {
      name: 'Le phare',
      fps: { numerator: 24, denominator: 1 },
    });
    const sequence = await post(`/projects/${project.id}/sequences`, { name: 'La tempête' });
    const shot = await post(`/sequences/${sequence.id}/shots`, {
      name: 'La mer se déchaîne',
      durationFrames: 96,
    });
    const upload = await page.request.post(`${API_URL}/projects/${project.id}/edit/media`, {
      headers,
      multipart: { file: { name: 'plan.png', mimeType: 'image/png', buffer: PNG } },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const { asset } = (await upload.json()) as { asset: { id: string } };
    await post(`/shots/${shot.id}/versions`, { assetId: asset.id });

    // Depuis la fabrication du plan, avec le moteur simulé.
    await page.goto(`/projects/${project.id}/studio#shots`);
    await page.getByRole('button', { name: 'Plan 1.1 — La mer se déchaîne', exact: true }).click();
    const drawer = page.getByRole('complementary', { name: 'Plan — La mer se déchaîne' });
    await drawer.getByRole('tab', { name: 'Fabrication' }).click();
    await drawer
      .getByLabel('Modèle — Créer la scène 3D')
      .selectOption({ label: 'Simulation scène' });
    await drawer.getByRole('button', { name: 'Créer la scène 3D' }).click();

    // La proposition n'ajoute aucune version au plan ; on l'ouvre dans l'éditeur, sur l'onglet IA.
    await expect(drawer.getByTestId('ouvrir-proposition-scene')).toBeVisible({ timeout: 60_000 });
    await drawer.getByTestId('ouvrir-proposition-scene').click();
    await expect(page).toHaveURL(new RegExp(`/shots/${shot.id}/editor#ia`));
    const apply = page.getByRole('button', { name: 'Appliquer à la scène' });
    await expect(apply).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("aucune IA n'a regardé les images")).toBeVisible();

    // Rien n'est appliqué sans le demander.
    const objets = page.getByRole('tree', { name: 'Objets' });
    await expect(objets.getByText('Volume simulé')).toHaveCount(0);
    await apply.click();
    await expect(objets.getByText('Volume simulé')).toBeVisible();
    await expect(objets.getByText('Caméra simulée')).toBeVisible();
    await expect(page.getByText(/opération\(s\) appliquée\(s\)/).first()).toBeVisible();

    // Le plateau s'ouvre vu de sa caméra, avec la photo du plan posée dessus.
    await expect(page.getByTestId('camera-view')).toBeVisible();
    const photo = page.getByTestId('photo-du-plan');
    await expect(photo).toBeVisible();
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect(photo).toHaveCSS('opacity', '0.5');
    await page.getByLabel('Opacité de la photo').fill('25');
    await expect(photo).toHaveCSS('opacity', '0.25');
    await page.getByLabel('Superposer l’image').uncheck();
    await expect(photo).toHaveCount(0);

    expect(errors).toEqual([]);
  });
});
