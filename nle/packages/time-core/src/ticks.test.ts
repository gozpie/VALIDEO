import { describe, it, expect } from 'vitest';
import { TIMEBASES } from './timebase.js';
import {
  TICKS_PER_SECOND,
  ADOBE_TICKS_PER_SECOND,
  framesToTicks,
  ticksToFrames,
  toTicks,
  fromTicks,
} from './ticks.js';
import { time } from './rational-time.js';

describe('ticks — unite d interchange', () => {
  it('l unite interne est divisible par toutes les cadences supportees', () => {
    for (const rate of [24, 25, 30, 48, 50, 60, 100, 120, 1001]) {
      expect(TICKS_PER_SECOND % BigInt(rate)).toBe(0n);
    }
  });

  it('documente le fait que l unite d Adobe n est pas exacte en NTSC', () => {
    // 254016000000 = 2^10 x 3^4 x 5^6 x 7^2 : il lui manque 11 et 13 pour 1001.
    expect(ADOBE_TICKS_PER_SECOND % 1001n).not.toBe(0n);
    expect(ADOBE_TICKS_PER_SECOND % 120n).toBe(0n);
    expect(TICKS_PER_SECOND).toBe(ADOBE_TICKS_PER_SECOND * 143n);
  });

  it('une seconde vaut TICKS_PER_SECOND quelle que soit la cadence', () => {
    expect(framesToTicks(25, TIMEBASES.TB25)).toBe(TICKS_PER_SECOND);
    expect(framesToTicks(24, TIMEBASES.TB24)).toBe(TICKS_PER_SECOND);
    expect(framesToTicks(120, TIMEBASES.TB120)).toBe(TICKS_PER_SECOND);
  });

  it('reste exact sur les cadences NTSC', () => {
    // 24 images a 24000/1001 = 1.001 s.
    expect(framesToTicks(24, TIMEBASES.TB23_976)).toBe((TICKS_PER_SECOND * 1001n) / 1000n);
    expect(framesToTicks(30, TIMEBASES.TB29_97_NDF)).toBe((TICKS_PER_SECOND * 1001n) / 1000n);
  });

  it('fait l aller-retour sans perte', () => {
    for (const tb of [
      TIMEBASES.TB23_976,
      TIMEBASES.TB25,
      TIMEBASES.TB29_97_DF,
      TIMEBASES.TB59_94_DF,
    ]) {
      for (const f of [0, 1, 999, 107892, 1_000_000]) {
        expect(ticksToFrames(framesToTicks(f, tb), tb)).toBe(f);
      }
    }
  });

  it('gere les positions negatives', () => {
    expect(ticksToFrames(framesToTicks(-500, TIMEBASES.TB25), TIMEBASES.TB25)).toBe(-500);
  });

  it('expose une API RationalTime', () => {
    const t = time(1234, TIMEBASES.TB23_976);
    expect(fromTicks(toTicks(t), TIMEBASES.TB23_976).frames).toBe(1234);
  });

  it('ne perd pas de precision sur 24 h en 23.976', () => {
    const frames = 86400 * 24;
    expect(ticksToFrames(framesToTicks(frames, TIMEBASES.TB23_976), TIMEBASES.TB23_976)).toBe(
      frames,
    );
  });
});
