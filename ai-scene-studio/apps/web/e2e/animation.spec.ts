import { expect, test } from '@playwright/test';
import { EMAIL, PASSWORD, createShot, formesSimples } from './helpers';

/** Phase 3 : un plan animé (objet et caméra) est créé, relu, enregistré et rechargé. */
test.describe('animation et caméras', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');

  test('animer un cube et une caméra, relire, enregistrer, recharger', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const shotId = await createShot(page, 48);
    await page.goto(`/shots/${shotId}/editor`);

    const frame = page.getByLabel('Frame courante');
    const x = page.getByLabel('Position X');
    const timeline = page.getByRole('region', { name: 'Timeline' });
    await expect(page.locator('[data-testid="viewport"] canvas')).toBeVisible();
    const add = await formesSimples(page);

    // Clé à 0, puis modification à 24 : la propriété animée reçoit une clé automatiquement.
    await add.getByRole('button', { name: 'Cube' }).click();
    await page.keyboard.press('k');
    await expect(timeline.getByRole('button', { name: 'Clé Position frame 0' })).toBeVisible();
    await frame.fill('24');
    await x.fill('4');
    await x.press('Enter');
    await expect(timeline.getByRole('button', { name: 'Clé Position frame 24' })).toBeVisible();

    // Relecture exacte : interpolation linéaire à mi-parcours.
    await frame.fill('12');
    await expect(x).toHaveValue('2');

    // Interpolation « palier » sur la première clé : la valeur reste celle de la frame 0.
    await timeline.getByRole('button', { name: 'Clé Position frame 0' }).click();
    await frame.fill('12');
    await page
      .getByLabel('Interpolation des clés sélectionnées')
      .selectOption({ label: 'Palier (step)' });
    await expect(x).toHaveValue('0');

    // Caméra : devient la caméra active, vise le cube ; vue double avec la vue caméra.
    await add.getByRole('button', { name: 'Caméra', exact: true }).click();
    await expect(page.getByLabel('Caméra active', { exact: true })).toHaveValue(/.+/);
    await page.getByLabel('Viser (look-at)').selectOption({ label: 'Cube' });
    await page.getByLabel('Disposition des vues').selectOption('split');
    await expect(page.locator('[data-testid="camera-view"] canvas')).toBeVisible();

    // Marqueur et lecture temps réel.
    await page.getByRole('button', { name: 'Marqueur' }).click();
    await expect(timeline.getByRole('button', { name: 'M1' })).toBeVisible();
    await frame.fill('0');
    await timeline.getByRole('button', { name: 'Lecture' }).click();
    await page.waitForTimeout(600);
    await timeline.getByRole('button', { name: 'Pause' }).click();
    expect(Number(await frame.inputValue())).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('status')).toHaveText('Enregistré');

    // Rechargement : clés, interpolation, marqueur, caméra active et visée sont conservés.
    await page.reload();
    await page.getByRole('treeitem', { name: 'Cube' }).click();
    await page.getByLabel('Frame courante').fill('12');
    await expect(page.getByLabel('Position X')).toHaveValue('0');
    await page.getByLabel('Frame courante').fill('24');
    await expect(page.getByLabel('Position X')).toHaveValue('4');
    await expect(
      page.getByRole('region', { name: 'Timeline' }).getByRole('button', { name: 'M1' }),
    ).toBeVisible();
    await page.getByRole('treeitem', { name: 'Caméra' }).click();
    await expect(page.getByLabel('Viser (look-at)')).toHaveValue(/.+/);
    await expect(page.getByLabel('Caméra active du plan')).toBeChecked();
    expect(errors).toEqual([]);
  });
});
