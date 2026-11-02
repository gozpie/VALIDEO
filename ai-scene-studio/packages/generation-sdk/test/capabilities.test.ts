import { describe, expect, it } from 'vitest';
import { matchCapabilities, type GenerationRequest, type ProviderCapabilities } from '../src';

const video: ProviderCapabilities = {
  provider: 'exemple',
  model: 'video-model',
  modes: ['text_to_video', 'image_to_video'],
  controls: ['first_frame', 'reference_images'],
  maxReferenceImages: 2,
  supportsSeed: false,
  resolutions: [{ width: 1280, height: 720 }],
  maxWidth: 1920,
  maxHeight: 1080,
  durationsSeconds: [5, 10],
  fps: [24],
  aspectRatios: ['16:9'],
};

const base: GenerationRequest = {
  mode: 'image_to_video',
  prompt: 'un cube rouge',
  controls: ['first_frame'],
  referenceImageCount: 1,
  width: 1280,
  height: 720,
  durationSeconds: 5,
  fps: 24,
  aspectRatio: '16:9',
};

describe('matchCapabilities', () => {
  it('ne signale rien pour une requête compatible', () => {
    expect(matchCapabilities(base, video)).toEqual([]);
  });

  it('signale explicitement une contrainte ignorée (depth)', () => {
    const result = matchCapabilities({ ...base, controls: ['first_frame', 'depth'] }, video);
    expect(result).toEqual([
      expect.objectContaining({ field: 'controls.depth', severity: 'ignored' }),
    ]);
  });

  it('prévient que le seed ne garantit pas la reproductibilité', () => {
    const result = matchCapabilities({ ...base, seed: 42 }, video);
    expect(result[0]).toMatchObject({ field: 'seed', severity: 'ignored' });
  });

  it('bloque un mode, une résolution, une durée ou trop de références non supportés', () => {
    const result = matchCapabilities(
      { ...base, mode: 'text_to_image', width: 4096, height: 4096, referenceImageCount: 3 },
      video,
    );
    const fields = result.filter((m) => m.severity === 'blocking').map((m) => m.field);
    expect(fields).toEqual(['mode', 'referenceImageCount', 'resolution']);
    expect(matchCapabilities({ ...base, durationSeconds: 7 }, video).map((m) => m.field)).toEqual([
      'durationSeconds',
    ]);
  });

  it('bloque une vidéo sans durée', () => {
    const { durationSeconds: _d, ...noDuration } = base;
    expect(matchCapabilities(noDuration, video).map((m) => m.field)).toEqual(['durationSeconds']);
  });
});
