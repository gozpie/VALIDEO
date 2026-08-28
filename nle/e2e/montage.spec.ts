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

/**
 * Ligne du panneau Projet correspondant à un clip, par nom EXACT.
 *
 * Deux pièges, tous deux rencontrés :
 *
 * 1. Le panneau Médias emploie la même classe de table ; un média homonyme
 *    d'un clip renvoyait sa ligne à sa place, avec des colonnes qui ne veulent
 *    pas dire la même chose. D'où `[data-clip]`.
 *
 * 2. Une recherche par sous-chaîne fait correspondre « A003_large » à
 *    « A003_large.wav », et les lignes audio passent avant les lignes vidéo
 *    dans le tri. On lisait donc le son en croyant lire l'image, et un test de
 *    rolling trim passait sans rien vérifier. D'où le nom exact.
 */
function ligne(page: Page, nom: string): Locator {
  return page.locator(`.table-projet tbody tr[data-nom="${nom}"]`).first();
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

/**
 * Clique un bouton qui ouvre un sélecteur de fichier, et fournit le fichier.
 *
 * Passer par le bouton n'est pas un détail : c'est lui qui mémorise le média
 * visé. Écrire directement dans l'input caché sauterait cette étape et
 * testerait un chemin que personne n'emprunte.
 */
async function choisirFichier(page: Page, testId: string, chemin: string): Promise<void> {
  const [selecteur] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId(testId).click(),
  ]);
  await selecteur.setFiles(chemin);
}

/** Sélectionne un clip par un appui-relâché sur place, comme le ferait un monteur. */
async function selectionnerClip(page: Page, indexPiste: number, fraction: number): Promise<void> {
  const c = await centreClip(page, indexPiste, fraction);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x, c.y + 2, { steps: 3 });
  await page.mouse.up();
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

test('l’outil Lame coupe le plan ET son son lié (§80, §94)', async ({ page }) => {
  const clips = (): Locator => page.locator('.table-projet tbody tr[data-clip]');
  const avant = await clips().count();
  await page.keyboard.press('KeyC');
  await expect(page.locator('.outil.actif')).toHaveText('C');

  const cible = await centreClip(page, 2, 0.2); // V1
  await page.mouse.click(cible.x, cible.y);

  // Deux clips de plus : couper l'image sans couper le son laisserait une
  // moitié d'image liée à un son entier, désynchronisée au premier mouvement.
  await expect(clips()).toHaveCount(avant + 2);
  await expect(historique(page)).toContainText(['Lame']);

  // Une seule annulation rend les deux coupes : c'est une seule opération.
  await page.keyboard.press('Control+z');
  await expect(clips()).toHaveCount(avant);
});

test('Alt avec la Lame ne coupe que la piste visée', async ({ page }) => {
  const clips = (): Locator => page.locator('.table-projet tbody tr[data-clip]');
  const avant = await clips().count();
  await page.keyboard.press('KeyC');
  const cible = await centreClip(page, 2, 0.2);
  await page.keyboard.down('Alt');
  await page.mouse.click(cible.x, cible.y);
  await page.keyboard.up('Alt');
  await expect(clips()).toHaveCount(avant + 1);
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

test('copier-coller reproduit le montage à la tête de lecture (§93)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  const avant = await page.locator('.table-projet tbody tr').count();

  // On sélectionne le premier plan, image et son liés. Un clic simple ne suffit
  // pas : la timeline sélectionne au pointeur, comme pour amorcer un geste.
  await selectionnerClip(page, 2, 0.05);
  await expect(page.locator('.barre-etat')).toContainText('2 sélectionnés');

  await page.keyboard.press('Control+c');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  await expect(historique(page)).toContainText(['Coller']);

  // Deux clips de plus : l'image et le son, chacun sur sa piste.
  await expect(page.locator('.table-projet tbody tr')).toHaveCount(avant + 2);
  await expect(page.locator('.barre-etat .alerte')).toHaveCount(0);

  // Une seule annulation défait tout le collage.
  await page.keyboard.press('Control+z');
  await expect(page.locator('.table-projet tbody tr')).toHaveCount(avant);
});

test('couper laisse le trou puis se colle ailleurs', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  const avant = await page.locator('.table-projet tbody tr').count();
  await selectionnerClip(page, 2, 0.05);

  await page.keyboard.press('Control+x');
  await expect(historique(page)).toContainText(['Supprimer']);
  // Le reste du montage n'a pas bougé : couper n'est pas un ripple.
  expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:04:18');
  await expect(page.locator('.table-projet tbody tr')).toHaveCount(avant - 2);

  // Et ce qui a été coupé se recolle : c'est un déplacement en deux temps.
  await page.keyboard.press('End');
  await page.keyboard.press('Control+v');
  await expect(historique(page)).toContainText(['Coller']);
  await expect(page.locator('.table-projet tbody tr')).toHaveCount(avant);
  await expect(page.locator('.barre-etat .alerte')).toHaveCount(0);
});

