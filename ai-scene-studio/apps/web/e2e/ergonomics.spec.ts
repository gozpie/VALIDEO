import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, createShot } from './helpers';

/** Phase 5 : palette de commandes, menu contextuel, notification « Annuler », champs glissables, panneaux. */
test.describe('ergonomie de l’éditeur', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');

  test('palette, clic droit, annulation par notification, glisser un champ', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const shotId = await createShot(page);
    await page.goto(`/shots/${shotId}/editor`);
    const tree = page.getByRole('tree', { name: 'Objets' });
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();

    // ⌘K : recherche floue puis Entrée.
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Palette de commandes' });
    await palette.getByRole('combobox').fill('ajout cube');
    await expect(palette.getByRole('option').first()).toHaveText(/Ajouter : Cube/);
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    const cube = tree.getByRole('treeitem', { name: 'Cube', exact: true });
    await expect(cube).toHaveAttribute('aria-selected', 'true');

    // Glisser l'étiquette « Position X » : la valeur change, une seule annulation la rétablit.
    const label = page.getByText('Position X', { exact: true });
    const box = await label.boundingBox();
    if (!box) throw new Error('étiquette « Position X » invisible');
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++)
      await page.mouse.move(box.x + 5 + step * 4, box.y + box.height / 2);
    await page.mouse.up();
    await expect(page.getByLabel('Position X')).toHaveValue('1');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByLabel('Position X')).toHaveValue('0');

    // Expression dans un champ.
    await page.getByLabel('Position Y').fill('1.5*2');
    await page.getByLabel('Position Y').press('Enter');
    await expect(page.getByLabel('Position Y')).toHaveValue('3');

    // Clic droit → Supprimer, puis « Annuler » dans la notification.
    await cube.click({ button: 'right' });
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: /Supprimer/ })
      .click();
    await expect(cube).toHaveCount(0);
    const notice = page.getByTestId('toast').filter({ hasText: '« Cube » supprimé' });
    await notice.getByRole('button', { name: 'Annuler' }).click();
    await expect(cube).toBeVisible();

    // Panneau de gauche redimensionnable au clavier, taille mémorisée.
    const handle = page.getByRole('separator', { name: 'Largeur du panneau de gauche' });
    const before = Number(await handle.getAttribute('aria-valuenow'));
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 32));
    await page.reload();
    await expect(
      page.getByRole('separator', { name: 'Largeur du panneau de gauche' }),
    ).toHaveAttribute('aria-valuenow', String(before + 32));
    expect(errors).toEqual([]);
  });
});
