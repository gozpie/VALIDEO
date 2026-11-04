import { describe, expect, it } from 'vitest';
import {
  dernierADecoder,
  ordreAffichage,
  rangAuPlusTard,
} from '../src/montage/media/ordre-affichage';

// Ordre de décodage typique avec images B : I0 P4 B2 B1 B3 P8 B6 B5 B7.
const DECODAGE = [0, 4, 2, 1, 3, 8, 6, 5, 7].map((pts, index) => ({ pts, index }));

describe('ordre d’affichage', () => {
  const ordre = ordreAffichage(DECODAGE);

  it('voit toutes les images, pas seulement les ancrages', () => {
    const vues = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((pts) => ordre[rangAuPlusTard(ordre, pts)]?.pts);
    expect(vues).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('prend l’image qui précède entre deux horodatages, et borne aux extrémités', () => {
    expect(ordre[rangAuPlusTard(ordre, 2.5)]?.pts).toBe(2);
    expect(rangAuPlusTard(ordre, -1)).toBe(0);
    expect(ordre[rangAuPlusTard(ordre, 99)]?.pts).toBe(8);
  });

  it('dit jusqu’où décoder pour obtenir une plage affichée', () => {
    // L'image affichée en 1 (B1) arrive après I0, P4, B2 dans le fichier.
    expect(dernierADecoder(ordre, 0, 1)).toBe(3);
    // Jusqu'à l'image 4 (P4), il faut aussi B3, décodée après elle.
    expect(dernierADecoder(ordre, 0, 4)).toBe(4);
  });
});