test('coller sans rien avoir copié le dit au lieu de ne rien faire (§1003)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Control+v');
  await expect(page.locator('.barre-etat .alerte')).toContainText('presse-papiers est vide');
  await expect(historique(page)).toHaveCount(1);
});

test('tout sélectionner prend les clips des pistes déverrouillées', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Control+a');
  // 7 plans + 7 sons + 2 clips sur V2 + 1 ambiance = 17.
  await expect(page.locator('.barre-etat')).toContainText('17 sélectionnés');
});

test('coller par insertion décale la suite au lieu de l’écraser (§91)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await selectionnerClip(page, 2, 0.05); // A001, 118 images
  await page.keyboard.press('Control+c');

  // Tête au début du deuxième plan, puis collage par insertion.
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+Shift+v');
  await expect(historique(page)).toContainText(['Coller par insertion']);

  // A002 était à 118 ; il recule de la durée collée, sans être écrasé.
  expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:09:11');
  await expect(page.locator('.barre-etat .alerte')).toHaveCount(0);
});

test('la boîte Vitesse et durée change réellement la vitesse (§38)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await selectionnerClip(page, 2, 0.05);
  // Un plan lié : deux clips sélectionnés, ce que la boîte refuse.
  await page.keyboard.press('Control+r');
  await expect(page.locator('.barre-etat .alerte')).toContainText('un seul clip');

  // On sélectionne l'ambiance de A2, qui n'est liée à rien.
  await selectionnerClip(page, 4, 0.4);
  await expect(page.locator('.barre-etat')).toContainText('1 sélectionné');
  await page.keyboard.press('Control+r');

  const boite = page.locator('.modale');
  await expect(boite).toBeVisible();
  // La durée affichée est celle du clip : 825 images.
  await expect(page.getByTestId('vitesse-duree')).toHaveValue('825');

  // Taper dans un champ ne doit PAS armer un outil de montage : sans cette
  // garantie, saisir « 0,25 » ou un nom déclencherait la lame et le ripple.
  await page.getByTestId('vitesse-pourcent').press('c');
  await expect(page.locator('.timeline-outils button.outil.actif')).toHaveText('V');

  await page.getByTestId('vitesse-pourcent').fill('200');
  // Les deux champs sont liés : la durée suit immédiatement.
  await expect(page.getByTestId('vitesse-duree')).toHaveValue('413');

  await boite.locator('button.principal').click();
  await expect(boite).toHaveCount(0);
  await expect(historique(page)).toContainText(['Vitesse et durée']);

  // Ce que la boîte ne sait pas faire est écrit, pas caché.
  await selectionnerClip(page, 4, 0.2);
  await page.keyboard.press('Control+r');
  await expect(page.locator('.modale')).toContainText('hauteur du son : indisponible');
  await page.keyboard.press('Escape');
  await expect(page.locator('.modale')).toHaveCount(0);
});

