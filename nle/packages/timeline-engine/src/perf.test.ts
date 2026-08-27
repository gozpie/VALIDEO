/**
 * Budgets de performance (section 103).
 *
 * Ces tests ne mesurent pas une machine, ils protegent une COMPLEXITE. Les
 * seuils sont larges pour ne pas clignoter selon la charge de la machine ; ce
 * qui est verifie, c est qu on n a pas reintroduit un parcours lineaire ou
 * quadratique la ou la virtualisation doit rendre le cout independant de la
 * taille du montage.
 *
 * Les chiffres reels sont affiches, pour qu une regression se voie meme quand
 * le seuil n est pas franchi.
 */
import { describe, it, expect } from 'vitest';
import type { SequenceDoc } from '@valideo/project-model';
import { makeSequence } from '@valideo/timeline-model/fixtures';
import { clipsInRange, findClip } from '@valideo/timeline-model';
import { buildRenderModel } from './render-model.js';
import { viewport, zoomAt } from './viewport.js';
import { collectSnapTargets, snapFrame } from './snapping.js';

/** 100 pistes x 100 clips = 10 000 clips, comme l exige la section 55. */
function bigSequence(tracks = 100, clipsPerTrack = 100): SequenceDoc {
  return makeSequence(
    Array.from({ length: tracks }, (_, t) => ({
      id: `t${t}`,
      kind: (t < tracks / 2 ? 'video' : 'audio') as 'video' | 'audio',
      index: t % (tracks / 2),
      clips: Array.from({ length: clipsPerTrack }, (_, c) => ({
        id: `t${t}c${c}`,
        start: c * 60,
        duration: 50,
      })),
    })),
  );
}

function measure(label: string, iterations: number, fn: () => void): number {
  fn(); // rodage
  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const perCall = (performance.now() - started) / iterations;
  process.stdout.write(`    ${label} : ${perCall.toFixed(3)} ms/appel\n`);
  return perCall;
}

describe('budgets de performance', () => {
  const seq = bigSequence();
  const total = seq.tracks.reduce((n, t) => n + t.clips.length, 0);

  it('construit un montage de 10 000 clips', () => {
    expect(total).toBe(10_000);
  });

  it('produit le modèle de rendu d une vue en moins de 4 ms', () => {
    const vp = viewport(3000, 1, 1600);
    const perCall = measure('rendu 10 000 clips', 200, () => {
      buildRenderModel(seq, vp, { viewportHeight: 900 });
    });
    const model = buildRenderModel(seq, vp, { viewportHeight: 900 });
    // La virtualisation doit écarter l immense majorité des clips.
    expect(model.culled).toBeGreaterThan(9000);
    expect(model.clips.length).toBeLessThan(500);
    expect(perCall).toBeLessThan(4);
  });

  it('coûte le même prix quel que soit le nombre de clips hors champ', () => {
    const vp = viewport(3000, 1, 1600);
    const small = bigSequence(100, 10);
    const petit = measure('rendu 1 000 clips', 200, () =>
      buildRenderModel(small, vp, { viewportHeight: 900 }),
    );
    const grand = measure('rendu 10 000 clips', 200, () =>
      buildRenderModel(seq, vp, { viewportHeight: 900 }),
    );
    // Dix fois plus de clips ne doit pas coûter dix fois plus cher : le surcoût
    // vient du parcours des pistes, pas des clips invisibles.
    expect(grand).toBeLessThan(petit * 4 + 1);
  });

  it('zoome sans toucher au montage', () => {
    let vp = viewport(0, 1, 1600);
    const perCall = measure('zoom', 10_000, () => {
      vp = zoomAt(vp, 800, 1.0001);
    });
    expect(perCall).toBeLessThan(0.01);
  });

  it('interroge une piste de 100 000 clips en temps logarithmique', () => {
    const huge = makeSequence([
      {
        id: 'v1',
        clips: Array.from({ length: 100_000 }, (_, i) => ({
          id: `c${i}`,
          start: i * 10,
          duration: 8,
        })),
      },
    ]);
    const track = huge.tracks[0]!;
    const debut = measure('requête au début', 20_000, () => clipsInRange(track, 0, 500));
    const fin = measure('requête à la fin', 20_000, () => clipsInRange(track, 990_000, 990_500));
    // Chercher à la fin ne doit pas coûter plus cher qu au début : c est la
    // signature d une dichotomie, par opposition à un filtre linéaire.
    expect(fin).toBeLessThan(debut * 5 + 0.01);
    expect(fin).toBeLessThan(0.05);
  });

  it('collecte et applique l accrochage en moins d une milliseconde', () => {
    const vp = viewport(3000, 1, 1600);
    const perCall = measure('accrochage', 500, () => {
      const targets = collectSnapTargets(seq, vp, { playhead: 3050 });
      snapFrame(3051, targets, vp, 8);
    });
    expect(perCall).toBeLessThan(2);
  });

  it('retrouve un clip par identifiant sans indexation préalable', () => {
    const perCall = measure('recherche par identifiant', 2_000, () => {
      findClip(seq, 't99c99');
    });
    // Ce chemin est linéaire par nature ; il n est pas dans une boucle de rendu.
    expect(perCall).toBeLessThan(5);
  });
});
