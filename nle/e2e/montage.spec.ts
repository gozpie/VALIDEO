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
  // L'éditeur n'apparaît qu'une fois le stockage interrogé.
  await expect(page.locator('.ouverture')).toHaveCount(0);
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

test('le projet survit à un rechargement de page (§44)', async ({ page }) => {
  const avant = await debutDe(page, 'Générique début');

  // On déplace un clip, puis on enregistre explicitement.
  const depart = await centreClip(page, 1, 0.09);
  await page.mouse.move(depart.x, depart.y);
  await page.mouse.down();
  await page.mouse.move(depart.x + 200, depart.y, { steps: 20 });
  await page.mouse.up();
  const apres = await debutDe(page, 'Générique début');
  expect(apres).not.toBe(avant);

  await page.getByTitle('Enregistrer le projet (Ctrl+S)').click();
  await expect(page.locator('.barre-etat')).toContainText('Enregistré');

  // Rechargement complet : le montage doit revenir tel quel.
  await page.reload();
  await expect(ligne(page, 'Générique début')).toBeVisible();
  await expect(ligne(page, 'Générique début').locator('td').nth(3)).toHaveText(apres);

  // Et l'historique repart à zéro : les étapes de la session précédente n'ont
  // plus de sens sur un document rechargé.
  await expect(historique(page)).toHaveCount(1);
});

test('un travail non enregistré est proposé à la reprise après un rechargement', async ({
  page,
}) => {
  const depart = await centreClip(page, 1, 0.09);
  await page.mouse.move(depart.x, depart.y);
  await page.mouse.down();
  await page.mouse.move(depart.x + 240, depart.y, { steps: 20 });
  await page.mouse.up();
  const nonEnregistre = await debutDe(page, 'Générique début');

  // On attend la sauvegarde automatique, SANS enregistrer explicitement.
  await page.waitForTimeout(2500);
  await page.reload();

  const bandeau = page.locator('.bandeau-reprise');
  await expect(bandeau).toContainText('Travail non enregistré retrouvé');

  await bandeau.getByRole('button', { name: 'Récupérer' }).click();
  await expect(bandeau).toHaveCount(0);
  await expect(ligne(page, 'Générique début').locator('td').nth(3)).toHaveText(nonEnregistre);
});

test('importer un vrai fichier audio produit une forme d’onde réelle (§8, §19)', async ({
  page,
}) => {
  // Fixture réellement encodée par scripts/make-fixtures.sh : 2 s de 440 Hz,
  // stéréo, 48 kHz, PCM 16 bits.
  const fixture = new URL('../fixtures/generated/audio_48k_stereo.wav', import.meta.url).pathname;

  await page.locator('input[data-test="import-medias"]').setInputFiles(fixture);

  const media = page.locator('tr[data-test="ligne-media"]');
  await expect(media).toHaveCount(1);
  await expect(media).toContainText('audio_48k_stereo.wav');
  // Les caractéristiques affichées sont celles réellement décodées.
  await expect(media).toContainText('2 ch');
  await expect(media).toContainText('48 kHz');
  // « décodé » signifie que la pyramide de pics existe : la forme d'onde sera vraie.
  await expect(media).toContainText('décodé');
  // 2 secondes à 25 i/s.
  await expect(media.locator('td').nth(2)).toHaveText('01:00:02:00');
});

test('un média importé peut être posé sur la timeline et devient un clip', async ({ page }) => {
  const fixture = new URL('../fixtures/generated/audio_48k_stereo.wav', import.meta.url).pathname;
  await page.locator('input[data-test="import-medias"]').setInputFiles(fixture);
  await expect(page.locator('tr[data-test="ligne-media"]')).toHaveCount(1);

  const avant = await page.locator('.table-projet').last().locator('tbody tr').count();
  await page.getByTitle('Poser à la tête de lecture (overwrite)').click();

  await expect(historique(page)).toContainText(['Overwrite']);
  await expect(page.locator('.table-projet').last().locator('tbody tr')).toHaveCount(avant + 1);
  await expect(ligne(page, 'audio_48k_stereo.wav')).toBeVisible();

  await page.keyboard.press('Control+z');
  await expect(page.locator('.table-projet').last().locator('tbody tr')).toHaveCount(avant);
});

