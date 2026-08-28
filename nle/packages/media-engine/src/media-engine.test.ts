import { describe, it, expect } from 'vitest';
import { rational } from '@valideo/time-core';
import { pixelFormatInfo } from './pixel-format.js';
import { colorInfo, transferKind } from './color.js';
import { analyzeTimestamps } from './timestamps.js';
import { parseProbe } from './probe.js';
import {
  analyzeMedia,
  parseAspect,
  parseEmbeddedTimecode,
  parseFrameRate,
  requiresProxy,
} from './analyze.js';

describe('formats de pixel', () => {
  it('lit profondeur, alpha et sous-échantillonnage', () => {
    expect(pixelFormatInfo('yuv420p')).toMatchObject({
      bitDepth: 8,
      hasAlpha: false,
      chroma: '4:2:0',
      family: 'yuv',
    });
    expect(pixelFormatInfo('yuv422p10le')).toMatchObject({
      bitDepth: 10,
      hasAlpha: false,
      chroma: '4:2:2',
    });
    expect(pixelFormatInfo('yuva444p12le')).toMatchObject({
      bitDepth: 12,
      hasAlpha: true,
      chroma: '4:4:4',
    });
    expect(pixelFormatInfo('rgba')).toMatchObject({ hasAlpha: true, family: 'rgb' });
    expect(pixelFormatInfo('gbrap10le')).toMatchObject({
      hasAlpha: true,
      family: 'rgb',
      bitDepth: 10,
    });
    expect(pixelFormatInfo('gray')).toMatchObject({
      family: 'gray',
      hasAlpha: false,
      chroma: 'none',
    });
  });

  it('ne confond pas le « a » de yuva avec celui de yuv444', () => {
    expect(pixelFormatInfo('yuv444p').hasAlpha).toBe(false);
    expect(pixelFormatInfo('yuva444p').hasAlpha).toBe(true);
  });

  it('compte les composants pour les formats RGB profonds', () => {
    expect(pixelFormatInfo('rgb48le').bitDepth).toBe(16);
    expect(pixelFormatInfo('rgba64le').bitDepth).toBe(16);
  });
});

describe('colorimétrie', () => {
  it('reconnaît PQ et HLG comme HDR', () => {
    expect(transferKind('smpte2084')).toBe('pq');
    expect(transferKind('arib-std-b67')).toBe('hlg');
    expect(transferKind('bt709')).toBe('sdr');
    expect(transferKind('slog3')).toBe('log');
    expect(colorInfo('bt2020', 'smpte2084', 'bt2020nc', 'tv').hdr).toBe(true);
    expect(colorInfo('bt709', 'bt709', 'bt709', 'tv').hdr).toBe(false);
  });

  it('interprète par défaut en bt709 mais garde trace de ce qui n était pas déclaré', () => {
    const c = colorInfo(undefined, undefined, undefined, undefined);
    expect(c.primaries).toBe('bt709');
    expect(c.undeclared).toEqual(['primaries', 'transfer', 'matrix']);
  });

  it('traite « unknown » comme une absence de déclaration', () => {
    expect(colorInfo('unknown', 'reserved', '', 'pc').undeclared).toHaveLength(3);
    expect(colorInfo('unknown', 'reserved', '', 'pc').range).toBe('full');
  });
});

