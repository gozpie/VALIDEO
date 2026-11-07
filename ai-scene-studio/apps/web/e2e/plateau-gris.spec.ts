import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, createShot } from './helpers';

/**
 * La chaîne du plateau gris avec le moteur simulé (aucune IA, aucun coût) : mannequin, caméras
 * préréglées, image depuis la caméra active, puis animation de cette image.
 */
test.describe('plateau gris', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');
  test.setTimeout(240_000);

  test('mannequin, caméras, image depuis la caméra, puis vidéo', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const shotId = await createShot(page, 48);
    await page.goto(`/shots/${shotId}/editor`);
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();

    // 1. Le mannequin en un clic.
    const ajouter = page.getByRole('region', { name: 'Ajouter' });
    await ajouter.getByRole('button', { name: 'Mannequin Personnage' }).click();
    const objets = page.getByRole('tree', { name: 'Objets' });
    await expect(objets.getByText('Mannequin - Personnage')).toBeVisible();

    // 2. Deux caméras préréglées : la vue caméra s'ouvre, on passe de l'une à l'autre.
    await ajouter.getByRole('button', { name: 'Plan moyen' }).click();
    await expect(page.getByTestId('camera-view')).toBeVisible();
    await ajouter.getByRole('button', { name: 'Gros plan' }).click();
    const bande = page.getByRole('group', { name: 'Caméras du plateau' });
    const moyen = bande.getByRole('button', { name: /Plan moyen/ });
    const gros = bande.getByRole('button', { name: /Gros plan/ });
    await expect(gros).toHaveAttribute('aria-pressed', 'true');
    await moyen.click();
    await expect(moyen).toHaveAttribute('aria-pressed', 'true');

    // 2 bis. Un mouvement de caméra en un clic : la caméra active reçoit ses clés.
    await expect(page.getByText(/Aucune animation/)).toBeVisible();
    const mouvement = ajouter.getByRole('group', { name: 'Mouvement de caméra' });
    await mouvement.getByLabel('Mouvement', { exact: true }).selectOption('travelling_avant');
    await mouvement.getByRole('button', { name: 'Appliquer à la caméra active' }).click();
    await expect(page.getByText(/Aucune animation/)).toHaveCount(0);

    // 3. Étape 1, l'image depuis cette caméra (moteur simulé). La scène s'enregistre d'elle-même.
    await page.getByRole('tab', { name: 'IA' }).click();
    const image = page.getByRole('region', { name: 'Étape 1 — Image' });
    await image.getByLabel('Décrire la scène').fill('Elle attend, seule dans la pièce.');
    await image.getByText(/^Moteur :/).click();
    await image.getByLabel('Modèle — Créer l’image').selectOption({ label: 'Simulation image' });
    await image.getByRole('button', { name: 'Créer l’image' }).click();
    await expect(image.getByRole('button', { name: 'Garder l’image 1' })).toHaveAttribute(
      'aria-pressed',
      'true',
      { timeout: 180_000 },
    );

    // 4. Étape 2, la vidéo qui suit le plateau : la vidéo grise s'enregistre toute seule.
    const video = page.getByRole('region', { name: 'Étape 2 — Vidéo' });
    await expect(video.getByLabel('Suivre le plateau')).toBeChecked();
    await expect(video.getByText('Caméra en mouvement · 2 s')).toBeVisible();
    await video.getByLabel('Ce qui se passe').fill('Elle tourne lentement la tête.');
    await video.getByRole('radio', { name: /Essai/ }).click();
    await video.getByText(/^Moteur :/).click();
    await video.getByLabel('Modèle — Créer la vidéo').selectOption({ label: 'Simulation vidéo' });
    // Le coût affiché doit être celui du moteur choisi avant d'envoyer.
    await expect(video.getByTestId('studio-cost')).toContainText('Simulation locale');
    const creer = video.getByRole('button', { name: /Créer la vidéo/ });
    await expect(creer).toBeEnabled({ timeout: 20_000 });
    await creer.click();
    const resultats = page.getByRole('list', { name: 'Générations' });
    await expect(
      resultats
        .getByRole('listitem', { name: 'Image → vidéo — Terminé' })
        .filter({ hasText: 'Recreate @video1' }),
    ).toBeVisible({ timeout: 90_000 });

    expect(errors).toEqual([]);
  });
});