test('un fichier illisible est signalé sans casser l’application', async ({ page }) => {
  const casse = new URL('../fixtures/generated/broken.mp4', import.meta.url).pathname;
  await page.locator('input[data-test="import-medias"]').setInputFiles(casse);

  const media = page.locator('tr[data-test="ligne-media"]');
  await expect(media).toHaveCount(1);
  await expect(media).toContainText('illisible');
  // Le bouton « Poser » est désactivé : on ne monte pas un média illisible.
  await expect(page.getByTitle('Poser à la tête de lecture (overwrite)')).toBeDisabled();
  // Et la timeline reste utilisable.
  await expect(page.locator('.timeline-toile canvas')).toBeVisible();
});

test('la forme d’onde est réellement dessinée à partir des échantillons (§19)', async ({
  page,
}) => {
  const fixture = new URL('../fixtures/generated/audio_enveloppe.wav', import.meta.url).pathname;

  /**
   * Compte les pixels clairs d'une bande horizontale du canvas.
   * Une piste audio sans média est un aplat uni ; une piste portant une forme
   * d'onde contient beaucoup de pixels clairs. La différence est massive et ne
   * dépend d'aucune couleur exacte.
   */
  const pixelsClairs = async (indexPiste: number): Promise<number> => {
    const entete = await page.locator('.entete-piste').nth(indexPiste).boundingBox();
    const toile = await page.locator('.timeline-toile canvas').boundingBox();
    if (entete === null || toile === null) throw new Error('Géométrie introuvable');
    const y = entete.y - toile.y + entete.height / 2;
    return page.evaluate(
      ({ y: yy, hauteur }) => {
        const canvas = document.querySelector('.timeline-toile canvas') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return 0;
        const dpr = canvas.width / canvas.getBoundingClientRect().width;
        const donnees = ctx.getImageData(
          0,
          Math.round((yy - hauteur / 2) * dpr),
          canvas.width,
          Math.round(hauteur * dpr),
        ).data;
        let clairs = 0;
        for (let i = 0; i < donnees.length; i += 4) {
          if ((donnees[i] ?? 0) > 170 && (donnees[i + 1] ?? 0) > 200 && (donnees[i + 2] ?? 0) > 180)
            clairs += 1;
        }
        return clairs;
      },
      { y, hauteur: entete.height - 6 },
    );
  };

  // Ordre d'affichage des pistes : V3, V2, V1, A1, A2, A3, A4 → A3 est l'index 5.
  const A3 = 5;
  const A2 = 4;
  const A1 = 3;

  // A3 est vide au départ : aucun pixel clair de forme d'onde.
  const avant = await pixelsClairs(A3);

  await page.locator('input[data-test="import-medias"]').setInputFiles(fixture);
  await expect(page.locator('tr[data-test="ligne-media"]')).toContainText('décodé');
  // On cible A3 pour y poser le média sans écraser la démo.
  await page.locator('.entete-piste').nth(A3).locator('button').first().click();
  await page.locator('.entete-piste').nth(A1).locator('button').first().click();
  await page.getByTitle('Poser à la tête de lecture (overwrite)').click();
  await expect(ligne(page, 'audio_enveloppe.wav')).toBeVisible();

  // Zoom sur le clip pour que la forme d'onde occupe une largeur mesurable.
  await page.getByTitle('Zoom avant').click();
  await page.getByTitle('Zoom avant').click();
  await page.waitForTimeout(300);

  const apres = await pixelsClairs(A3);
  expect(apres).toBeGreaterThan(avant + 500);

  // Un clip audio SANS média décodé ne reçoit aucune forme d'onde : on ne
  // dessine pas de courbe inventée (§1003). A2 porte Ambiance_salle.wav, qui
  // n'a pas de fichier derrière lui.
  expect(await pixelsClairs(A2)).toBeLessThan(apres / 4);
});

test('la lecture avance sur l’horloge audio (§22)', async ({ page }) => {
  const fixture = new URL('../fixtures/generated/audio_enveloppe.wav', import.meta.url).pathname;
  await page.locator('input[data-test="import-medias"]').setInputFiles(fixture);
  // « décodé · lisible » signifie que le tampon audio est en mémoire.
  await expect(page.locator('tr[data-test="ligne-media"]')).toContainText('décodé · lisible');

  const A3 = 5;
  await page.locator('.entete-piste').nth(A3).locator('button').first().click();
  await page.getByTitle('Poser à la tête de lecture (overwrite)').click();
  await expect(ligne(page, 'audio_enveloppe.wav')).toBeVisible();

  const tc = page.locator('.barre-etat .mono').first();
  await expect(tc).toHaveText('01:00:00:00');

  await page.getByTestId('lecture').click();
  await expect(page.getByTestId('etat-lecture')).toContainText('· son');

  // L'horloge audio doit faire avancer la tête toute seule.
  await page.waitForTimeout(900);
  const pendant = await tc.innerText();
  expect(pendant).not.toBe('01:00:00:00');

  await page.getByTestId('lecture').click();
  await expect(page.getByTestId('etat-lecture')).toHaveCount(0);

  // Et elle s'arrête vraiment : la position ne bouge plus.
  const arret = await tc.innerText();
  await page.waitForTimeout(500);
  expect(await tc.innerText()).toBe(arret);
});

