import { describe, it, expect } from 'vitest';
import {
  BASE_BUCKET,
  LEVEL_FACTOR,
  buildPeaks,
  compressionRatio,
  pyramidBytes,
  readWaveform,
  selectLevel,
} from './peaks.js';
import {
  PeakMeter,
  dbToLinear,
  linearToDb,
  momentaryLoudnessLufs,
  peakDb,
  rmsDb,
} from './meters.js';

/** Sinusoïde de fréquence et d amplitude données. */
function sine(seconds: number, frequency: number, amplitude = 1, sampleRate = 48000): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1)
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

describe('pyramide de pics (§19)', () => {
  it('construit les niveaux annoncés', () => {
    const p = buildPeaks([sine(1, 440)], 48000, 5);
    expect(p.levels).toHaveLength(5);
    expect(p.levels[0]?.bucket).toBe(BASE_BUCKET);
    expect(p.levels[1]?.bucket).toBe(BASE_BUCKET * LEVEL_FACTOR);
    expect(p.levels[4]?.bucket).toBe(BASE_BUCKET * LEVEL_FACTOR ** 4);
    expect(p.sampleCount).toBe(48000);
  });

  it('retrouve l enveloppe réelle du signal', () => {
    const p = buildPeaks([sine(1, 440, 0.5)], 48000);
    const cols = readWaveform(p, 0, 0, 48000, 100);
    for (const c of cols) {
      // Une sinusoïde à 440 Hz remplit chaque colonne : min ≈ -0,5, max ≈ +0,5.
      expect(c.max).toBeGreaterThan(0.49);
      expect(c.max).toBeLessThan(0.51);
      expect(c.min).toBeLessThan(-0.49);
      expect(c.min).toBeGreaterThan(-0.51);
    }
  });

  it('le RMS d une sinusoïde vaut son amplitude divisée par racine de deux', () => {
    const p = buildPeaks([sine(1, 440, 1)], 48000);
    const cols = readWaveform(p, 0, 0, 48000, 10);
    for (const c of cols) {
      expect(c.rms).toBeCloseTo(Math.SQRT1_2, 2);
    }
  });

  it('conserve les crêtes isolées à travers tous les niveaux', () => {
    // Un signal silencieux, avec une seule impulsion à mi-parcours.
    const samples = new Float32Array(48000);
    samples[24000] = 0.9;
    const p = buildPeaks([samples], 48000);
    // Même dézoomé au maximum, la crête ne doit pas disparaître.
    for (let columns = 1; columns <= 512; columns *= 2) {
      const cols = readWaveform(p, 0, 0, 48000, columns);
      expect(Math.max(...cols.map((c) => c.max))).toBeGreaterThan(0.89);
    }
  });

  it('gère plusieurs canaux indépendamment', () => {
    const gauche = sine(0.5, 440, 0.9);
    const droite = sine(0.5, 440, 0.1);
    const p = buildPeaks([gauche, droite], 48000);
    expect(p.channels).toBe(2);
    expect(readWaveform(p, 0, 0, 24000, 10)[0]?.max).toBeGreaterThan(0.85);
    expect(readWaveform(p, 1, 0, 24000, 10)[0]?.max).toBeLessThan(0.15);
  });

  it('choisit le niveau selon le zoom, du plus fin au plus grossier', () => {
    const p = buildPeaks([sine(2, 440)], 48000, 6);
    expect(selectLevel(p, 1)).toBe(0);
    expect(selectLevel(p, BASE_BUCKET)).toBe(0);
    expect(selectLevel(p, BASE_BUCKET * LEVEL_FACTOR)).toBe(1);
    expect(selectLevel(p, 1_000_000)).toBe(p.levels.length - 1);
  });

  it('produit exactement le nombre de colonnes demandé', () => {
    const p = buildPeaks([sine(1, 440)], 48000);
    for (const n of [1, 7, 100, 1000, 5000]) {
      expect(readWaveform(p, 0, 0, 48000, n)).toHaveLength(n);
    }
  });

  it('dessine une sous-plage sans recalculer la pyramide', () => {
    const samples = new Float32Array(48000);
    // Son uniquement dans la seconde moitié.
    for (let i = 24000; i < 48000; i += 1) samples[i] = 0.8;
    const p = buildPeaks([samples], 48000);

    const silence = readWaveform(p, 0, 0, 24000, 10);
    // Toutes les colonnes sont muettes SAUF la dernière : sa dernière case
    // enjambe la frontière et contient déjà du son. C est la granularité de la
    // pyramide, pas une erreur — une case ne peut pas être coupée en deux.
    expect(silence.slice(0, -1).every((c) => Math.abs(c.max) < 0.05)).toBe(true);
    expect(readWaveform(p, 0, 24000, 48000, 10).every((c) => c.max > 0.75)).toBe(true);
  });

  it('borne les plages hors limites au lieu de lever', () => {
    const p = buildPeaks([sine(0.1, 440)], 48000);
    expect(() => readWaveform(p, 0, -5000, 999_999, 50)).not.toThrow();
    expect(readWaveform(p, 0, -5000, 999_999, 50)).toHaveLength(50);
    expect(readWaveform(p, 5, 0, 100, 10)).toEqual([]);
    expect(readWaveform(p, 0, 0, 100, 0)).toEqual([]);
  });

  it('ne s effondre pas sur un signal vide', () => {
    expect(buildPeaks([], 48000).levels).toEqual([]);
    expect(buildPeaks([new Float32Array(0)], 48000).levels).toEqual([]);
    expect(readWaveform(buildPeaks([], 48000), 0, 0, 10, 5)).toEqual([]);
  });

  it('reste très compacte comparée aux échantillons (§58)', () => {
    // Une minute de stéréo à 48 kHz.
    const p = buildPeaks([sine(60, 440), sine(60, 440)], 48000);
    const ratio = compressionRatio(p);
    // Détail du coût : le niveau le plus fin agrège 64 échantillons en 3 entiers
    // 16 bits, soit 6 octets pour 256 octets d audio (2,3 %). Les niveaux
    // supérieurs ajoutent un tiers de plus, d où environ 3 %.
    process.stdout.write(`    coût de la pyramide : ${(ratio * 100).toFixed(1)} % de l audio\n`);
    expect(ratio).toBeLessThan(0.04);
    expect(pyramidBytes(p)).toBeGreaterThan(0);
  });

  it('construit une heure de stéréo en un temps raisonnable', () => {
    const heure = 48000 * 3600;
    const gauche = new Float32Array(heure);
    for (let i = 0; i < heure; i += 997) gauche[i] = 0.7; // signal creux mais réel
    const started = performance.now();
    const p = buildPeaks([gauche], 48000, 6);
    const elapsed = performance.now() - started;
    process.stdout.write(
      `    pyramide d une heure : ${elapsed.toFixed(0)} ms, ${(pyramidBytes(p) / 1024 / 1024).toFixed(1)} Mio\n`,
    );
    expect(elapsed).toBeLessThan(5000);
    // Et la lecture d une vue reste instantanée quel que soit le zoom.
    const readStart = performance.now();
    readWaveform(p, 0, 0, heure, 1600);
    expect(performance.now() - readStart).toBeLessThan(50);
  });
});

