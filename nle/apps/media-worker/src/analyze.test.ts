/**
 * Analyse de VRAIS fichiers media (sections 9, 13, 101).
 *
 * Ces tests ne lisent aucune sortie ffprobe enregistree : ils analysent des
 * fichiers reellement encodes par `scripts/make-fixtures.sh`. C est la seule
 * facon de verifier qu on lit correctement une cadence 24000/1001, un timecode
 * drop-frame embarque, une piste 5.1 ou une couche alpha.
 *
 * Si les fixtures ou ffmpeg manquent, la suite est ignoree avec un message
 * explicite plutot que de faire croire a une reussite (section 1003).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isErr, isOk, unwrap } from '@valideo/shared';
import { formatTimecode, timebase, rational } from '@valideo/time-core';
import { requiresProxy } from '@valideo/media-engine';
import { analyzeFile, ffprobeAvailable, probeFile } from './ffprobe.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', '..', '..', 'fixtures', 'generated');
const fixture = (name: string): string => join(FIXTURES, name);

const hasFixtures = existsSync(fixture('cfr_25.mp4'));
let hasFfprobe = false;
beforeAll(async () => {
  hasFfprobe = await ffprobeAvailable();
});

const suite = hasFixtures ? describe : describe.skip;
if (!hasFixtures) {
  // eslint-disable-next-line no-console
  console.warn(`Fixtures absentes de ${FIXTURES} — lancez scripts/make-fixtures.sh`);
}

suite('analyse de fichiers réels', () => {
  it('ffprobe est disponible', () => {
    expect(hasFfprobe).toBe(true);
  });

  it('lit une cadence 25 constante avec son audio', async () => {
    const { asset, warnings } = unwrap(await analyzeFile(fixture('cfr_25.mp4')));
    expect(asset.container).toBe('mov');
    expect(asset.videoStreams).toHaveLength(1);
    expect(asset.audioStreams).toHaveLength(1);
    expect(asset.videoStreams[0]?.frameRate).toEqual({ n: 25, d: 1 });
    expect(asset.videoStreams[0]?.variableFrameRate).toBe(false);
    expect(asset.videoStreams[0]?.codec).toBe('h264');
    expect(asset.videoStreams[0]?.width).toBe(320);
    expect(asset.audioStreams[0]?.sampleRate).toBe(48000);
    expect(asset.duration.frames).toBe(50); // 2 s à 25 i/s
    expect(warnings).toEqual([]);
    expect(asset.fileSize).toBeGreaterThan(0);
  });

  it('lit 23.976 comme la fraction exacte 24000/1001, jamais comme 23.976', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('cfr_23976.mp4')));
    expect(asset.videoStreams[0]?.frameRate).toEqual({ n: 24000, d: 1001 });
    expect(asset.duration.base.rate).toEqual({ n: 24000, d: 1001 });
    expect(asset.duration.frames).toBe(48);
    expect(asset.videoStreams[0]?.variableFrameRate).toBe(false);
  });

  it('lit 59.94 exactement', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('cfr_5994.mp4')));
    expect(asset.videoStreams[0]?.frameRate).toEqual({ n: 60000, d: 1001 });
  });

  it('lit un timecode drop-frame embarqué et le convertit en images', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('cfr_2997_df.mov')));
    expect(asset.videoStreams[0]?.frameRate).toEqual({ n: 30000, d: 1001 });
    expect(asset.duration.base.mode).toBe('DF');
    // 01:00:00;00 en drop-frame vaut 107892 images, pas 108000.
    expect(asset.startTimecode).toBe(107892);
    expect(formatTimecode(asset.startTimecode, timebase(rational(30000, 1001), 'DF'))).toBe(
      '01:00:00;00',
    );
  });

  it('lit un timecode non drop-frame', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('timecode_25.mov')));
    expect(asset.duration.base.mode).toBe('NDF');
    expect(asset.startTimecode).toBe(10 * 3600 * 25);
    expect(formatTimecode(asset.startTimecode, timebase(rational(25)))).toBe('10:00:00:00');
  });

  it('DÉTECTE une cadence variable que ffprobe annonce constante (§13)', async () => {
    // Le flux déclare « 30/1 ». Les horodatages réels disent autre chose.
    const probe = unwrap(await probeFile(fixture('vfr.mkv')));
    expect(probe.streams[0]?.r_frame_rate).toBe('30/1');

    const { asset, warnings } = unwrap(await analyzeFile(fixture('vfr.mkv')));
    expect(asset.videoStreams[0]?.variableFrameRate).toBe(true);
    expect(warnings.some((w) => w.includes('cadence variable'))).toBe(true);
  });

  it('lit un ProRes 422 HQ 10 bits', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('prores_422hq.mov')));
    const v = asset.videoStreams[0];
    expect(v?.codec).toBe('prores');
    expect(v?.profile).toBe('HQ');
    expect(v?.bitDepth).toBe(10);
    expect(v?.pixelFormat).toBe('yuv422p10le');
    expect(v?.hasAlpha).toBe(false);
    expect(v?.level).toBeNull(); // ffprobe met -99 : « sans objet »
    expect(requiresProxy(asset)).toBe(true);
  });

  it('lit un DNxHR HQ', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('dnxhr_hq.mov')));
    expect(asset.videoStreams[0]?.codec).toBe('dnxhd');
    expect(asset.videoStreams[0]?.profile).toBe('DNXHR HQ');
    expect(asset.videoStreams[0]?.width).toBe(1280);
    expect(requiresProxy(asset)).toBe(true);
  });

  it('détecte une couche alpha (§83)', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('alpha_prores4444.mov')));
    const v = asset.videoStreams[0];
    expect(v?.hasAlpha).toBe(true);
    expect(v?.alphaMode).toBe('straight');
    expect(v?.bitDepth).toBe(12);
    expect(v?.profile).toBe('4444');
  });

  it('lit une piste 5.1 en 24 bits (§31)', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('audio_51.wav')));
    const a = asset.audioStreams[0];
    expect(a?.channels).toBe(6);
    expect(a?.channelLayout).toBe('5.1');
    expect(a?.sampleRate).toBe(48000);
    expect(a?.bitDepth).toBe(24);
    expect(asset.videoStreams).toHaveLength(0);
  });

  it('lit un fichier 96 kHz', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('audio_96k.wav')));
    expect(asset.audioStreams[0]?.sampleRate).toBe(96000);
  });

  it('conserve la colorimétrie HDR déclarée sans la convertir (§29)', async () => {
    const { asset } = unwrap(await analyzeFile(fixture('hdr_pq.mp4')));
    const cs = asset.videoStreams[0]?.colorSpace;
    expect(cs?.primaries).toBe('bt2020');
    expect(cs?.transfer).toBe('smpte2084');
    expect(cs?.matrix).toBe('bt2020nc');
    expect(cs?.range).toBe('limited');
  });

  it('refuse un fichier corrompu avec un message exploitable (§106)', async () => {
    const r = await analyzeFile(fixture('broken.mp4'));
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('MEDIA_UNREADABLE');
      expect(r.error.action).toBe('Vérifier le fichier');
      expect(r.error.detail).toContain('broken.mp4');
    }
  });

  it('signale proprement un fichier inexistant', async () => {
    const r = await analyzeFile(fixture('inexistant.mov'));
    expect(isErr(r)).toBe(true);
  });

  it('sait quels médias exigent un proxy (§10, §11)', async () => {
    const h264 = unwrap(await analyzeFile(fixture('cfr_25.mp4')));
    expect(requiresProxy(h264.asset)).toBe(false);
    const prores = unwrap(await analyzeFile(fixture('prores_422hq.mov')));
    expect(requiresProxy(prores.asset)).toBe(true);
  });

  it('signale ffprobe manquant plutôt que d échouer obscurément', async () => {
    const r = await probeFile(fixture('cfr_25.mp4'), { ffprobePath: 'ffprobe-qui-n-existe-pas' });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.action).toBe('Installer FFmpeg');
      expect(r.error.message).toContain('introuvable');
    }
    expect(await ffprobeAvailable('ffprobe-qui-n-existe-pas')).toBe(false);
  });

  it('analyse les cinq cadences imposées par §100', async () => {
    const cas: [string, { n: number; d: number }][] = [
      ['cfr_23976.mp4', { n: 24000, d: 1001 }],
      ['cfr_25.mp4', { n: 25, d: 1 }],
      ['cfr_2997_df.mov', { n: 30000, d: 1001 }],
      ['cfr_50.mp4', { n: 50, d: 1 }],
      ['cfr_5994.mp4', { n: 60000, d: 1001 }],
    ];
    for (const [name, rate] of cas) {
      const r = await analyzeFile(fixture(name));
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.asset.videoStreams[0]?.frameRate).toEqual(rate);
    }
  });

  it('ne confond pas la durée avec la fenêtre d’échantillonnage des horodatages', async () => {
    // 30 s à 25 i/s = 750 images, soit plus que les 600 images lues pour
    // détecter une cadence variable. La durée annoncée doit rester la vraie.
    const { asset } = unwrap(await analyzeFile(fixture('long_750.mp4')));
    expect(asset.duration.frames).toBe(750);
    expect(asset.videoStreams[0]?.frameRate).toEqual({ n: 25, d: 1 });
    expect(asset.videoStreams[0]?.variableFrameRate).toBe(false);
  });

  it('détecte quand même la cadence variable sur un fichier long', async () => {
    // La détection se fait sur l'échantillon de tête : elle reste valide même
    // si le fichier dépasse la fenêtre.
    const { asset } = unwrap(await analyzeFile(fixture('vfr.mkv')));
    expect(asset.videoStreams[0]?.variableFrameRate).toBe(true);
  });
});