test('marqueurs : poser, naviguer, refuser un doublon (§41)', async ({ page }) => {
  const tc = page.locator('.barre-etat .mono').first();
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Home');

  // Le projet de démonstration en contient déjà trois.
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('KeyM');
  await expect(historique(page)).toContainText(['Ajouter un marqueur']);

  // Deux fois au même endroit : refusé et dit.
  await page.keyboard.press('KeyM');
  await expect(page.locator('.barre-etat .alerte')).toContainText('déjà un marqueur');

  // Navigation : retour au marqueur qu'on vient de poser.
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+KeyM');
  await expect(tc).toHaveText('01:00:00:05');
});

test('lier et délier bascule sur la sélection (§80)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  // Le premier plan est lié : sélectionner l'image prend aussi le son.
  await selectionnerClip(page, 2, 0.05);
  await expect(page.locator('.barre-etat')).toContainText('2 sélectionnés');

  await page.keyboard.press('Control+Shift+l');
  await expect(historique(page)).toContainText(['Délier']);

  // Délié : sélectionner l'image ne prend plus que l'image.
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await selectionnerClip(page, 2, 0.05);
  await expect(page.locator('.barre-etat')).toContainText('1 sélectionné');
});

test('Insert et Overwrite posent le média sélectionné (§91)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  // Rien de sélectionné dans le panneau Médias : la touche le dit.
  await page.keyboard.press('Period');
  await expect(page.locator('.barre-etat .alerte')).toContainText('Aucun média sélectionné');

  await page.getByTestId('import-medias').setInputFiles('fixtures/generated/audio_48k_stereo.wav');
  await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);
  await page.locator('[data-test="ligne-media"]').click();

  await page.keyboard.press('Home');
  await page.keyboard.press('Period'); // Overwrite
  await expect(historique(page)).toContainText(['Overwrite']);

  const apresOverwrite = await page.locator('.table-projet').last().locator('tbody tr').count();
  await page.keyboard.press('Comma'); // Insert
  await expect(historique(page)).toContainText(['Insert']);
  await expect(page.locator('.table-projet').last().locator('tbody tr')).toHaveCount(
    apresOverwrite + 1,
  );
  await expect(page.locator('.barre-etat .alerte')).toHaveCount(0);
});

test('le trim ripple jusqu’à la tête retire la portion et referme', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown'); // fin du premier plan, 118
  await page.keyboard.press('ArrowUp');
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');

  // Q retire de la tête jusqu'au point de montage précédent, et referme.
  await page.keyboard.press('KeyQ');
  await expect(historique(page)).toContainText(['Ripple trim jusqu’à la tête (précédent)']);
  // Dix images retirées : le plan suivant recule d'autant.
  expect(await debutDe(page, 'A002_contrechamp')).toBe('01:00:04:08');
  // Et l'ambiance synchronisée de A2 a été raccourcie, pas décalée.
  expect(await debutDe(page, 'Ambiance_salle.wav')).toBe('01:00:00:00');
});

test('glisser-déposer un média sur la timeline crée un clip (§91)', async ({ page }) => {
  await page.getByTestId('import-medias').setInputFiles('fixtures/generated/audio_48k_stereo.wav');
  await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);

  const source = page.locator('[data-test="ligne-media"]').first();
  // A1 est la cinquième piste affichée (V3, V2, V1, A1, A2, A3, A4).
  const cible = await centreClip(page, 3, 0.7);

  await source.hover();
  await page.mouse.down();
  await page.mouse.move(cible.x, cible.y, { steps: 12 });
  // L'aperçu de dépose est visible AVANT le relâchement : on voit où ça tombe.
  await expect(page.locator('.timeline-toile')).toHaveAttribute('data-depose', 'overwrite');
  await page.mouse.up();

  await expect(historique(page)).toContainText(['Overwrite']);
  await expect(page.locator('.timeline-toile')).not.toHaveAttribute('data-depose', 'overwrite');
});

test('déposer un média audio sur une piste vidéo est refusé et expliqué', async ({ page }) => {
  await page.getByTestId('import-medias').setInputFiles('fixtures/generated/audio_48k_stereo.wav');
  await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);

  const source = page.locator('[data-test="ligne-media"]').first();
  const cible = await centreClip(page, 2, 0.7); // V1
  await source.hover();
  await page.mouse.down();
  await page.mouse.move(cible.x, cible.y, { steps: 12 });
  await page.mouse.up();

  await expect(page.locator('.barre-etat .alerte')).toContainText('est un média audio');
  await expect(historique(page)).toHaveCount(1);
});