describe('mesures de niveau (§31)', () => {
  it('convertit entre linéaire et décibels', () => {
    expect(linearToDb(1)).toBeCloseTo(0, 9);
    expect(linearToDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(linearToDb(0)).toBe(-Infinity);
    expect(dbToLinear(0)).toBeCloseTo(1, 9);
    expect(dbToLinear(-6.0206)).toBeCloseTo(0.5, 4);
  });

  it('mesure crête et RMS', () => {
    const s = sine(0.1, 440, 1);
    expect(peakDb(s)).toBeCloseTo(0, 1);
    // Le RMS d une sinusoïde pleine échelle vaut -3,01 dBFS.
    expect(rmsDb(s)).toBeCloseTo(-3.01, 1);
    expect(rmsDb(new Float32Array(0))).toBe(-Infinity);
    expect(peakDb(new Float32Array(10))).toBe(-Infinity);
  });

  it('estime une sonie momentanée cohérente', () => {
    const fort = momentaryLoudnessLufs([sine(0.4, 1000, 1)]);
    const faible = momentaryLoudnessLufs([sine(0.4, 1000, 0.1)]);
    expect(fort).toBeGreaterThan(faible);
    // Diviser l amplitude par dix retire 20 dB.
    expect(fort - faible).toBeCloseTo(20, 0);
    expect(momentaryLoudnessLufs([])).toBe(-Infinity);
    expect(momentaryLoudnessLufs([new Float32Array(100)])).toBe(-Infinity);
  });

  it('un afficheur de crête monte d un coup et redescend lentement', () => {
    const meter = new PeakMeter(20, 1.5);
    meter.push(sine(0.02, 440, 1), 0.02, 0);
    expect(meter.levelDb()).toBeCloseTo(0, 1);

    // Silence : le niveau descend à 20 dB par seconde.
    meter.push(new Float32Array(960), 0.02, 0.02);
    expect(meter.levelDb()).toBeLessThan(0);
    expect(meter.levelDb()).toBeGreaterThan(-1);

    // Mais la crête reste affichée pendant la durée de maintien.
    expect(meter.holdDb()).toBeCloseTo(0, 1);

    for (let t = 0.04; t < 2; t += 0.02) meter.push(new Float32Array(960), 0.02, t);
    expect(meter.holdDb()).toBeLessThan(-10);

    meter.reset();
    expect(meter.levelDb()).toBe(-Infinity);
  });
});