describe('analyse des horodatages (§13)', () => {
  const tb = rational(1, 1000);

  it('reconnaît une cadence constante', () => {
    const pts = Array.from({ length: 50 }, (_, i) => i * 0.04);
    const a = analyzeTimestamps(pts, tb);
    expect(a.variable).toBe(false);
    expect(a.measuredRate).toEqual({ n: 25, d: 1 });
    expect(a.frameCount).toBe(50);
  });

  it('ne prend pas la quantification du conteneur pour une cadence variable', () => {
    // 30 i/s dans une base 1/1000 : les écarts alternent 33 ms / 34 ms.
    const pts: number[] = [0];
    for (let i = 1; i < 60; i += 1) {
      // Exception assumée à la règle « pas d arrondi flottant » : on SIMULE ici
      // la quantification qu un conteneur applique à ses horodatages. C est
      // précisément le comportement que le test doit reproduire.
      // eslint-disable-next-line no-restricted-syntax
      pts.push(Math.round((i / 30) * 1000) / 1000);
    }
    expect(analyzeTimestamps(pts, tb).variable).toBe(false);
  });

  it('détecte une vraie cadence variable', () => {
    const pts = [0, 0.033, 0.066, 0.1, 0.2, 0.3, 0.4];
    const a = analyzeTimestamps(pts, tb);
    expect(a.variable).toBe(true);
    expect(a.maxDelta).toBeCloseTo(0.1, 6);
    expect(a.minDelta).toBeCloseTo(0.033, 6);
  });

  it('trie les horodatages arrivés en ordre de décodage', () => {
    // Ordre de décodage avec images B : 0.44 arrive après 0.48.
    const decodeOrder = [0, 0.04, 0.08, 0.16, 0.12];
    const a = analyzeTimestamps(decodeOrder, tb);
    expect(a.variable).toBe(false);
    expect(a.measuredRate).toEqual({ n: 25, d: 1 });
  });

  it('signale des horodatages en doublon', () => {
    expect(analyzeTimestamps([0, 0.04, 0.04, 0.08], tb).duplicateTimestamps).toBe(true);
    expect(analyzeTimestamps([0, 0.04, 0.08], tb).duplicateTimestamps).toBe(false);
  });

  it('ne s effondre pas sur une liste vide ou d une seule image', () => {
    expect(analyzeTimestamps([], tb).frameCount).toBe(0);
    expect(analyzeTimestamps([1.5], tb).variable).toBe(false);
  });
});

describe('lecture des valeurs ffprobe', () => {
  it('lit les cadences fractionnaires', () => {
    expect(parseFrameRate('24000/1001')).toEqual({ n: 24000, d: 1001 });
    expect(parseFrameRate('25/1')).toEqual({ n: 25, d: 1 });
    expect(parseFrameRate('0/0')).toBeNull();
    expect(parseFrameRate(undefined)).toBeNull();
    expect(parseFrameRate('n/a')).toBeNull();
  });

  it('lit les rapports d aspect', () => {
    expect(parseAspect('1:1')).toEqual({ n: 1, d: 1 });
    expect(parseAspect('64:45')).toEqual({ n: 64, d: 45 });
    expect(parseAspect('0:1')).toEqual({ n: 1, d: 1 });
    expect(parseAspect(undefined)).toEqual({ n: 1, d: 1 });
  });

  it('lit un timecode embarqué selon la cadence', () => {
    expect(parseEmbeddedTimecode('01:00:00:00', rational(25))).toBe(90000);
    // Le point-virgule impose le drop-frame quand la cadence le permet.
    expect(parseEmbeddedTimecode('01:00:00;00', rational(30000, 1001))).toBe(107892);
    // Sur du 25 i/s le point-virgule est une incohérence : on lit en non drop-frame.
    expect(parseEmbeddedTimecode('01:00:00;00', rational(25))).toBe(90000);
    expect(parseEmbeddedTimecode(undefined, rational(25))).toBe(0);
    expect(parseEmbeddedTimecode('nimporte quoi', rational(25))).toBe(0);
  });
});

