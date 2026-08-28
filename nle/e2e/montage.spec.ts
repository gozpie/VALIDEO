/**
 * Montage de bout en bout dans un vrai navigateur (§102).
 *
 * Ces tests ne vérifient pas des composants isolés : ils manipulent la timeline
 * à la souris et au clavier comme le ferait un monteur, puis vérifient que le
 * MODÈLE a réellement changé — via le panneau Projet, qui affiche les positions
 * lues dans le document, et via le panneau Historique.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** Ligne du panneau Projet correspondant à un clip. */
function ligne(page: Page, nom: string): Locator {
  return page.locator('.table-projet tbody tr', { hasText: nom }).first();
}

async function debutDe(page: Page, nom: string): Promise<string> {
  return (await ligne(page, nom).locator('td').nth(3).innerText()).trim();
}

function historique(page: Page): Locator {
  return page.locator('.liste-historique li');
}

/** Centre du clip dans le canvas de la timeline, en coordonnées de page. */
async function centreClip(
  page: Page,
  indexPiste: number,
  fraction: number,
): Promise<{ x: number; y: number }> {
  const toile = page.locator('.timeline-toile canvas');
  const boite = await toile.boundingBox();
  if (boite === null) throw new Error('Canvas introuvable');
  const entetes = page.locator('.entete-piste');
  const entete = await entetes.nth(indexPiste).boundingBox();
  if (entete === null) throw new Error('En-tête de piste introuvable');
  return { x: boite.x + boite.width * fraction, y: entete.y + entete.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.timeline-toile canvas')).toBeVisible();
  await expect(ligne(page, 'A001_ouverture')).toBeVisible();
});

test('le projet de démonstration se charge avec sa séquence', async ({ page }) => {
  await expect(page.locator('.entete-piste')).toHaveCount(7);
  await expect(page.locator('.table-projet tbody tr')).toHaveCount(17);
  await expect(page.locator('.barre-etat')).toContainText('25 i/s NDF');
  // Le timecode de séquence démarre à 01:00:00:00, convention broadcast.
  await expect(page.locator('.barre-etat .mono').first()).toHaveText('01:00:00:00');
  // Aucune étape d'historique au démarrage.
  await expect(historique(page)).toHaveCount(1);
});

test('déplacer un clip modifie réellement le modèle et se voit dans l’historique', async ({
  page,
}) => {
  const avant = await debutDe(page, 'Générique début');

  // V2 est la deuxième piste affichée (V3, V2, V1, A1...).
  const depart = await centreClip(page, 1, 0.09);
  await page.mouse.move(depart.x, depart.y);
  await page.mouse.down();
  await page.mouse.move(depart.x + 160, depart.y, { steps: 24 });
  await page.mouse.up();

  await expect(historique(page)).toContainText(['Déplacer le clip']);
  expect(await debutDe(page, 'Générique début')).not.toBe(avant);

  // Un geste continu ne produit QU'UNE entrée d'historique (§43).
  await expect(historique(page)).toHaveCount(2);

  // Et l'annulation revient exactement au point de départ.
  await page.keyboard.press('Control+z');
  expect(await debutDe(page, 'Générique début')).toBe(avant);
});

test('l’outil Lame coupe un clip en deux', async ({ page }) => {
  const avant = await page.locator('.table-projet tbody tr').count();
  await page.keyboard.press('KeyC');
  await expect(page.locator('.outil.actif')).toHaveText('C');

  const cible = await centreClip(page, 2, 0.2); // V1
  await page.mouse.click(cible.x, cible.y);

  await expect(page.locator('.table-projet tbody tr')).toHaveCount(avant + 1);
  await expect(historique(page)).toContainText(['Couper']);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.table-projet tbody tr')).toHaveCount(avant);
});

test('les raccourcis de navigation déplacent la tête de lecture', async ({ page }) => {
  const tc = page.locator('.barre-etat .mono').first();
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });

  await page.keyboard.press('Home');
  await expect(tc).toHaveText('01:00:00:00');

  await page.keyboard.press('ArrowRight');
  await expect(tc).toHaveText('01:00:00:01');

  await page.keyboard.press('Shift+ArrowRight');
  await expect(tc).toHaveText('01:00:00:06');

  // Point de montage suivant : la fin du premier plan, à 118 images.
  await page.keyboard.press('ArrowDown');
  await expect(tc).toHaveText('01:00:04:18');

  await page.keyboard.press('ArrowUp');
  await expect(tc).toHaveText('01:00:00:00');
});

test('verrouiller une piste passe par une commande annulable', async ({ page }) => {
  const verrou = page.locator('.entete-piste').nth(2).locator('button').nth(1);
  await verrou.click();
  await expect(verrou).toHaveAttribute('aria-pressed', 'true');
  await expect(historique(page)).toContainText(['Verrouiller la piste']);

  await page.keyboard.press('Control+z');
  await expect(verrou).toHaveAttribute('aria-pressed', 'false');
});

test('une opération refusée affiche un message et ne modifie rien', async ({ page }) => {
  // On verrouille V1, puis on tente d'y couper : le refus doit être visible.
  const verrouV1 = page.locator('.entete-piste').nth(2).locator('button').nth(1);
  await verrouV1.click();

  const avant = await page.locator('.table-projet tbody tr').count();
  await page.keyboard.press('KeyC');
  const cible = await centreClip(page, 2, 0.2);
  await page.mouse.click(cible.x, cible.y);

  await expect(page.locator('.barre-etat .alerte')).toContainText('verrouillée');
  await expect(page.locator('.table-projet tbody tr')).toHaveCount(avant);
});

test('le zoom et l’ajustement ne modifient pas le montage', async ({ page }) => {
  const avant = await debutDe(page, 'A003_large');
  await page.getByTitle('Zoom avant').click();
  await page.getByTitle('Zoom avant').click();
  await page.getByTitle('Ajuster la séquence').click();
  expect(await debutDe(page, 'A003_large')).toBe(avant);
  // Naviguer ne crée aucune entrée d'historique.
  await expect(historique(page)).toHaveCount(1);
});

test('la sélection au rectangle sélectionne plusieurs clips', async ({ page }) => {
  const toile = page.locator('.timeline-toile canvas');
  const boite = await toile.boundingBox();
  if (boite === null) throw new Error('Canvas introuvable');

  await page.mouse.move(boite.x + 20, boite.y + boite.height - 30);
  await page.mouse.down();
  await page.mouse.move(boite.x + boite.width * 0.6, boite.y + 40, { steps: 18 });
  await page.mouse.up();

  await expect(page.locator('.barre-etat')).not.toContainText('0 sélectionné');
});

test('aucune erreur console au chargement', async ({ page }) => {
  const erreurs: string[] = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') erreurs.push(m.text());
  });
  await page.reload();
  await expect(page.locator('.timeline-toile canvas')).toBeVisible();
  await page.waitForTimeout(500);
  expect(erreurs).toEqual([]);
});
