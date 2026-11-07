import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, createShot, formesSimples } from './helpers';

/** Éditeur 3D contre la vraie pile : ajout, déplacement, annuler/rétablir, import GLB, sauvegarde, rechargement. */
const CUBE_GLB = fileURLToPath(new URL('../../../tests/fixtures/assets/cube.glb', import.meta.url));

test.describe('éditeur de scène 3D', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');

  test('ajouter, déplacer, annuler, importer, enregistrer et recharger', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const shotId = await createShot(page);
    await page.goto(`/shots/${shotId}/editor`);

    const status = page.getByRole('status');
    const tree = page.getByRole('tree', { name: 'Objets' });
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
    await expect(status).toHaveText('Enregistré');

    // Ajout d'un cube : il apparaît dans la hiérarchie et devient la sélection.
    await (await formesSimples(page)).getByRole('button', { name: 'Cube' }).click();
    await expect(tree.getByRole('treeitem', { name: 'Cube' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(status).toHaveText('Modifications non enregistrées');

    // Déplacement numérique, puis annuler / rétablir au clavier.
    const x = page.getByLabel('Position X');
    await x.fill('2');
    await x.press('Enter');
    await expect(x).toHaveValue('2');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(x).toHaveValue('0');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(x).toHaveValue('2');

    // Renommage par double-clic.
    await tree.getByRole('treeitem', { name: 'Cube' }).dblclick();
    await page.getByLabel('Nouveau nom').fill('Héros');
    await page.getByLabel('Nouveau nom').press('Enter');
    await expect(tree.getByRole('treeitem', { name: 'Héros' })).toBeVisible();

    // Import d'un GLB validé par le serveur.
    await page.getByLabel('Fichier GLB à importer').setInputFiles(CUBE_GLB);
    await expect(tree.getByRole('treeitem', { name: 'cube' })).toBeVisible();

    // Dupliquer puis supprimer au clavier, annuler la suppression.
    await page.keyboard.press('ControlOrMeta+d');
    await expect(tree.getByRole('treeitem', { name: 'cube copie' })).toBeVisible();
    await page.keyboard.press('Delete');
    await expect(tree.getByRole('treeitem', { name: 'cube copie' })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(tree.getByRole('treeitem', { name: 'cube copie' })).toBeVisible();

    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(status).toHaveText('Enregistré');

    // Rechargement complet : la scène revient de la dernière révision.
    await page.reload();
    await expect(tree.getByRole('treeitem')).toHaveCount(3);
    await tree.getByRole('treeitem', { name: 'Héros' }).click();
    await expect(page.getByLabel('Position X')).toHaveValue('2');
    await expect(status).toHaveText('Enregistré');
    expect(errors).toEqual([]);
  });
});
