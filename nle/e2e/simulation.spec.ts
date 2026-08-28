/**
 * Simulation d'un montage complet (§102, §1003).
 *
 * Ce fichier ne teste pas une fonction : il MONTE. Un monteur ouvre le projet,
 * importe du son, repère, coupe, raccorde, cale, étire, étiquette, met un
 * média hors ligne, le relie, annule tout, refait tout, enregistre et recharge.
 * Chaque outil est exercé UNE FOIS, dans l'ordre où on s'en sert vraiment, et
 * chaque étape vérifie le MODÈLE — pas le pixel — via le panneau Projet.
 *
 * Ce que ce fichier cherche à attraper, et que les tests unitaires ne peuvent
 * pas voir : une commande câblée à la mauvaise action, un outil qui s'arme mais
 * ne commet rien, un refus silencieux, un état qui ne survit pas au
 * rechargement. Ce sont les pannes qui rendent un logiciel inutilisable alors
 * que toutes ses pièces passent leurs tests.
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Ligne du panneau Projet, par nom EXACT.
 *
 * Une recherche par sous-chaîne ferait correspondre « A003_large » à
 * « A003_large.wav », et les lignes audio passent avant les lignes vidéo dans
 * le tri : on lirait le son en croyant lire l'image.
 */
function ligne(page: Page, nom: string): Locator {
  return page.locator(`.table-projet tbody tr[data-nom="${nom}"]`).first();
}

/** Colonnes du panneau Projet : nom, type, piste, début, fin, durée. */
async function colonne(page: Page, nom: string, index: number): Promise<string> {
  return (await ligne(page, nom).locator('td').nth(index).innerText()).trim();
}
const debutDe = (page: Page, nom: string): Promise<string> => colonne(page, nom, 3);
const dureeDe = (page: Page, nom: string): Promise<string> => colonne(page, nom, 5);

function historique(page: Page): Locator {
  return page.locator('.liste-historique li');
}

async function centre(
  page: Page,
  indexPiste: number,
  fraction: number,
): Promise<{ x: number; y: number }> {
  const boite = await page.locator('.timeline-toile canvas').boundingBox();
  const entete = await page.locator('.entete-piste').nth(indexPiste).boundingBox();
  if (boite === null || entete === null) throw new Error('Timeline introuvable');
  return { x: boite.x + boite.width * fraction, y: entete.y + entete.height / 2 };
}

/** Appui-glissé-relâché : le geste de base de tous les outils de la timeline. */
async function glisser(
  page: Page,
  depart: { x: number; y: number },
  dx: number,
  dy = 0,
): Promise<void> {
  await page.mouse.move(depart.x, depart.y);
  await page.mouse.down();
  await page.mouse.move(depart.x + dx, depart.y + dy, { steps: 14 });
  await page.mouse.up();
}

async function selectionner(page: Page, indexPiste: number, fraction: number): Promise<void> {
  await selectionnerA(page, await centre(page, indexPiste, fraction));
}

/** Appui-relâché sur place : sélectionne sans rien déplacer. */
async function selectionnerA(page: Page, c: { x: number; y: number }): Promise<void> {
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y + 2, { steps: 3 });
  await page.mouse.up();
}

/**
 * Point de la timeline correspondant à une image de la séquence.
 *
 * Viser « 75 % de la largeur » marche jusqu'au premier montage : dès qu'on a
 * coupé, roulé ou étiré, ce pourcentage ne désigne plus le clip qu'on croit.
 * On lit donc l'échelle et le défilement réels de la vue, exposés par la
 * timeline pour cet usage, et on vise une IMAGE.
 */
async function pointA(
  page: Page,
  image: number,
  indexPiste: number,
): Promise<{ x: number; y: number }> {
  const boite = await page.locator('.timeline-toile canvas').boundingBox();
  const entete = await page.locator('.entete-piste').nth(indexPiste).boundingBox();
  if (boite === null || entete === null) throw new Error('Timeline introuvable');
  const echelle = Number.parseFloat(
    (await page.locator('.timeline-toile').getAttribute('data-echelle')) ?? '1',
  );
  const scroll = Number.parseFloat(
    (await page.locator('.timeline-toile').getAttribute('data-scroll')) ?? '0',
  );
  return { x: boite.x + (image - scroll) * echelle, y: entete.y + entete.height / 2 };
}

