/**
 * Espace de travail à panneaux ancrables, dans un vrai navigateur (§6, §102).
 *
 * Le modèle d'arbre est déjà couvert par 34 tests unitaires, fuzz compris. Ce
 * qu'ils ne peuvent PAS voir, et que ces tests vérifient :
 *
 *  - qu'un geste de souris réel produit bien le dépôt attendu — le seuil de
 *    déclenchement, la visée du bord, le relâchement ;
 *  - que la disposition survit à un rechargement de page, ce qui est le seul
 *    intérêt de l'enregistrer ;
 *  - que déplacer un panneau ne DÉTRUIT pas son contenu : la timeline porte un
 *    canvas et un décodeur, et un démontage silencieux ne se verrait nulle
 *    part ailleurs.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Attend que l'application ait fini son ouverture. */
async function ouvrir(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.ouverture')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('espace-travail')).toBeVisible();
}

/**
 * Glisse l'onglet d'un panneau vers un point d'une zone.
 *
 * Le déplacement se fait en PLUSIEURS étapes : un seul saut ne franchit pas le
 * seuil de déclenchement de la même façon qu'un geste humain, et le composant
 * n'aurait jamais l'occasion de calculer sa cible.
 */
async function glisserPanneau(
  page: Page,
  panneau: string,
  cible: { zone: string; fraction: { x: number; y: number } },
): Promise<void> {
  const onglet = page.getByTestId(`onglet-${panneau}`).locator('.onglet-titre');
  const depart = await onglet.boundingBox();
  const zone = await page.getByTestId(`zone-${cible.zone}`).boundingBox();
  if (depart === null || zone === null) throw new Error('Onglet ou zone introuvable');

  await page.mouse.move(depart.x + depart.width / 2, depart.y + depart.height / 2);
  await page.mouse.down();
  const x = zone.x + zone.width * cible.fraction.x;
  const y = zone.y + zone.height * cible.fraction.y;
  for (const t of [0.3, 0.6, 1]) {
    await page.mouse.move(depart.x + (x - depart.x) * t, depart.y + (y - depart.y) * t, {
      steps: 6,
    });
  }
  await page.mouse.up();
}

test.beforeEach(async ({ context }) => {
  // Chaque test part d'une disposition vierge : sans ça, le premier test qui
  // déplace un panneau décide de la disposition de tous les suivants.
  await context.clearCookies();
});

test('la disposition par défaut montre les cinq panneaux', async ({ page }) => {
  await ouvrir(page);
  for (const p of ['source', 'programme', 'projet', 'info', 'timeline']) {
    await expect(page.getByTestId(`onglet-${p}`)).toBeVisible();
  }
});

test('déposer un panneau au centre d’une zone le met en onglet', async ({ page }) => {
  await ouvrir(page);
  const zoneProgramme = page.getByTestId('onglet-programme');
  const zone = await zoneProgramme.evaluate((el) => el.closest('.zone')?.getAttribute('data-test'));
  expect(zone).not.toBeNull();
  const idZone = (zone ?? '').replace('zone-', '');

  await glisserPanneau(page, 'source', { zone: idZone, fraction: { x: 0.5, y: 0.5 } });

  // Les deux onglets vivent désormais dans la MÊME zone.
  const memeZone = await page
    .getByTestId('onglet-source')
    .evaluate((el) => el.closest('.zone')?.getAttribute('data-test'));
  expect(memeZone).toBe(zone);
  // Et le panneau déposé est au premier plan.
  await expect(page.getByTestId('onglet-source')).toHaveClass(/actif/);
});

test('déposer un panneau sur un bord crée une nouvelle division', async ({ page }) => {
  await ouvrir(page);
  const avant = await page.locator('.zone').count();
  await glisserPanneau(page, 'info', { zone: 'z5', fraction: { x: 0.05, y: 0.5 } });
  // La zone d'origine d'`info` a disparu, une nouvelle est née à gauche de la
  // timeline : le compte total ne bouge pas, mais l'ordre visuel, si.
  await expect(page.locator('.zone')).toHaveCount(avant);
  const positions = await page.locator('.zone').evaluateAll((zones) =>
    zones.map((z) => ({
      test: z.getAttribute('data-test') ?? '',
      x: z.getBoundingClientRect().x,
      onglets: [...z.querySelectorAll('.onglet')].map((o) => o.getAttribute('data-test') ?? ''),
    })),
  );
  const zoneInfo = positions.find((z) => z.onglets.includes('onglet-info'));
  const zoneTimeline = positions.find((z) => z.onglets.includes('onglet-timeline'));
  expect(zoneInfo).toBeDefined();
  expect(zoneTimeline).toBeDefined();
  if (zoneInfo === undefined || zoneTimeline === undefined) return;
  expect(zoneInfo.x).toBeLessThan(zoneTimeline.x);
});