test('Alt sur un clip le remplace sans le déplacer ni le rallonger (§91)', async ({ page }) => {
  // 4 s à 25 i/s = 100 images : assez pour couvrir A004, qui en dure 62.
  await page.getByTestId('import-medias').setInputFiles('fixtures/generated/audio_enveloppe.wav');
  await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);

  const debutAvant = await debutDe(page, 'A004_insert_mains.wav');
  const source = page.locator('[data-test="ligne-media"]').first();
  // A1 est la quatrième piste affichée. La fraction vise A004 : elle est
  // relevée sur la vue réelle, pas déduite d'un rapport d'images — la vue
  // ajustée garde une marge, et supposer l'échelle donnait le clip d'à côté.
  const cible = await centreClip(page, 3, 0.4);

  await source.hover();
  await page.mouse.down();
  await page.mouse.move(cible.x, cible.y, { steps: 12 });
  await page.keyboard.down('Alt');
  await page.mouse.move(cible.x + 1, cible.y, { steps: 2 });
  await expect(page.locator('.timeline-toile')).toHaveAttribute('data-depose', 'replace');
  await page.mouse.up();
  await page.keyboard.up('Alt');

  await expect(historique(page)).toContainText(['Remplacer le clip']);
  // Le clip n'a ni bougé ni changé de longueur : seule sa source a changé.
  expect(await debutDe(page, 'audio_enveloppe.wav')).toBe(debutAvant);
  await expect(page.locator('.barre-etat .alerte')).toHaveCount(0);
});

test('un remplaçant trop court est refusé, pas rallongé en silence', async ({ page }) => {
  // 2 s = 50 images, pour un clip d'ambiance qui en dure 825.
  await page.getByTestId('import-medias').setInputFiles('fixtures/generated/audio_48k_stereo.wav');
  await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);

  const source = page.locator('[data-test="ligne-media"]').first();
  const cible = await centreClip(page, 4, 0.3); // A2, l'ambiance continue
  await source.hover();
  await page.mouse.down();
  await page.mouse.move(cible.x, cible.y, { steps: 12 });
  await page.keyboard.down('Alt');
  await page.mouse.move(cible.x + 1, cible.y, { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up('Alt');

  await expect(page.locator('.barre-etat .alerte')).toContainText('trop court');
  await expect(historique(page)).toHaveCount(1);
});

test('mettre un média hors ligne garde les clips et le signale (§8, §106)', async ({ page }) => {
  await page.getByTestId('import-medias').setInputFiles('fixtures/generated/audio_48k_stereo.wav');
  await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);
  await page.locator('[data-test="ligne-media"]').locator('button').first().click();
  const clipsAvant = await page.locator('.table-projet tbody tr[data-clip]').count();

  await page.getByTestId('hors-ligne').click();
  await expect(page.getByTestId('etat-media')).toHaveText('hors ligne');

  // Le montage n'est PAS détruit : un fichier absent n'efface pas un travail.
  await expect(page.locator('.table-projet tbody tr[data-clip]')).toHaveCount(clipsAvant);
  // Et le média hors ligne ne peut plus être posé.
  await expect(page.locator('[data-test="ligne-media"]').locator('button').first()).toBeDisabled();

  // Insert le refuse en le disant, plutôt que de poser un clip vide.
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Comma');
  await expect(page.locator('.barre-etat .alerte')).toContainText('hors ligne');
});

test('relier un média refuse un fichier trop court pour le montage', async ({ page }) => {
  await page.getByTestId('import-medias').setInputFiles('fixtures/generated/audio_enveloppe.wav');
  await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);
  await page.locator('[data-test="ligne-media"]').locator('button').first().click();
  await page.getByTestId('hors-ligne').click();

  // 1 s à la place de 4 : le montage en utilise plus que ça.
  await choisirFichier(page, 'relier', 'fixtures/generated/audio_96k.wav');
  await expect(page.locator('.barre-etat .alerte')).toContainText('trop court');
  await expect(page.getByTestId('etat-media')).toHaveText('hors ligne');
});

