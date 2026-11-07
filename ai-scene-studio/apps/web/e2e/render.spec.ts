import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, createShot, formesSimples } from './helpers';

/** Phase 4 : raccourcis façon Blender et rendu final par le worker Blender, jusqu'à la vidéo et au .blend. */
test.describe('rendu Blender et raccourcis façon Blender', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');
  test.setTimeout(240_000);

  test('composer au clavier façon Blender puis rendre le plan', async ({ page }) => {
    const shotId = await createShot(page, 24);
    await page.goto(`/shots/${shotId}/editor`);
    const tree = page.getByRole('tree', { name: 'Objets' });
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
    await expect(page.getByLabel('Disposition des raccourcis')).toHaveValue('blender');

    // Maj+A : menu d'ajout ; Maj+D : dupliquer ; X : supprimer ; Ctrl+Z : annuler.
    await page.keyboard.press('Shift+A');
    await page
      .getByRole('dialog', { name: 'Menu d’ajout' })
      .getByRole('button', { name: 'Cube' })
      .click();
    await expect(tree.getByRole('treeitem', { name: 'Cube', exact: true })).toBeVisible();
    await page.keyboard.press('Shift+D');
    await expect(tree.getByRole('treeitem', { name: 'Cube copie' })).toBeVisible();
    await page.keyboard.press('x');
    await expect(tree.getByRole('treeitem', { name: 'Cube copie' })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(tree.getByRole('treeitem', { name: 'Cube copie' })).toBeVisible();

    // Alt+G : position remise à zéro ; I : clé de la sélection.
    await tree.getByRole('treeitem', { name: 'Cube', exact: true }).click();
    await page.keyboard.press('Alt+g');
    await expect(page.getByLabel('Position Y')).toHaveValue('0');
    await page.keyboard.press('i');
    await expect(
      page
        .getByRole('region', { name: 'Timeline' })
        .getByRole('button', { name: 'Clé Position frame 0' }),
    ).toBeVisible();

    // Caméra (devient active) puis rendu à 10 % : vidéo et scène .blend publiées.
    await (await formesSimples(page)).getByRole('button', { name: 'Caméra', exact: true }).click();
    await page.getByRole('tab', { name: 'Rendu' }).click();
    const panel = page.getByRole('region', { name: 'Rendu Blender' });
    await panel.getByLabel('Frame de fin').fill('1');
    await panel.getByLabel('Frame de fin').press('Enter');
    await panel.getByLabel('Résolution').selectOption('10');
    await panel.getByLabel('Échantillons').fill('2');
    await panel.getByLabel('Échantillons').press('Enter');
    await panel.getByRole('button', { name: 'Enregistrer et lancer le rendu' }).click();
    await expect(panel.getByRole('article', { name: 'Rendu Terminé' })).toBeVisible({
      timeout: 200_000,
    });
    await expect(panel.getByLabel('Vidéo du rendu')).toBeVisible();
    const blend = panel.getByRole('link', { name: 'Scène Blender (.blend)' });
    await expect(blend).toHaveAttribute('href', /\/assets\/.+\/content$/);
    const response = await page.request.get((await blend.getAttribute('href')) ?? '');
    expect(response.ok()).toBe(true);
    expect((await response.body()).length).toBeGreaterThan(1000);
  });
});