test('la lecture avance à une vitesse cohérente avec la cadence', async ({ page }) => {
  const fixture = new URL('../fixtures/generated/audio_enveloppe.wav', import.meta.url).pathname;
  await page.locator('input[data-test="import-medias"]').setInputFiles(fixture);
  await expect(page.locator('tr[data-test="ligne-media"]')).toContainText('décodé · lisible');
  await page.locator('.entete-piste').nth(5).locator('button').first().click();
  await page.getByTitle('Poser à la tête de lecture (overwrite)').click();

  const tc = page.locator('.barre-etat .mono').first();
  await page.getByTestId('lecture').click();
  await page.waitForTimeout(1200);
  const texte = await tc.innerText();
  await page.getByTestId('lecture').click();

  // 01:00:0S:FF — à 25 i/s, 1,2 s de lecture donne entre 0,5 s et 2 s écoulées.
  const m = /^01:00:(\d\d):(\d\d)$/.exec(texte.trim());
  expect(m, `timecode inattendu : ${texte}`).not.toBeNull();
  const secondes = Number(m?.[1] ?? 0) + Number(m?.[2] ?? 0) / 25;
  expect(secondes).toBeGreaterThan(0.4);
  expect(secondes).toBeLessThan(2.5);
});

test('le moniteur affiche l’image EXACTE de la tête de lecture (§22, §901-1000)', async ({
  page,
}) => {
  // VP9 en MP4 : même démultiplexeur que pour H.264, mais décodable par les
  // navigateurs dépourvus de codecs propriétaires.
  const fixture = new URL('../fixtures/generated/vp9_25.mp4', import.meta.url).pathname;
  await page.locator('input[data-test="import-medias"]').setInputFiles(fixture);

  const media = page.locator('tr[data-test="ligne-media"]');
  // Le démultiplexeur donne la cadence et le codec EXACTS, là où un élément
  // vidéo ne donnerait qu'une durée approchée.
  await expect(media).toContainText('25 i/s');
  await expect(media).toContainText('vp09');
  await expect(media).toContainText('démuxé · décodable');

  await page.getByTitle('Poser à la tête de lecture (overwrite)').click();
  await expect(ligne(page, 'vp9_25.mp4')).toBeVisible();

  const toile = page.getByTestId('image-programme');
  const tc = page.locator('.barre-etat .mono').first();

  // On place la tête sur des images précises et on vérifie que l'horodatage de
  // l'image décodée correspond EXACTEMENT, à l'image près.
  await page.locator('.timeline-toile canvas').click({ position: { x: 40, y: 10 } });
  await page.keyboard.press('Home');

  for (const image of [0, 7, 12, 30, 49]) {
    await page.keyboard.press('Home');
    for (let i = 0; i < image; i += 1) await page.keyboard.press('ArrowRight');
    await expect(tc).toHaveText(
      `01:00:${String(Math.floor(image / 25)).padStart(2, '0')}:${String(image % 25).padStart(2, '0')}`,
    );
    // 1 image à 25 i/s = 40 000 µs.
    await expect(toile).toHaveAttribute('data-pts', String(image * 40000));
  }
});

test('un média vidéo non décodable est annoncé, pas affiché en erreur', async ({ page }) => {
  // Ce navigateur de test n'a pas les codecs propriétaires : le H.264 doit être
  // démultiplexé correctement mais annoncé comme nécessitant un proxy (§60).
  const fixture = new URL('../fixtures/generated/cfr_25.mp4', import.meta.url).pathname;
  await page.locator('input[data-test="import-medias"]').setInputFiles(fixture);

  const media = page.locator('tr[data-test="ligne-media"]');
  await expect(media).toContainText('avc1');
  await expect(media).toContainText('25 i/s');
  // Démultiplexé sans problème ; c'est le DÉCODAGE que ce navigateur refuse.
  await expect(media).toContainText('démuxé');
});