/** Milieu d'un clip désigné par son nom, lu dans le modèle. */
async function milieuDe(
  page: Page,
  nom: string,
  indexPiste: number,
): Promise<{ x: number; y: number }> {
  const debut = imagesDe(await colonne(page, nom, 3));
  const duree = Number.parseInt(await colonne(page, nom, 5), 10);
  return pointA(page, debut + duree / 2, indexPiste);
}

/** Bord droit d'un clip, à quelques pixels près : la poignée de raccord. */
async function bordDroit(
  page: Page,
  nom: string,
  indexPiste: number,
): Promise<{ x: number; y: number }> {
  const fin =
    imagesDe(await colonne(page, nom, 3)) + Number.parseInt(await colonne(page, nom, 5), 10);
  const p = await pointA(page, fin, indexPiste);
  return { x: p.x - 3, y: p.y };
}

/** Timecode 01:00:04:18 -> nombre d'images depuis le départ de séquence, à 25 i/s. */
function imagesDe(timecode: string): number {
  const [h, m, s, f] = timecode.split(':').map((n) => Number.parseInt(n, 10));
  return ((h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0)) * 25 + (f ?? 0) - 90000;
}

test.describe('montage complet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.ouverture')).toHaveCount(0);
    await expect(page.locator('.timeline-toile canvas')).toBeVisible();
    await expect(ligne(page, 'A001_ouverture')).toBeVisible();
  });

  test('un monteur enchaîne tous les outils et le modèle suit à chaque geste', async ({ page }) => {
    const tc = page.locator('.barre-etat .mono').first();
    const alerte = page.locator('.barre-etat .alerte');

    await test.step('1. état de départ : sept plans liés à leur son', async () => {
      await expect(page.locator('.entete-piste')).toHaveCount(7);
      expect(await debutDe(page, 'A001_ouverture')).toBe('01:00:00:00');
      expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:04:18');
      expect(await dureeDe(page, 'A003_large')).toBe('143');
      await expect(historique(page)).toHaveCount(1);
    });

    await test.step('2. outil Sélection : déplacer entraîne le son lié', async () => {
      await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
      await selectionnerA(page, await milieuDe(page, 'A003_large', 2));
      await expect(page.locator('.barre-etat')).toContainText('2 sélectionnés');
      expect(await debutDe(page, 'A003_large.wav')).toBe(await debutDe(page, 'A003_large'));
    });

    await test.step('3. outil Lame : couper A005 en deux', async () => {
      const avant = await page.locator('.table-projet tbody tr[data-clip]').count();
      await page.keyboard.press('KeyC');
      const c = await milieuDe(page, 'A005_travelling', 2);
      await page.mouse.click(c.x, c.y);
      // Deux clips de plus : la coupe traverse aussi l'audio lié.
      await expect(page.locator('.table-projet tbody tr[data-clip]')).toHaveCount(avant + 2);
      await expect(historique(page)).toContainText(['Lame']);
      await page.keyboard.press('KeyV');
    });

    await test.step('4. outil Rolling : déplacer le raccord sans bouger la suite', async () => {
      const departA004 = await debutDe(page, 'A004_insert_mains');
      const finA003 = imagesDe(departA004);
      await page.keyboard.press('KeyN');
      const bord = await bordDroit(page, 'A003_large', 2);
      await glisser(page, bord, 30);
      await expect(historique(page)).toContainText(['Roll']);
      // Le raccord a bougé : A004 commence plus tard, mais finit au même endroit.
      const apres = imagesDe(await debutDe(page, 'A004_insert_mains'));
      expect(apres).toBeGreaterThan(finA003);
      expect(await debutDe(page, 'A005_travelling')).toBe('01:00:16:10');
      await page.keyboard.press('KeyV');
    });

    await test.step('5. outil Slip : changer le contenu sans bouger le clip', async () => {
      const debutAvant = await debutDe(page, 'A004_insert_mains');
      const dureeAvant = await dureeDe(page, 'A004_insert_mains');
      await page.keyboard.press('KeyY');
      await glisser(page, await milieuDe(page, 'A004_insert_mains', 2), 20);
      await expect(historique(page)).toContainText(['Slip']);
      // Ni la place ni la durée ne changent : c'est toute la définition du slip.
      expect(await debutDe(page, 'A004_insert_mains')).toBe(debutAvant);
      expect(await dureeDe(page, 'A004_insert_mains')).toBe(dureeAvant);
      await page.keyboard.press('KeyV');
    });

    await test.step('6. outil Étirement : changer la durée en changeant la vitesse', async () => {
      await page.keyboard.press('KeyR');
      const dureeAvant = Number.parseInt(await dureeDe(page, 'A006_reaction'), 10);
      await glisser(page, await milieuDe(page, 'A006_reaction', 2), -25);
      await expect(historique(page)).toContainText(['Étirement temporel']);
      const dureeApres = Number.parseInt(await dureeDe(page, 'A006_reaction'), 10);
      expect(dureeApres).toBeLessThan(dureeAvant);
      await page.keyboard.press('KeyV');
    });

    await test.step('7. outil Main : la vue défile sans toucher au montage', async () => {
      const avant = await debutDe(page, 'A001_ouverture');
      const scrollAvant = await page.locator('.timeline-toile').getAttribute('data-scroll');
      await page.keyboard.press('KeyH');
      await glisser(page, await milieuDe(page, 'A005_travelling', 2), -160);
      expect(await page.locator('.timeline-toile').getAttribute('data-scroll')).not.toBe(
        scrollAvant,
      );
      // Le montage n'a pas bougé d'une image, et l'historique non plus.
      expect(await debutDe(page, 'A001_ouverture')).toBe(avant);
      await page.keyboard.press('KeyV');
      await page.keyboard.press('Backslash'); // ajuster
    });

    await test.step('8. outil Sélection de piste : tout prendre à partir d’un point', async () => {
      await page.keyboard.press('KeyA');
      const c = await centre(page, 2, 0.6);
      await page.mouse.click(c.x, c.y);
      const compte = await page.locator('.barre-etat span').nth(3).innerText();
      expect(Number.parseInt(compte, 10)).toBeGreaterThan(1);
      await page.keyboard.press('KeyV');
      await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
    });

    await test.step('9. marques, Extract, et le son synchronisé qui suit', async () => {
      await page.keyboard.press('Home');
      await page.keyboard.press('KeyI');
      for (let i = 0; i < 24; i += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('KeyO');
      const suivantAvant = imagesDe(await debutDe(page, 'A002_contrechamp'));
      await page.keyboard.press('Quote');
      await expect(historique(page)).toContainText(['Extract']);
      expect(imagesDe(await debutDe(page, 'A002_contrechamp'))).toBe(suivantAvant - 25);
      await expect(alerte).toHaveCount(0);
    });

    await test.step('10. presse-papiers : copier un plan et le coller en fin', async () => {
      await selectionner(page, 2, 0.1);
      const avant = await page.locator('.table-projet tbody tr[data-clip]').count();
      await page.keyboard.press('Control+c');
      await page.keyboard.press('End');
      await page.keyboard.press('Control+v');
      await expect(historique(page)).toContainText(['Coller']);
      await expect(page.locator('.table-projet tbody tr[data-clip]')).toHaveCount(avant + 2);
    });

    await test.step('11. vitesse et durée : un ralenti à 50 % sur un clip isolé', async () => {
      await selectionner(page, 4, 0.5); // ambiance de A2, non liée
      await expect(page.locator('.barre-etat')).toContainText('1 sélectionné');
      await page.keyboard.press('Control+r');
      await page.getByTestId('vitesse-pourcent').fill('50');
      await page.getByTestId('vitesse-ripple').check();
      await page.locator('.modale button.principal').click();
      await expect(historique(page)).toContainText(['Vitesse et durée']);
      expect(Number.parseInt(await dureeDe(page, 'Ambiance_salle.wav'), 10)).toBeGreaterThan(1000);
    });

    await test.step('12. étiquette et désactivation par le menu contextuel', async () => {
      const c = await centre(page, 2, 0.1);
      await page.mouse.click(c.x, c.y, { button: 'right' });
      await page.getByTestId('menu-clip-etiquette').click();
      await page.getByTestId('menu-etiquette-c07090').click();
      await expect(historique(page)).toContainText(['Étiqueter le clip']);

      await page.mouse.click(c.x, c.y, { button: 'right' });
      await page.getByTestId('menu-clip-actif').click();
      await expect(historique(page)).toContainText(['Désactiver le clip']);
    });

    await test.step('13. pistes : en ajouter une, la renommer, la supprimer', async () => {
      await page.locator('.entete-piste').nth(2).click({ button: 'right' });
      await page.getByTestId('menu-piste-ajouter-dessus').click();
      await expect(page.locator('.entete-piste')).toHaveCount(8);

      await page.locator('.entete-piste').nth(2).click({ button: 'right' });
      await page.getByTestId('menu-piste-renommer').click();
      await page.getByTestId('renommage-nom').fill('Habillage');
      await page.locator('.modale button.principal').click();
      await expect(page.locator('.entete-piste').nth(2)).toContainText('Habillage');

      await page.locator('.entete-piste').nth(2).click({ button: 'right' });
      await page.getByTestId('menu-piste-supprimer').click();
      await expect(page.locator('.entete-piste')).toHaveCount(7);
    });

    await test.step('14. marqueur posé et retrouvé au clavier', async () => {
      await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
      await page.keyboard.press('Home');
      for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowRight');
      await page.keyboard.press('KeyM');
      await expect(historique(page)).toContainText(['Ajouter un marqueur']);
      await page.keyboard.press('Home');
      await page.keyboard.press('Shift+KeyM');
      // Le premier marqueur après 0 : celui du projet de démonstration à 40 ?
      // Non : celui-ci a été posé exactement à 40, et il n'y en a pas avant.
      await expect(tc).toHaveText('01:00:01:15');
    });

    await test.step('15. média importé, posé, mis hors ligne puis relié', async () => {
      await page
        .getByTestId('import-medias')
        .setInputFiles('fixtures/generated/audio_48k_stereo.wav');
      await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);
      await page.locator('[data-test="ligne-media"]').click();

      // En fin de séquence : posé au milieu, l'overwrite recouvrirait un plan
      // existant et le compte ne dirait plus rien.
      await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
      await page.keyboard.press('End');
      const avant = await page.locator('.table-projet tbody tr[data-clip]').count();
      await page.locator('[data-test="ligne-media"]').locator('button').first().click();
      await expect(page.locator('.table-projet tbody tr[data-clip]')).toHaveCount(avant + 1);

      await page.getByTestId('hors-ligne').click();
      await expect(page.getByTestId('etat-media')).toHaveText('hors ligne');
      // Le clip posé est TOUJOURS là : un fichier absent n'efface pas un montage.
      await expect(page.locator('.table-projet tbody tr[data-clip]')).toHaveCount(avant + 1);

      const [selecteur] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByTestId('relier').click(),
      ]);
      await selecteur.setFiles('fixtures/generated/audio_enveloppe.wav');
      await expect(page.getByTestId('etat-media')).toContainText('décodé');
    });

    await test.step('16. tout annuler ramène exactement au projet de départ', async () => {
      // On annule jusqu'à ce que l'historique redevienne inerte.
      for (let i = 0; i < 60; i += 1) {
        if ((await page.locator('.liste-historique li.courant').innerText()).includes('Ouverture')) {
          break;
        }
        await page.keyboard.press('Control+z');
      }
      expect(await debutDe(page, 'A001_ouverture')).toBe('01:00:00:00');
      expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:04:18');
      expect(await dureeDe(page, 'A003_large')).toBe('143');
      await expect(page.locator('.entete-piste')).toHaveCount(7);
    });

    await test.step('17. tout rétablir redonne le montage terminé', async () => {
      const etapes = await historique(page).count();
      for (let i = 0; i < etapes; i += 1) await page.keyboard.press('Control+Shift+z');
      // Le montage retrouvé n'est plus celui du départ : le rétablissement a
      // rejoué toute la session, pas seulement la dernière commande.
      expect(await debutDe(page, 'A002_contrechamp')).not.toBe('01:00:04:18');
      await expect(alerte).toHaveCount(0);
    });

    await test.step('18. enregistrer, recharger, et retrouver le montage', async () => {
      const repere = await debutDe(page, 'A002_contrechamp');
      const clips = await page.locator('.table-projet tbody tr[data-clip]').count();
      await page.keyboard.press('Control+s');
      await expect(page.locator('.barre-etat')).toContainText('Enregistré');

      await page.reload();
      await expect(page.locator('.ouverture')).toHaveCount(0);
      await expect(page.locator('.timeline-toile canvas')).toBeVisible();
      expect(await debutDe(page, 'A002_contrechamp')).toBe(repere);
      await expect(page.locator('.table-projet tbody tr[data-clip]')).toHaveCount(clips);
      // L'historique repart à zéro : on a rouvert un document, pas repris une
      // session — et prétendre le contraire laisserait annuler dans le vide.
      await expect(historique(page)).toHaveCount(1);
    });
  });
});
