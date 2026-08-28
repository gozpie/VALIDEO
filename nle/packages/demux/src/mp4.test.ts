/**
 * Demultiplexage de VRAIS fichiers MP4 (§901-1000, §101).
 *
 * Les fixtures sont encodees par `scripts/make-fixtures.sh`. Les valeurs
 * attendues -- nombre d images, cadence, positions des images cles -- sont
 * celles que ffprobe lit sur les memes fichiers : on verifie donc notre
 * demultiplexeur contre une reference indiscutable.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isErr, unwrap } from '@valideo/shared';
import { CountingReader, MemoryReader } from './reader.js';
import { demultiplexerMp4, imageCleAvant, lireEchantillon, premierePiste } from './mp4.js';
import { boitesDe, u32 } from './boxes.js';

const ici = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(ici, '..', '..', '..', 'fixtures', 'generated');
const fixture = (nom: string): string => join(FIXTURES, nom);
const presentes = existsSync(fixture('cfr_25.mp4'));

function lecteur(nom: string): MemoryReader {
  return new MemoryReader(new Uint8Array(readFileSync(fixture(nom))));
}

/** Horodatages de présentation lus par ffprobe, en unités de time_base. */
function ptsDeReference(nom: string): number[] {
  const sortie = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'frame=pts',
      '-of',
      'csv=p=0',
      fixture(nom),
    ],
    { encoding: 'utf8' },
  );
  return sortie
    .split('\n')
    .map((l) => l.trim().replace(/,+$/, ''))
    .filter((l) => l !== '')
    .map(Number)
    .filter((v) => Number.isFinite(v));
}

const suite = presentes ? describe : describe.skip;