test('la disposition survit à un rechargement', async ({ page }) => {
  await ouvrir(page);
  await glisserPanneau(page, 'source', { zone: 'z4', fraction: { x: 0.5, y: 0.5 } });
  const avant = await page
    .getByTestId('onglet-source')
    .evaluate((el) => el.closest('.zone')?.getAttribute('data-test'));

  await page.reload();
  await expect(page.locator('.ouverture')).toHaveCount(0, { timeout: 20_000 });

  const apres = await page
    .getByTestId('onglet-source')
    .evaluate((el) => el.closest('.zone')?.getAttribute('data-test'));
  expect(apres).toBe(avant);
});

test('le menu Fenêtre ferme et rouvre un panneau', async ({ page }) => {
  await ouvrir(page);
  await page.getByTestId('fermer-info').click();
  await expect(page.getByTestId('onglet-info')).toHaveCount(0);
  // Le contenu de l'historique disparaît avec lui : le panneau est bien retiré
  // de l'arbre, pas seulement masqué.
  await expect(page.locator('.liste-historique')).toHaveCount(0);

  await page.getByTestId('barre-fenêtre').click();
  await page.getByTestId('menu-bm-panneau-info').click();
  await expect(page.getByTestId('onglet-info')).toBeVisible();
  await expect(page.locator('.liste-historique')).toHaveCount(1);
});

test('« Réinitialiser la disposition » remet le banc de montage en place', async ({ page }) => {
  await ouvrir(page);
  await glisserPanneau(page, 'projet', { zone: 'z5', fraction: { x: 0.5, y: 0.5 } });
  const deplace = await page
    .getByTestId('onglet-projet')
    .evaluate((el) => el.closest('.zone')?.getAttribute('data-test'));
  expect(deplace).toBe('zone-z5');

  await page.getByTestId('barre-fenêtre').click();
  await page.getByTestId('menu-bm-disposition-defaut').click();

  const remis = await page
    .getByTestId('onglet-projet')
    .evaluate((el) => el.closest('.zone')?.getAttribute('data-test'));
  expect(remis).toBe('zone-z3');
});

test('la poignée redimensionne, et le clavier aussi', async ({ page }) => {
  await ouvrir(page);
  const zoneSource = page.getByTestId('zone-z1');
  const avant = (await zoneSource.boundingBox())?.width ?? 0;
  expect(avant).toBeGreaterThan(0);

  const poignee = page.getByTestId('poignee-d3');
  await poignee.focus();
  // Dix pas de 2 % vers la droite : la zone de gauche grandit.
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');

  const apres = (await zoneSource.boundingBox())?.width ?? 0;
  expect(apres).toBeGreaterThan(avant + 40);

  // Double-clic : retour à parts égales.
  await poignee.dblclick();
  const egalise = (await zoneSource.boundingBox())?.width ?? 0;
  const voisine = (await page.getByTestId('zone-z2').boundingBox())?.width ?? 0;
  expect(Math.abs(egalise - voisine)).toBeLessThan(8);
});

test('changer d’onglet ne détruit pas le canvas de la timeline', async ({ page }) => {
  await ouvrir(page);
  // Timeline et Projet dans la MÊME zone : deux onglets, un seul visible.
  await glisserPanneau(page, 'timeline', { zone: 'z3', fraction: { x: 0.5, y: 0.5 } });
  const toile = page.locator('.timeline-toile canvas');
  await expect(toile).toHaveCount(1);
  await toile.evaluate((el) => {
    (el as HTMLCanvasElement).dataset['temoin'] = 'intact';
  });

  // Aller sur l'autre onglet, puis revenir.
  await page.getByTestId('onglet-projet').locator('.onglet-titre').click();
  await expect(page.getByTestId('onglet-projet')).toHaveClass(/actif/);
  await page.getByTestId('onglet-timeline').locator('.onglet-titre').click();

  // Le témoin survit : React n'a ni démonté ni remonté le composant, il a
  // seulement masqué son conteneur. Un canvas remonté serait vierge, la
  // position de lecture et le décodeur repartiraient de zéro.
  expect(await toile.evaluate((el) => (el as HTMLCanvasElement).dataset['temoin'])).toBe('intact');
});