test('relier un média compatible le remet en ligne', async ({ page }) => {
  await page.getByTestId('import-medias').setInputFiles('fixtures/generated/audio_96k.wav');
  await expect(page.locator('[data-test="ligne-media"]')).toHaveCount(1);
  await page.locator('[data-test="ligne-media"]').locator('button').first().click();
  await page.getByTestId('hors-ligne').click();
  await expect(page.getByTestId('etat-media')).toHaveText('hors ligne');

  // Un fichier plus long convient : la reliaison ne tronque rien.
  await choisirFichier(page, 'relier', 'fixtures/generated/audio_enveloppe.wav');
  await expect(page.getByTestId('etat-media')).toContainText('décodé');
  await expect(page.locator('.barre-etat .alerte')).toHaveCount(0);
});

test('menu contextuel sur un clip : contenu, grisage motivé, action réelle', async ({ page }) => {
  const cible = await centreClip(page, 2, 0.28); // A003_large
  await page.mouse.click(cible.x, cible.y, { button: 'right' });

  const menu = page.locator('.menu-contextuel');
  await expect(menu).toBeVisible();
  // Le clic droit a sélectionné le clip et son son lié.
  await expect(page.locator('.barre-etat')).toContainText('2 sélectionnés');

  // Ce qui n'est pas applicable est grisé AVEC sa raison, pas masqué.
  await expect(page.getByTestId('menu-clip-coller')).toBeDisabled();
  await expect(page.getByTestId('menu-clip-coller')).toHaveAttribute(
    'title',
    'Le presse-papiers est vide.',
  );
  await expect(page.getByTestId('menu-clip-vitesse')).toBeDisabled();

  // Une action réelle : désactiver le clip.
  await page.getByTestId('menu-clip-actif').click();
  await expect(menu).toHaveCount(0);
  await expect(historique(page)).toContainText(['Désactiver le clip']);
});

test('menu contextuel sur un clip : étiquette par sous-menu', async ({ page }) => {
  const cible = await centreClip(page, 2, 0.28);
  await page.mouse.click(cible.x, cible.y, { button: 'right' });
  await page.getByTestId('menu-clip-etiquette').click();
  await expect(page.locator('.sous-menu')).toBeVisible();
  await page.getByTestId('menu-etiquette-3f9ea0').click();
  await expect(historique(page)).toContainText(['Étiqueter le clip']);
  await expect(page.locator('.menu-contextuel')).toHaveCount(0);
});

test('menu contextuel sur un en-tête de piste : ajouter et supprimer', async ({ page }) => {
  const entete = page.locator('.entete-piste').nth(2); // V1
  await entete.click({ button: 'right' });
  await expect(page.locator('.menu-contextuel')).toBeVisible();

  await page.getByTestId('menu-piste-ajouter-dessus').click();
  await expect(historique(page)).toContainText(['Ajouter une piste vidéo']);
  await expect(page.locator('.entete-piste')).toHaveCount(8);

  // Et la suppression, sur la piste qu'on vient d'ajouter.
  await page.locator('.entete-piste').nth(2).click({ button: 'right' });
  await page.getByTestId('menu-piste-supprimer').click();
  await expect(historique(page)).toContainText(['Supprimer la piste']);
  await expect(page.locator('.entete-piste')).toHaveCount(7);
});

