import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/** Éditeur 3D contre la vraie pile : ajout, déplacement, annuler/rétablir, import GLB, sauvegarde, rechargement. */
const EMAIL = process.env['E2E_EMAIL'];
const PASSWORD = process.env['E2E_PASSWORD'];
const API_URL = process.env['E2E_API_URL'] ?? 'http://localhost:8000';
const CUBE_GLB = fileURLToPath(new URL('../../../tests/fixtures/assets/cube.glb', import.meta.url));

async function createShot(page: Page): Promise<string> {
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
  const workspace = await post('/workspaces', { name: `Éditeur E2E ${Date.now().toString(36)}` });
  const project = await post(`/workspaces/${workspace.id}/projects`, { name: 'Pilote' });
  const sequence = await post(`/projects/${project.id}/sequences`, { name: 'Ouverture' });
  const shot = await post(`/sequences/${sequence.id}/shots`, {
    name: 'Plan 1',
    durationFrames: 48,
  });
  return shot.id;
}

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
    await page
      .getByRole('region', { name: 'Ajouter' })
      .getByRole('button', { name: 'Cube' })
      .click();
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
