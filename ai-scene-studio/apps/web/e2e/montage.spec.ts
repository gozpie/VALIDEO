import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { API_URL, EMAIL, PASSWORD } from './helpers';

/**
 * Phase 7.2 : le montage contre la vraie pile. Le film s'assemble tout seul à partir des plans,
 * survit au rechargement, et suit le studio quand un plan reçoit une version.
 */

// PNG 16×9 opaque, bleu.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR4nGPQiDpBEmIY1TAoNAAAk1q5oYIl8kcAAAAASUVORK5CYII=',
  'base64',
);

/** PNG uni, opaque, de la couleur demandée. */
function pngUni(r: number, g: number, b: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer): number => {
    let c = 0xffffffff;
    for (const octet of data) c = (crcTable[(c ^ octet) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const bloc = (type: string, data: Buffer): Buffer => {
    const taille = Buffer.alloc(4);
    taille.writeUInt32BE(data.length);
    const corps = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const somme = Buffer.alloc(4);
    somme.writeUInt32BE(crc(corps));
    return Buffer.concat([taille, corps, somme]);
  };
  const [largeur, hauteur] = [16, 9];
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(largeur, 0);
  entete.writeUInt32BE(hauteur, 4);
  entete.set([8, 2, 0, 0, 0], 8);
  const ligne = Buffer.concat([
    Buffer.from([0]),
    ...Array.from({ length: largeur }, () => Buffer.from([r, g, b])),
  ]);
  const image = Buffer.concat(Array.from({ length: hauteur }, () => ligne));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', entete),
    bloc('IDAT', deflateSync(image)),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

async function createFilm(page: Page) {
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
  const workspace = await post('/workspaces', { name: `Montage E2E ${Date.now().toString(36)}` });
  const project = await post(`/workspaces/${workspace.id}/projects`, {
    name: 'Le phare',
    fps: { numerator: 24, denominator: 1 },
  });
  const sequence = await post(`/projects/${project.id}/sequences`, { name: 'La tempête' });
  const shot = (name: string, durationFrames: number) =>
    post(`/sequences/${sequence.id}/shots`, { name, durationFrames });
  const marc = await shot('Marc rallume la lampe', 96);
  const mer = await shot('La mer se déchaîne', 72);
  const lea = await shot('Léa monte', 48);

  /** Dépose une image (contenu unique) et en fait une nouvelle version du plan. */
  const addVersion = async (shotId: string, variant: number, image: Buffer = PNG) => {
    const content = Buffer.concat([image, Buffer.from([variant])]);
    const upload = await page.request.post(`${API_URL}/projects/${project.id}/edit/media`, {
      headers,
      multipart: {
        file: { name: `version-${variant}.png`, mimeType: 'image/png', buffer: content },
      },
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const { asset } = (await upload.json()) as { asset: { id: string } };
    await post(`/shots/${shotId}/versions`, { assetId: asset.id });
  };
  const videoClips = async () => {
    const edit = (await (
      await page.request.get(`${API_URL}/projects/${project.id}/edit`)
    ).json()) as {
      document: {
        sequences: {
          tracks: {
            kind: string;
            index: number;
            clips: { kind: string; start: number; duration: number; name: string }[];
          }[];
        }[];
      } | null;
    };
    const track = edit.document?.sequences[0]?.tracks.find(
      (t) => t.kind === 'video' && t.index === 0,
    );
    return track?.clips ?? [];
  };
  const montage = async () => {
    const edit = (await (
      await page.request.get(`${API_URL}/projects/${project.id}/edit`)
    ).json()) as { document: DocumentMontage | null };
    const sequence = edit.document?.sequences[0];
    if (sequence === undefined) throw new Error('montage absent');
    return sequence;
  };
  return { projectId: project.id, marc, mer, lea, addVersion, videoClips, montage };
}

interface DocumentMontage {
  sequences: {
    masterGainDb: number;
    tracks: {
      kind: string;
      index: number;
      name: string;
      gainDb: number;
      clips: {
        id: string;
        kind: string;
        name: string;
        start: number;
        opacity: { value: number };
        blendMode: string;
        title: { text: string } | null;
        transform: { scale: { keyframes: { time: number }[] } };
      }[];
      transitions: { type: string; duration: number; fromClipId: string | null }[];
    }[];
  }[];
}

/** Couleur du centre de l'image du film. */
async function pixelCentral(page: Page): Promise<[number, number, number]> {
  return page.locator('[data-test="image-programme"]').evaluate((toile: HTMLCanvasElement) => {
    const ctx = toile.getContext('2d');
    if (ctx === null) throw new Error('contexte');
    const d = ctx.getImageData(toile.width >> 1, toile.height >> 1, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] as [number, number, number];
  });
}

async function allerA(page: Page, image: number, depuis: number): Promise<void> {
  const ecart = image - depuis;
  for (let i = 0; i < Math.abs(ecart); i += 1) {
    await page.keyboard.press(ecart > 0 ? 'ArrowRight' : 'ArrowLeft');
  }
}

test.describe('montage du film', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL et E2E_PASSWORD requis (compte de test)');
  test.setTimeout(120_000);

  test('le film s’assemble, se monte, survit au rechargement et suit le studio', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const film = await createFilm(page);
    await film.addVersion(film.marc.id, 1);
    await film.addVersion(film.lea.id, 2);

    // 1. Le film s'assemble tout seul : deux plans, et une attente à la place du troisième.
    await page.goto(`/projects/${film.projectId}/studio#montage`);
    const plans = page.locator('[data-test="plans-du-film"]');
    await expect(plans.locator('li')).toHaveCount(3, { timeout: 30_000 });
    await expect(plans).toContainText('À générer');
    await expect
      .poll(async () => (await film.videoClips()).map((c) => [c.kind, c.start, c.duration]), {
        timeout: 20_000,
      })
      .toEqual([
        ['video', 0, 96],
        ['colorMatte', 96, 72],
        ['video', 168, 48],
      ]);
    await expect(page.locator('[data-test="etat-film"]')).toHaveText('Enregistré');

    // 2. L'image du plan s'affiche dans le moniteur (décodée, pts 0).
    await expect(page.locator('[data-test="image-programme"]')).toHaveAttribute('data-pts', '0');

    // 3. ⌘K coupe sous la tête (et n'ouvre pas la palette) ; l'annulation revient en arrière.
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: /commande/i })).toHaveCount(0);
    await expect.poll(async () => (await film.videoClips()).length, { timeout: 10_000 }).toBe(4);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await film.videoClips()).length, { timeout: 10_000 }).toBe(3);

    // 4. Rechargement : le montage revient tel quel, sans plan en double, et les images reviennent.
    await expect(page.locator('[data-test="etat-film"]')).toHaveText('Enregistré');
    await page.reload();
    await expect(plans.locator('li')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.locator('[data-test="image-programme"]')).toHaveAttribute('data-pts', '0', {
      timeout: 15_000,
    });
    expect((await film.videoClips()).length).toBe(3);

    // 5. Le plan attendu reçoit sa version : au retour sur le montage, l'attente est remplacée.
    await film.addVersion(film.mer.id, 3);
    const steps = page.getByRole('complementary', { name: 'Navigation' });
    await steps.getByRole('button', { name: /Plans/ }).click();
    await steps.getByRole('button', { name: /Montage/ }).click();
    await expect(page.getByText('Film : 1 plan mis à jour')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => (await film.videoClips()).map((c) => [c.kind, c.start, c.duration]), {
        timeout: 15_000,
      })
      .toEqual([
        ['video', 0, 96],
        ['video', 96, 72],
        ['video', 168, 48],
      ]);
    await expect(plans).not.toContainText('À générer');

    expect(errors).toEqual([]);
  });

  test('composition : calques, fondu enchaîné, titre, images clés et mixage', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const film = await createFilm(page);
    await film.addVersion(film.marc.id, 11, pngUni(0, 0, 255));
    await film.addVersion(film.mer.id, 12, pngUni(255, 0, 0));
    await film.addVersion(film.lea.id, 13, pngUni(0, 255, 0));

    await page.goto(`/projects/${film.projectId}/studio#montage`);
    const moniteur = page.locator('[data-test="image-programme"]');
    await expect(moniteur).toHaveAttribute('data-pts', '0', { timeout: 30_000 });
    await expect.poll(() => pixelCentral(page), { timeout: 10_000 }).toEqual([0, 0, 255]);
    const onglet = (nom: string) => page.getByRole('tab', { name: nom, exact: true });

    // 1. Fondu enchaîné sur le raccord à 96 images (⌘D), au plus près de la tête : 24 images centrées.
    await allerA(page, 90, 0);
    await page.keyboard.press('ControlOrMeta+d');
    const transitionsV1 = async () =>
      (await film.montage()).tracks.find((t) => t.kind === 'video' && t.index === 0)?.transitions;
    await expect
      .poll(transitionsV1, { timeout: 10_000 })
      .toMatchObject([{ type: 'dissolve', duration: 24 }]);

    // Avant le fondu : bleu pur. Au milieu : moitié bleu, moitié rouge. Après : rouge pur.
    await allerA(page, 83, 90);
    await expect.poll(() => pixelCentral(page)).toEqual([0, 0, 255]);
    await allerA(page, 96, 83);
    await expect
      .poll(async () => {
        const [r, g, b] = await pixelCentral(page);
        return Math.abs(r - 133) < 8 && g === 0 && Math.abs(b - 122) < 8;
      })
      .toBe(true);
    await allerA(page, 108, 96);
    await expect.poll(() => pixelCentral(page)).toEqual([255, 0, 0]);

    // 2. Calque : le titre passe sur V2, le film continue dessous.
    await onglet('Transitions et titres').click();
    await page.locator('[data-test="titre-centre"]').click();
    await expect(moniteur).toHaveAttribute('data-calques', '2');
    await page.locator('[data-test="titre-texte"]').fill('Le phare\nde Léa');
    const titre = async () =>
      (await film.montage()).tracks
        .filter((t) => t.kind === 'video')
        .flatMap((t) => t.clips)
        .find((c) => c.kind === 'title');
    await expect
      .poll(async () => (await titre())?.title?.text, { timeout: 10_000 })
      .toBe('Le phare\nde Léa');
    expect((await titre())?.name).toBe('Le phare');

    // Le texte se voit vraiment : du blanc sur le fond rouge.
    const blanc = await moniteur.evaluate((toile: HTMLCanvasElement) => {
      const ctx = toile.getContext('2d');
      if (ctx === null) throw new Error('contexte');
      const d = ctx.getImageData(0, 0, toile.width, toile.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if ((d[i] ?? 0) > 240 && (d[i + 1] ?? 0) > 240 && (d[i + 2] ?? 0) > 240) n += 1;
      }
      return n;
    });
    expect(blanc).toBeGreaterThan(100);

    // 3. Opacité du titre : réglée, annulée d'un seul coup.
    await page.locator('[data-test="valeur-opacite"]').fill('25');
    await expect.poll(async () => (await titre())?.opacity.value, { timeout: 10_000 }).toBe(25);

    // 4. Image clé : le zoom lent pose deux clés sur l'échelle.
    await page.locator('[data-test="zoom-lent"]').click();
    await expect
      .poll(async () => (await titre())?.transform.scale.keyframes.length, { timeout: 10_000 })
      .toBe(2);

    // 5. Mixage : le fader de A1 et le volume général vont dans le montage.
    await onglet('Mixage').click();
    await page.locator('[data-test="fader-A1"] input').fill('-6');
    await page.locator('[data-test="fader-general"] input').fill('-3');
    await expect
      .poll(async () => (await film.montage()).masterGainDb, { timeout: 10_000 })
      .toBe(-3);
    expect((await film.montage()).tracks.find((t) => t.name === 'A1')?.gainDb).toBe(-6);

    // 6. Tout revient après rechargement ; et ⌘Z retire ce qui vient d'être fait.
    await expect(page.locator('[data-test="etat-film"]')).toHaveText('Enregistré');
    await page.reload();
    await expect(moniteur).toHaveAttribute('data-pts', '0', { timeout: 30_000 });
    expect(await transitionsV1()).toMatchObject([{ type: 'dissolve', duration: 24 }]);
    expect((await titre())?.title?.text).toBe('Le phare\nde Léa');
    await allerA(page, 96, 0);
    await expect
      .poll(async () => {
        const [r, , b] = await pixelCentral(page);
        return r > 100 && b > 100;
      })
      .toBe(true);

    // 7. La bande de la transition se sélectionne sur la timeline et se retire depuis ses réglages.
    const toile = page.locator('.timeline-toile');
    const vue = await toile.evaluate((n: HTMLElement) => ({
      echelle: Number(n.dataset['echelle']),
      defilement: Number(n.dataset['scroll']),
    }));
    const zone = await toile.boundingBox();
    const piste = await page.locator('.entete-piste', { hasText: /^V1/ }).boundingBox();
    if (zone === null || piste === null) throw new Error('timeline absente');
    await page.mouse.click(zone.x + 96 * vue.echelle - vue.defilement, piste.y + piste.height - 6);
    await onglet('Réglages').click();
    await page.locator('[data-test="retirer-transition"]').click();
    await expect.poll(transitionsV1, { timeout: 10_000 }).toEqual([]);
    await allerA(page, 90, 96);
    await expect.poll(() => pixelCentral(page)).toEqual([0, 0, 255]);

    expect(errors).toEqual([]);
  });
});
