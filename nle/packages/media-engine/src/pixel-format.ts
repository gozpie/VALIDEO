/**
 * Lecture d un nom de format de pixel FFmpeg (section 9).
 *
 * `yuva444p12le` porte quatre informations : espace YUV, presence d alpha,
 * sous-echantillonnage 4:4:4, profondeur 12 bits, ordre petit-boutiste. On les
 * extrait plutot que de tenir une table de centaines d entrees.
 */

export type ChromaSubsampling = '4:4:4' | '4:2:2' | '4:2:0' | '4:1:1' | '4:1:0' | 'none';

export interface PixelFormatInfo {
  readonly name: string;
  readonly bitDepth: number;
  readonly hasAlpha: boolean;
  readonly chroma: ChromaSubsampling;
  readonly family: 'yuv' | 'rgb' | 'gray' | 'bayer' | 'unknown';
  readonly planar: boolean;
}

const ALPHA_RGB = new Set([
  'rgba',
  'bgra',
  'argb',
  'abgr',
  'rgba64le',
  'rgba64be',
  'ya8',
  'ya16le',
  'ya16be',
]);

function chromaOf(name: string): ChromaSubsampling {
  if (name.includes('444')) return '4:4:4';
  if (name.includes('422')) return '4:2:2';
  if (name.includes('440')) return '4:2:2';
  if (name.includes('420')) return '4:2:0';
  if (name.includes('411')) return '4:1:1';
  if (name.includes('410')) return '4:1:0';
  return 'none';
}

function familyOf(name: string): PixelFormatInfo['family'] {
  if (
    name.startsWith('yuv') ||
    name.startsWith('yuvj') ||
    name.startsWith('nv') ||
    name.startsWith('p0')
  ) {
    return 'yuv';
  }
  if (
    name.startsWith('gbr') ||
    name.startsWith('rgb') ||
    name.startsWith('bgr') ||
    name.startsWith('argb') ||
    name.startsWith('abgr')
  ) {
    return 'rgb';
  }
  if (name.startsWith('gray') || name.startsWith('ya')) return 'gray';
  if (name.startsWith('bayer')) return 'bayer';
  return 'unknown';
}

function bitDepthOf(name: string): number {
  // Profondeur explicite : ...p10le, ...p12be, gray16le, rgb48le.
  const suffixed = /(\d{1,2})(?:le|be)$/.exec(name);
  if (suffixed !== null) {
    const bits = Number(suffixed[1]);
    // rgb48 et rgba64 comptent tous les composants ensemble.
    if (name.startsWith('rgb') || name.startsWith('bgr')) {
      if (bits === 48) return 16;
      if (bits === 64) return 16;
      if (bits === 30) return 10;
    }
    if (name.startsWith('gray') || name.startsWith('ya')) return bits;
    return bits;
  }
  if (name.includes('p10')) return 10;
  if (name.includes('p12')) return 12;
  if (name.includes('p14')) return 14;
  if (name.includes('p16')) return 16;
  return 8;
}

function hasAlphaOf(name: string): boolean {
  if (ALPHA_RGB.has(name)) return true;
  if (name.startsWith('yuva') || name.startsWith('gbrap') || name.startsWith('ayuv')) return true;
  if (/^(rgba|bgra|argb|abgr)/.test(name)) return true;
  if (/^ya\d*/.test(name)) return true;
  return false;
}

export function pixelFormatInfo(name: string): PixelFormatInfo {
  const clean = name.trim().toLowerCase();
  return {
    name: clean,
    bitDepth: bitDepthOf(clean),
    hasAlpha: hasAlphaOf(clean),
    chroma: chromaOf(clean),
    family: familyOf(clean),
    planar: clean.includes('p') && !clean.startsWith('nv'),
  };
}