suite('démultiplexeur MP4', () => {
  it('lit un fichier H.264 : pistes, codec, définition', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('cfr_25.mp4')));
    expect(f.fragmente).toBe(false);
    const video = premierePiste(f, 'video');
    expect(video?.format).toBe('avc1');
    // Chaîne de codec au format attendu par WebCodecs.
    expect(video?.codec).toMatch(/^avc1\.[0-9a-f]{6}$/);
    expect(video?.largeur).toBe(320);
    expect(video?.hauteur).toBe(240);
    expect(video?.timescale).toBe(12800);
    expect(video?.description).not.toBeNull();
    // avcC commence toujours par sa version, qui vaut 1.
    expect(video?.description?.[0]).toBe(1);
  });

  it('lit la piste audio d un fichier mixte', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('cfr_25.mp4')));
    const audio = premierePiste(f, 'audio');
    expect(audio?.format).toBe('mp4a');
    expect(audio?.codec).toBe('mp4a.40.2');
    expect(audio?.canaux).toBeGreaterThan(0);
    expect(audio?.frequence).toBe(48000);
    expect(audio?.echantillons.length).toBeGreaterThan(50);
  });

  it('indexe exactement 50 images pour 2 secondes à 25 i/s', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('cfr_25.mp4')));
    const video = premierePiste(f, 'video');
    const e = video?.echantillons ?? [];
    expect(e).toHaveLength(50);
    // 12800 / 25 = 512 unités par image.
    expect(e[0]?.duree).toBe(512);
    expect((e[1]?.dts ?? 0) - (e[0]?.dts ?? 0)).toBe(512);
    // La première image affichée est bien à l'instant zéro.
    expect(Math.min(...e.map((s) => s.pts))).toBe(0);
  });

  it('applique la liste d édition : le dts de tête devient négatif, comme dans FFmpeg', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('cfr_25.mp4')));
    const e = premierePiste(f, 'video')?.echantillons ?? [];
    // Avec des images B, le décalage de composition vaut deux images ; la liste
    // d'édition le compense, ce qui place le premier dts avant zéro.
    expect(e[0]?.dts).toBeLessThan(0);
    // Invariant réel : le dts reste strictement croissant, c'est l'ordre dans
    // lequel un décodeur doit recevoir les échantillons.
    for (let i = 1; i < e.length; i += 1) {
      expect(e[i]!.dts).toBeGreaterThan(e[i - 1]!.dts);
    }
    // Et aucun échantillon n'est présenté avant d'être décodé.
    expect(e.every((s) => s.pts >= s.dts)).toBe(true);
  });

  it('donne les MÊMES horodatages de présentation que ffprobe', async () => {
    for (const nom of ['cfr_25.mp4', 'h264_gop12.mp4', 'vp9_25.mp4']) {
      const f = unwrap(await demultiplexerMp4(lecteur(nom)));
      const video = premierePiste(f, 'video');
      // ffprobe décode et restitue les images dans l'ordre d'AFFICHAGE ; nos
      // échantillons sont dans l'ordre de DÉCODAGE. On compare donc les deux
      // ensembles triés : c'est l'égalité qui compte, pas l'ordre.
      const attendus = [...ptsDeReference(nom)].sort((a, b) => a - b);
      const obtenus = (video?.echantillons.map((e) => e.pts) ?? []).sort((a, b) => a - b);
      expect(obtenus.length, nom).toBe(attendus.length);
      expect(obtenus, nom).toEqual(attendus);
    }
  });

  it('gère les images B : le pts diffère du dts et reste croissant une fois trié', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('h264_gop12.mp4')));
    const video = premierePiste(f, 'video');
    const e = video?.echantillons ?? [];
    // Avec des images B, au moins un échantillon a un pts différent de son dts.
    expect(e.some((s) => s.pts !== s.dts)).toBe(true);
    const tries = [...e].map((s) => s.pts).sort((a, b) => a - b);
    for (let i = 1; i < tries.length; i += 1) {
      expect(tries[i]).toBeGreaterThan(tries[i - 1]!);
    }
  });

  it('identifie les images clés, et il y en a plusieurs avec un GOP court', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('h264_gop12.mp4')));
    const video = premierePiste(f, 'video');
    const cles = video?.echantillons.filter((e) => e.cle) ?? [];
    expect(cles.length).toBeGreaterThan(2);
    // La première image est toujours une image clé.
    expect(video?.echantillons[0]?.cle).toBe(true);
  });

  it('trouve le point d entrée d un seek', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('h264_gop12.mp4')));
    const video = premierePiste(f, 'video');
    if (video === undefined) throw new Error('piste absente');
    const cles = video.echantillons.filter((e) => e.cle).map((e) => e.index);
    // Chercher juste avant la deuxième image clé doit renvoyer la première.
    const deuxieme = cles[1] ?? 0;
    const ptsDeuxieme = video.echantillons[deuxieme]?.pts ?? 0;
    expect(imageCleAvant(video, ptsDeuxieme - 1)).toBe(cles[0]);
    expect(imageCleAvant(video, ptsDeuxieme)).toBe(deuxieme);
    expect(imageCleAvant(video, 0)).toBe(0);
  });

  it('lit un VP9 encapsulé en MP4, avec sa chaîne de codec WebCodecs', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('vp9_25.mp4')));
    const video = premierePiste(f, 'video');
    expect(video?.format).toBe('vp09');
    expect(video?.codec).toMatch(/^vp09\.\d\d\.\d\d\.\d\d$/);
    expect(video?.echantillons).toHaveLength(50);
  });

  it('lit un MOV ProRes et le nomme, même si aucun navigateur ne le décode', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('prores_422hq.mov')));
    const video = premierePiste(f, 'video');
    expect(video?.format).toMatch(/^ap/);
    expect(video?.echantillons.length).toBeGreaterThan(0);
  });

  it('lit un fichier avec timecode embarqué sans se perdre dans la piste de données', async () => {
    const f = unwrap(await demultiplexerMp4(lecteur('cfr_2997_df.mov')));
    expect(premierePiste(f, 'video')?.echantillons).toHaveLength(60);
    // La piste de timecode existe mais n'est ni vidéo ni audio.
    expect(f.pistes.some((p) => p.type === 'autre')).toBe(true);
  });

  it('extrait les octets exacts d un échantillon', async () => {
    const r = lecteur('cfr_25.mp4');
    const f = unwrap(await demultiplexerMp4(r));
    const video = premierePiste(f, 'video');
    const premier = video?.echantillons[0];
    if (premier === undefined) throw new Error('échantillon absent');
    const octets = await lireEchantillon(r, premier);
    expect(octets.length).toBe(premier.taille);
    // En avcC, chaque unité NAL est précédée de sa longueur sur 4 octets.
    expect(u32(octets, 0) + 4).toBeLessThanOrEqual(octets.length);
  });

  it('ne lit PAS tout le fichier pour construire l index (§66)', async () => {
    const compteur = new CountingReader(lecteur('cfr_25.mp4'));
    unwrap(await demultiplexerMp4(compteur));
    // Le moov et quelques en-têtes suffisent : bien moins que le fichier entier.
    expect(compteur.octetsLus).toBeLessThan(compteur.taille / 2);
  });
});

suite('démultiplexeur MP4 — refus explicites', () => {
  it('refuse un fichier tronqué avec un message exploitable', async () => {
    const r = await demultiplexerMp4(lecteur('broken.mp4'));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('MEDIA_UNREADABLE');
      expect(r.error.detail).toBeTruthy();
    }
  });

  it('refuse un fichier qui n est pas du MP4', async () => {
    const r = await demultiplexerMp4(lecteur('audio_48k_stereo.wav'));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.message).toContain('MP4');
  });

  it('refuse un fichier vide', async () => {
    expect(isErr(await demultiplexerMp4(new MemoryReader(new Uint8Array(0))))).toBe(true);
  });

  it('refuse un Matroska plutôt que de produire un index vide', async () => {
    const r = await demultiplexerMp4(lecteur('vfr.mkv'));
    expect(isErr(r)).toBe(true);
  });
});

suite('lecture des boîtes', () => {
  it('énumère les boîtes de premier niveau', () => {
    const donnees = new Uint8Array(readFileSync(fixture('cfr_25.mp4')));
    const racines = boitesDe(donnees, 0, donnees.length);
    expect(racines[0]?.type).toBe('ftyp');
    expect(racines.map((b) => b.type)).toContain('moov');
    expect(racines.map((b) => b.type)).toContain('mdat');
    // Les tailles doivent couvrir le fichier sans trou.
    const total = racines.reduce((n, b) => n + b.taille, 0);
    expect(total).toBe(donnees.length);
  });
});
