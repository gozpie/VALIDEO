import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, createShot } from './helpers';

/**
 * Phase 5 : panneau IA contre la vraie pile et le worker IA. Le fournisseur « simulation » est
 * gratuit et sans IA ; le test Claude (abonnement) ne s'exécute qu'avec E2E_CLAUDE=1.
 */
test.describe('génération IA depuis l’éditeur', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');
  test.setTimeout(180_000);

  test('générer une image simulée et la reprendre en référence', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const shotId = await createShot(page);
    await page.goto(`/shots/${shotId}/editor`);
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
    await page
      .getByRole('region', { name: 'Ajouter' })
      .getByRole('button', { name: 'Cube' })
      .click();

    await page.getByRole('tab', { name: 'IA' }).click();
    const panel = page.getByRole('region', { name: 'Génération IA' });
    await panel.getByRole('radio', { name: 'Simulation image' }).click();
    await expect(panel.getByRole('radio', { name: 'Simulation image' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await panel.getByPlaceholder(/Décrivez le plan/).fill('Un cube blanc sur fond noir');
    await expect(panel.getByTestId('ai-cost')).toBeVisible();
    await panel.getByRole('button', { name: 'Générer', exact: true }).click();

    // La génération enregistre d'abord la scène, puis le worker publie l'image.
    await expect(page.getByRole('status')).toHaveText('Enregistré');
    const card = panel.getByTestId('generation').first();
    await expect(card).toHaveAttribute('aria-label', 'Image — Terminé', { timeout: 120_000 });
    const image = card.getByRole('img', { name: 'Résultat Image' });
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);

    await card.hover();
    await card.getByRole('button', { name: 'Référence' }).click();
    await expect(panel.getByRole('img', { name: 'Référence' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('assistant de scène Claude : proposer puis appliquer', async ({ page }) => {
    test.skip(process.env['E2E_CLAUDE'] !== '1', 'E2E_CLAUDE=1 requis (abonnement Claude)');
    const shotId = await createShot(page);
    await page.goto(`/shots/${shotId}/editor`);
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
    await page
      .getByRole('region', { name: 'Ajouter' })
      .getByRole('button', { name: 'Cube' })
      .click();
    await page.getByRole('tab', { name: 'IA' }).click();
    const panel = page.getByRole('region', { name: 'Génération IA' });
    await panel.getByRole('radio', { name: 'Claude Sonnet' }).click();
    await panel.getByRole('radio', { name: 'Assistant de scène' }).click();
    await panel
      .getByRole('textbox')
      .first()
      .fill('Ajoute une sphère nommée « Lune » à deux mètres à gauche du cube, posée au sol');
    await panel.getByRole('button', { name: 'Proposer les modifications' }).click();
    const card = panel.getByTestId('generation').first();
    await expect(card).toHaveAttribute('aria-label', 'Assistant de scène — Terminé', {
      timeout: 170_000,
    });
    await card.getByRole('button', { name: 'Appliquer à la scène' }).click();
    await expect(
      page.getByRole('tree', { name: 'Objets' }).getByRole('treeitem', { name: 'Lune' }),
    ).toBeVisible();
  });
});