test('la vidéo est lue en temps réel et suit l’horloge audio (§22, §121)', async ({ page }) => {
  const dossier = new URL('../fixtures/generated/', import.meta.url).pathname;
  await page
    .locator('input[data-test="import-medias"]')
    .setInputFiles([`${dossier}vp9_25.mp4`, `${dossier}audio_enveloppe.wav`]);
  await expect(page.locator('tr[data-test="ligne-media"]')).toHaveCount(2);

  const poser = page.getByTitle('Poser à la tête de lecture (overwrite)');
  await poser.nth(0).click(); // vidéo sur V1
  await page.locator('.entete-piste').nth(5).locator('button').first().click(); // cibler A3
  await poser.nth(1).click(); // audio sur A3

  const toile = page.getByTestId('image-programme');
  await expect(toile).toHaveAttribute('data-pts', '0');

  await page.getByTestId('lecture').click();
  await page.waitForTimeout(1500);

  const ptsPendant = Number(await toile.getAttribute('data-pts'));
  const tc = await page.locator('.barre-etat .mono').first().innerText();
  await page.getByTestId('lecture').click();

  // En 1,5 s, une séquence à 25 i/s doit avoir avancé de l'ordre de 37 images.
  // On accepte largement, la machine de test n'étant pas une station de montage.
  const imageAffichee = ptsPendant / 40000;
  expect(imageAffichee).toBeGreaterThan(12);
  expect(imageAffichee).toBeLessThan(50);

  // Et surtout : l'image affichée correspond à la tête de lecture, qui est
  // pilotée par l'horloge audio. Les deux ne dérivent pas l'une de l'autre.
  const m = /^01:00:(\d\d):(\d\d)$/.exec(tc.trim());
  const imageTete = Number(m?.[1] ?? 0) * 25 + Number(m?.[2] ?? 0);
  expect(Math.abs(imageTete - imageAffichee)).toBeLessThanOrEqual(6);
});