test('menu contextuel sur l’espace vide propose le collage et les marques', async ({ page }) => {
  // V3 est vide : la première piste affichée.
  const cible = await centreClip(page, 0, 0.5);
  await page.mouse.click(cible.x, cible.y, { button: 'right' });
  await expect(page.getByTestId('menu-vide-marqueur')).toBeVisible();
  await expect(page.getByTestId('menu-vide-lift')).toBeDisabled();

  await page.getByTestId('menu-vide-marqueur').click();
  // Le projet a déjà un marqueur à l'image 0, où la tête se trouve : refusé.
  await expect(page.locator('.barre-etat .alerte')).toContainText('déjà un marqueur');

  // Une image plus loin, il passe.
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('ArrowRight');
  await page.mouse.click(cible.x, cible.y, { button: 'right' });
  await page.getByTestId('menu-vide-marqueur').click();
  await expect(historique(page)).toContainText(['Ajouter un marqueur']);
});

test('le menu contextuel se ferme à Échap et au clavier il navigue', async ({ page }) => {
  const cible = await centreClip(page, 2, 0.28);
  await page.mouse.click(cible.x, cible.y, { button: 'right' });
  const menu = page.locator('.menu-contextuel');
  await expect(menu).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.entree-menu.survolee')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // Échap n'a rien modifié.
  await expect(historique(page)).toHaveCount(1);
});

test('renommer une piste depuis son menu contextuel', async ({ page }) => {
  await page.locator('.entete-piste').nth(2).click({ button: 'right' });
  await page.getByTestId('menu-piste-renommer').click();
  await page.getByTestId('renommage-nom').fill('Image principale');
  await page.locator('.modale button.principal').click();
  await expect(historique(page)).toContainText(['Renommer la piste']);
  await expect(page.locator('.entete-piste').nth(2)).toContainText('Image principale');
});

test('la barre de menus déclenche de vraies actions (§1003)', async ({ page }) => {
  await page.getByTestId('barre-édition').click();
  const menu = page.locator('.menu-contextuel');
  await expect(menu).toBeVisible();
  // Rien n'a encore été fait : Annuler est grisé, avec sa raison.
  await expect(page.getByTestId('menu-bm-annuler')).toBeDisabled();
  await expect(page.getByTestId('menu-bm-annuler')).toHaveAttribute('title', 'Rien à annuler.');

  await page.getByTestId('menu-bm-tout').click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.barre-etat')).toContainText('17 sélectionnés');
});

test('l’export annonce qu’il n’existe pas au lieu de ne rien faire (§1003)', async ({ page }) => {
  await page.getByTestId('barre-fichier').click();
  await expect(page.getByTestId('menu-bm-exporter')).toBeDisabled();
  await expect(page.getByTestId('menu-bm-exporter')).toHaveAttribute(
    'title',
    /n’est pas implémenté/,
  );
  await page.keyboard.press('Escape');

  // Et au clavier, la touche le dit plutôt que de sembler perdue.
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Control+m');
  await expect(page.locator('.barre-etat .alerte')).toContainText('n’est pas implémenté');
});

test('la table des raccourcis est engendrée depuis le clavier en vigueur (§34)', async ({
  page,
}) => {
  await page.getByTestId('barre-aide').click();
  await page.getByTestId('menu-bm-raccourcis').click();
  const table = page.getByTestId('table-raccourcis');
  await expect(table).toBeVisible();
  await expect(table).toContainText('Lecture / Pause');

  await page.getByTestId('filtre-raccourcis').fill('lame');
  await expect(table.locator('tr')).toHaveCount(1);
  await expect(table).toContainText('C');

  await page.keyboard.press('Escape');
  await expect(table).toHaveCount(0);
});

test('la lecture en boucle reprend à l’entrée marquée (§22)', async ({ page }) => {
  await page.locator('.timeline-toile canvas').click({ position: { x: 5, y: 60 } });
  await page.keyboard.press('Home');
  await page.keyboard.press('KeyI');
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('KeyO');

  await page.getByTestId('boucle').click();
  await expect(page.getByTestId('etat-boucle')).toHaveText('boucle · plage');
  await expect(page.getByTestId('boucle')).toHaveAttribute('aria-pressed', 'true');

  // La tête revient dans la plage plutôt que de la dépasser.
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  const tc = await page.locator('.barre-etat .mono').first().innerText();
  const images = Number.parseInt(tc.split(':')[3] ?? '99', 10);
  expect(images).toBeLessThanOrEqual(13);
});
