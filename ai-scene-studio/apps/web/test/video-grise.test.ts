import { describe, expect, it } from 'vitest';
import { dimensions, formatVideo } from '@/editor/videoGrise';

describe('vidéo grise', () => {
  it('préfère le MP4, se rabat sur le WebM, sinon rien', () => {
    expect(formatVideo(() => true)).toEqual({
      type: 'video/mp4;codecs=avc1.42E01E',
      extension: 'mp4',
    });
    expect(formatVideo((type) => type.startsWith('video/webm'))?.extension).toBe('webm');
    expect(formatVideo(() => false)).toBeNull();
  });

  it('ramène la taille du rendu à 1280 de large, en valeurs paires', () => {
    expect(dimensions(1920, 1080)).toEqual({ largeur: 1280, hauteur: 720 });
    expect(dimensions(1000, 563)).toEqual({ largeur: 1000, hauteur: 564 });
    expect(dimensions(2048, 858)).toEqual({ largeur: 1280, hauteur: 536 });
  });
});