test('les vignettes de timeline sont de vraies images décodées (§18)', async ({ page }) => {
  const fixture = new URL('../fixtures/generated/vp9_25.mp4', import.meta.url).pathname;
  await page.locator('input[data-test="import-medias"]').setInputFiles(fixture);
  await expect(page.locator('tr[data-test="ligne-media"]')).toContainText('démuxé · décodable');
  await page.getByTitle('Poser à la tête de lecture (overwrite)').click();

  /** Compte les couleurs distinctes dans la bande de la piste V1. */
  const richesse = async (): Promise<number> => {
    const entete = await page.locator('.entete-piste').nth(2).boundingBox(); // V1
    const toile = await page.locator('.timeline-toile canvas').boundingBox();
    if (entete === null || toile === null) throw new Error('géométrie introuvable');
    const y = entete.y - toile.y + entete.height / 2;
    return page.evaluate((yy) => {
      const canvas = document.querySelector('.timeline-toile canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return 0;
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      const bande = ctx.getImageData(
        0,
        Math.round((yy - 15) * dpr),
        Math.round(400 * dpr),
        Math.round(30 * dpr),
      ).data;
      const couleurs = new Set<string>();
      for (let i = 0; i < bande.length; i += 4 * 13) {
        couleurs.add(
          `${(bande[i] ?? 0) >> 4},${(bande[i + 1] ?? 0) >> 4},${(bande[i + 2] ?? 0) >> 4}`,
        );
      }
      return couleurs.size;
    }, y);
  };

  // Sans vignette, la piste est un aplat : très peu de couleurs distinctes.
  const avant = await richesse();

  // On zoome pour atteindre le niveau de détail qui affiche les vignettes (§55).
  await page.locator('.timeline-toile canvas').click({ position: { x: 40, y: 10 } });
  await page.keyboard.press('Home');
  for (let i = 0; i < 3; i += 1) await page.getByTitle('Zoom avant').click();

  // Les vignettes arrivent de façon asynchrone : on attend qu'elles soient là.
  await expect.poll(richesse, { timeout: 10_000 }).toBeGreaterThan(avant + 15);
});

test('déplacer un clip lié déplace aussi son audio (§80)', async ({ page }) => {
  // Dans le projet de démonstration, chaque plan de V1 est lié à son son sur A1.
  const debutImage = await debutDe(page, 'A003_large');
  const debutSon = await debutDe(page, 'A003_large.wav');
  expect(debutSon).toBe(debutImage);

  // V1 est la troisième piste affichée (V3, V2, V1, ...).
  const cible = await centreClip(page, 2, 0.28);
  await page.mouse.move(cible.x, cible.y);
  await page.mouse.down();
  await page.mouse.move(cible.x, cible.y + 2, { steps: 3 });
  await page.mouse.up();

  // La sélection doit avoir pris les deux clips liés.
  await expect(page.locator('.barre-etat')).toContainText('2 sélectionnés');

  const depart = await centreClip(page, 2, 0.28);
  await page.mouse.move(depart.x, depart.y);
  await page.mouse.down();
  await page.mouse.move(depart.x + 220, depart.y, { steps: 20 });
  await page.mouse.up();

  const apresImage = await debutDe(page, 'A003_large');
  const apresSon = await debutDe(page, 'A003_large.wav');
  expect(apresImage).not.toBe(debutImage);
  // L'image et le son restent alignés : c'est tout l'intérêt de la liaison.
  expect(apresSon).toBe(apresImage);

  // Et une seule annulation suffit à revenir en arrière.
  await page.keyboard.press('Control+z');
  expect(await debutDe(page, 'A003_large')).toBe(debutImage);
  expect(await debutDe(page, 'A003_large.wav')).toBe(debutSon);
});

test('supprimer plusieurs clips ne demande qu’une seule annulation', async ({ page }) => {
  const avant = await page.locator('.table-projet').last().locator('tbody tr').count();

  // Sélection au rectangle sur les premières secondes de la timeline.
  const boite = await page.locator('.timeline-toile canvas').boundingBox();
  if (boite === null) throw new Error('canvas introuvable');
  await page.mouse.move(boite.x + 5, boite.y + 40);
  await page.mouse.down();
  await page.mouse.move(boite.x + 150, boite.y + boite.height - 20, { steps: 15 });
  await page.mouse.up();
  await expect(page.locator('.barre-etat')).not.toContainText('0 sélectionné');

  const etapesAvant = await historique(page).count();
  await page.keyboard.press('Delete');

  const apres = await page.locator('.table-projet').last().locator('tbody tr').count();
  expect(apres).toBeLessThan(avant);
  // UNE entrée d'historique, quel que soit le nombre de clips supprimés.
  await expect(historique(page)).toHaveCount(etapesAvant + 1);

  await page.keyboard.press('Control+z');
  await expect(page.locator('.table-projet').last().locator('tbody tr')).toHaveCount(avant);
});

test('points d’entrée et de sortie : Extract retire la plage et referme (§92)', async ({
  page,
}) => {
  const tc = page.locator('.barre-etat .mono').first();
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Home');

  // Le repérage se voit tout de suite dans le titre de la commande.
  await page.keyboard.press('KeyI');
  await expect(historique(page)).toContainText(['Points d’entrée et de sortie']);

  // Sortie une seconde plus loin : la plage couvre les images 0 à 25 exclue.
  for (let i = 0; i < 24; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('KeyO');
  await expect(tc).toHaveText('01:00:00:24');

  // Aller au point de sortie pose la tête SUR la dernière image de la plage.
  await page.keyboard.press('Shift+KeyO');
  await expect(tc).toHaveText('01:00:00:24');
  await page.keyboard.press('Shift+KeyI');
  await expect(tc).toHaveText('01:00:00:00');

  // Le deuxième plan démarre à 118 images ; après extraction d'une seconde il
  // doit démarrer 25 images plus tôt, et son audio lié avec lui.
  expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:04:18');
  await page.keyboard.press('Quote');
  await expect(historique(page)).toContainText(['Extract']);
  // 118 - 25 = 93 images, soit 3 s et 18 images après le départ de séquence.
  expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:03:18');
  // L'ambiance de A2 est synchronisée : elle a suivi le ripple, pas dérivé.
  expect(await debutDe(page, 'Ambiance_salle.wav')).toBe('01:00:00:00');
  await expect(page.locator('.barre-etat .alerte')).toHaveCount(0);

  // Une seule annulation rend tout le montage.
  await page.keyboard.press('Control+z');
  expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:04:18');
});

test('Lift laisse le trou là où Extract le referme (§92)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('KeyI');
  for (let i = 0; i < 24; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('KeyO');

  await page.keyboard.press('Semicolon'); // Lift
  await expect(historique(page)).toContainText(['Lift']);
  // Rien n'a bougé : c'est toute la différence avec Extract.
  expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:04:18');
});

test('Lift sans plage marquée refuse et explique (§1003, §106)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Semicolon');
  await expect(page.locator('.barre-etat .alerte')).toContainText('Aucune plage marquée');
  await expect(historique(page)).toHaveCount(1);
});

test('poser une entrée après la sortie efface la sortie plutôt que de refuser', async ({
  page,
}) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('KeyI');
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('KeyO');
  // On repart plus loin : l'entrée dépasse la sortie, qui doit disparaître.
  for (let i = 0; i < 30; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('KeyI');
  await page.keyboard.press('Semicolon');
  await expect(page.locator('.barre-etat .alerte')).toContainText('Aucune plage marquée');
});
