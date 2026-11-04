import { expect, test, type Page } from '@playwright/test';
import { API_URL, EMAIL, PASSWORD } from './helpers';

/**
 * Phase 7.2 : le montage contre la vraie pile. Le film s'assemble tout seul à partir des plans,
 * survit au rechargement, et suit le studio quand un plan reçoit une version.
 */

// PNG 16×9 opaque, bleu.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR4nGPQiDpBEmIY1TAoNAAAk1q5oYIl8kcAAAAASUVORK5CYII=',
  'base64',
);

async function createFilm(page: Page) {
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
  const workspace = await post('/workspaces', { name: `Montage E2E ${Date.now().toString(36)}` });
  const project = await post(`/workspaces/${workspace.id}/projects`, {
    name: 'Le phare',
    fps: { numerator: 24, denominator: 1 },
  });
  const sequence = await post(`/projects/${project.id}/sequences`, { name: 'La tempête' });
  const shot = (name: string, durationFrames: number) =>
    post(`/sequences/${sequence.id}/shots`, { name, durationFrames });
  const marc = await shot('Marc rallume la lampe', 96);
  const mer = await shot('La mer se déchaîne', 72);
  const lea = await shot('Léa monte', 48);

  /** Dépose une image (contenu unique) et en fait une nouvelle version du plan. */
  const addVersion = async (shotId: string, variant: number) => {
    const content = Buffer.concat([PNG, Buffer.from([variant])]);
    const upload = await page.request.post(`${API_URL}/projects/${project.id}/edit/media`, {
      headers,
      multipart: {
        file: { name: `version-${variant}.png`, mimeType: 'image/png', buffer: content },
      },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const { asset } = (await upload.json()) as { asset: { id: string } };
    await post(`/shots/${shotId}/versions`, { assetId: asset.id });
  };
  const videoClips = async () => {
    const edit = (await (
      await page.request.get(`${API_URL}/projects/${project.id}/edit`)
    ).json()) as {
      document: {
        sequences: {
          tracks: {
            kind: string;
            index: number;
            clips: { kind: string; start: number; duration: number; name: string }[];
          }[];
        }[];
      } | null;
    };
    const track = edit.document?.sequences[0]?.tracks.find(
      (t) => t.kind === 'video' && t.index === 0,
    );
    return track?.clips ?? [];
  };
  return { projectId: project.id, marc, mer, lea, addVersion, videoClips };
}

test.describe('montage du film', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');
  test.setTimeout(120_000);

  test('le film s’assemble, se monte, survit au rechargement et suit le studio', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const film = await createFilm(page);
    await film.addVersion(film.marc.id, 1);
    await film.addVersion(film.lea.id, 2);

    // 1. Le film s'assemble tout seul : deux plans, et une attente à la place du troisième.
    await page.goto(`/projects/${film.projectId}/studio#montage`);
    const plans = page.locator('[data-test="plans-du-film"]');
    await expect(plans.locator('li')).toHaveCount(3, { timeout: 30_000 });
    await expect(plans).toContainText('À générer');
    await expect
      .poll(async () => (await film.videoClips()).map((c) => [c.kind, c.start, c.duration]), {
        timeout: 20_000,
      })
      .toEqual([
        ['video', 0, 96],
        ['colorMatte', 96, 72],
        ['video', 168, 48],
      ]);
    await expect(page.locator('[data-test="etat-film"]')).toHaveText('Enregistré');

    // 2. L'image du plan s'affiche dans le moniteur (décodée, pts 0).
    await expect(page.locator('[data-test="image-programme"]')).toHaveAttribute('data-pts', '0');

    // 3. ⌘K coupe sous la tête (et n'ouvre pas la palette) ; l'annulation revient en arrière.
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: /commande/i })).toHaveCount(0);
    await expect.poll(async () => (await film.videoClips()).length, { timeout: 10_000 }).toBe(4);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await film.videoClips()).length, { timeout: 10_000 }).toBe(3);

    // 4. Rechargement : le montage revient tel quel, sans plan en double, et les images reviennent.
    await expect(page.locator('[data-test="etat-film"]')).toHaveText('Enregistré');
    await page.reload();
    await expect(plans.locator('li')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.locator('[data-test="image-programme"]')).toHaveAttribute('data-pts', '0', {
      timeout: 15_000,
    });
    expect((await film.videoClips()).length).toBe(3);

    // 5. Le plan attendu reçoit sa version : au retour sur le montage, l'attente est remplacée.
    await film.addVersion(film.mer.id, 3);
    const steps = page.getByRole('complementary', { name: 'Navigation' });
    await steps.getByRole('button', { name: /Plans/ }).click();
    await steps.getByRole('button', { name: /Montage/ }).click();
    await expect(page.getByText('Film : 1 plan mis à jour')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await film.videoClips()).map((c) => [c.kind, c.start, c.duration]), {
        timeout: 15_000,
      })
      .toEqual([
        ['video', 0, 96],
        ['video', 96, 72],
        ['video', 168, 48],
      ]);
    await expect(plans).not.toContainText('À générer');

    expect(errors).toEqual([]);
  });
});
