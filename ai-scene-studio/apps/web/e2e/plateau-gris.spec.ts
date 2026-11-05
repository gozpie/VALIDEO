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

    // 3. L'image depuis cette caméra, avec le moteur simulé. La scène s'enregistre d'elle-même.
    await page.getByRole('tab', { name: 'IA' }).click();
    const section = page.getByRole('region', { name: 'Depuis la caméra' });
    await section.getByLabel('Décrire l’image').fill('Elle attend, seule dans la pièce.');
    await section.getByLabel('Modèle — Générer l’image depuis cette caméra').selectOption({
      label: 'Simulation image',
    });
    await section.getByRole('button', { name: 'Générer l’image depuis cette caméra' }).click();

    // 4. L'image obtenue s'anime ; rien n'est lancé sans y toucher.
    const animer = section.getByRole('button', { name: 'Animer cette image' });
    await expect(animer).toBeVisible({ timeout: 180_000 });
    await section.getByLabel('Décrire le mouvement').fill('Elle tourne lentement la tête.');
    await section.getByLabel('Modèle — Animer cette image').selectOption({
      label: 'Simulation vidéo',
    });
    // Le coût affiché doit être celui du moteur choisi avant d'envoyer.
    await expect(section.getByTestId('studio-cost').last()).toContainText('Simulation locale');
    await expect(animer).toBeEnabled({ timeout: 20_000 });
    await animer.click();
    await expect(page.getByText(/Génération terminée : Image → vidéo/)).toBeVisible({
      timeout: 60_000,
    });

    expect(errors).toEqual([]);
  });
});