describe('mise en modèle', () => {
  const probeJson = {
    streams: [
      {
        index: 0,
        codec_name: 'h264',
        codec_type: 'video',
        profile: 'High',
        level: 41,
        width: 1920,
        height: 1080,
        pix_fmt: 'yuv420p',
        sample_aspect_ratio: '1:1',
        r_frame_rate: '24000/1001',
        avg_frame_rate: '24000/1001',
        time_base: '1/24000',
        duration: '10.010000',
        nb_frames: '240',
        bits_per_raw_sample: '8',
        field_order: 'progressive',
        tags: { timecode: '01:00:00:00' },
      },
      {
        index: 1,
        codec_name: 'pcm_s24le',
        codec_type: 'audio',
        sample_rate: '48000',
        channels: 6,
        channel_layout: '5.1',
        bits_per_raw_sample: '24',
      },
    ],
    format: {
      format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
      duration: '10.010000',
      size: '12345678',
      tags: { creation_time: '2024-05-01T10:00:00.000000Z' },
    },
  };

  it('construit un média complet depuis une sortie ffprobe', () => {
    const { asset, warnings } = analyzeMedia(parseProbe(probeJson), { uri: '/rushes/A001.mov' });
    expect(asset.name).toBe('A001.mov');
    expect(asset.container).toBe('mov');
    expect(asset.videoStreams[0]?.frameRate).toEqual({ n: 24000, d: 1001 });
    expect(asset.videoStreams[0]?.profile).toBe('High');
    expect(asset.videoStreams[0]?.level).toBe('41');
    expect(asset.audioStreams[0]?.channelLayout).toBe('5.1');
    expect(asset.duration.frames).toBe(240);
    expect(asset.startTimecode).toBe(86400); // 01:00:00:00 à 23.976
    expect(asset.createdAt).toBe('2024-05-01T10:00:00.000000Z');
    expect(asset.fileSize).toBe(12345678);
    expect(asset.status).toBe('online');
    expect(warnings).toEqual([]);
  });

  it('déduit la durée quand le nombre d images n est pas annoncé', () => {
    const sansNbFrames = {
      ...probeJson,
      streams: [{ ...probeJson.streams[0], nb_frames: undefined }, probeJson.streams[1]],
    };
    const { asset } = analyzeMedia(parseProbe(sansNbFrames), { uri: '/x.mov' });
    // 10.01 s à 24000/1001 = exactement 240 images.
    expect(asset.duration.frames).toBe(240);
  });

  it('avertit sur un timecode drop-frame impossible', () => {
    const incoherent = {
      ...probeJson,
      streams: [
        {
          ...probeJson.streams[0],
          r_frame_rate: '25/1',
          avg_frame_rate: '25/1',
          tags: { timecode: '01:00:00;00' },
        },
        probeJson.streams[1],
      ],
    };
    const { asset, warnings } = analyzeMedia(parseProbe(incoherent), { uri: '/x.mov' });
    expect(asset.duration.base.mode).toBe('NDF');
    expect(warnings.some((w) => w.includes('drop-frame'))).toBe(true);
  });

  it('avertit sur une cadence variable', () => {
    const { warnings } = analyzeMedia(parseProbe(probeJson), {
      uri: '/x.mov',
      timestamps: {
        frameCount: 100,
        complet: true,
        variable: true,
        measuredRate: rational(30),
        averageRate: rational(24),
        minDelta: 0.02,
        maxDelta: 0.1,
        medianDelta: 0.04,
        duplicateTimestamps: false,
      },
    });
    expect(warnings.some((w) => w.includes('cadence variable'))).toBe(true);
  });

  it('avertit quand rien n est exploitable', () => {
    const { warnings } = analyzeMedia(parseProbe({ streams: [], format: {} }), {
      uri: '/vide.bin',
    });
    expect(warnings.some((w) => w.includes('Aucune piste'))).toBe(true);
  });

  it('sait quels codecs exigent un proxy', () => {
    const { asset } = analyzeMedia(parseProbe(probeJson), { uri: '/x.mov' });
    expect(requiresProxy(asset)).toBe(false);
    const prores = {
      ...probeJson,
      streams: [{ ...probeJson.streams[0], codec_name: 'prores' }, probeJson.streams[1]],
    };
    expect(requiresProxy(analyzeMedia(parseProbe(prores), { uri: '/x.mov' }).asset)).toBe(true);
  });

  it('accepte une sortie ffprobe incomplète sans lever', () => {
    expect(() =>
      analyzeMedia(parseProbe({ streams: [{ index: 0 }], format: {} }), { uri: '/x' }),
    ).not.toThrow();
  });
});
