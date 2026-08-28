import { describe, it, expect } from 'vitest';
import { TIMEBASES } from '@valideo/time-core';
import { makeSequence } from '@valideo/timeline-model/fixtures';
import {
  MAX_PIXELS_PER_FRAME,
  MIN_PIXELS_PER_FRAME,
  clampScroll,
  detailLevel,
  detailPolicy,
  fit,
  scrollBy,
  scrollIntoView,
  tickInterval,
  ticks,
  timeToX,
  viewport,
  visibleRange,
  visibleSeconds,
  xToTime,
  xToTimeExact,
  zoomAt,
  zoomCentered,
} from './viewport.js';
import {
  buildRenderModel,
  hitTest,
  marqueeSelect,
  orderTracks,
  trackLayout,
} from './render-model.js';
import { collectSnapTargets, snapClipMove, snapFrame } from './snapping.js';

const vp = viewport(0, 1, 1000);

describe('viewport — correspondance temps/pixels', () => {
  it('projette dans les deux sens', () => {
    expect(timeToX(vp, 0)).toBe(0);
    expect(timeToX(vp, 500)).toBe(500);
    expect(xToTime(vp, 500)).toBe(500);
    expect(xToTimeExact(viewport(0, 0.5, 1000), 501)).toBe(1002);
  });

  it('tronque vers le bas à la frontière du modèle', () => {
    const zoomed = viewport(0, 10, 1000);
    expect(xToTime(zoomed, 15)).toBe(1); // 1,5 image -> image 1
    expect(xToTime(zoomed, 19)).toBe(1);
    expect(xToTime(zoomed, 20)).toBe(2);
  });

  it('calcule la plage visible', () => {
    expect(visibleRange(viewport(100, 2, 800))).toEqual({ start: 100, end: 500 });
  });
});

describe('viewport — zoom', () => {
  it('garde fixe l image sous le pointeur', () => {
    const before = viewport(1000, 1, 1000);
    const anchorFrame = xToTimeExact(before, 300);
    const after = zoomAt(before, 300, 4);
    expect(xToTimeExact(after, 300)).toBeCloseTo(anchorFrame, 9);
    expect(after.pixelsPerFrame).toBe(4);
  });

  it('reste stable après un aller-retour de zoom', () => {
    const before = viewport(1234, 2, 900);
    const after = zoomAt(zoomAt(before, 450, 3), 450, 1 / 3);
    expect(after.scroll).toBeCloseTo(before.scroll, 9);
    expect(after.pixelsPerFrame).toBeCloseTo(before.pixelsPerFrame, 9);
  });

  it('zoome au centre au clavier', () => {
    const before = viewport(0, 1, 1000);
    const centerFrame = xToTimeExact(before, 500);
    expect(xToTimeExact(zoomCentered(before, 2), 500)).toBeCloseTo(centerFrame, 9);
  });

  it('borne le zoom aux deux extrémités', () => {
    expect(zoomCentered(vp, 1e9).pixelsPerFrame).toBe(MAX_PIXELS_PER_FRAME);
    expect(zoomCentered(vp, 1e-9).pixelsPerFrame).toBe(MIN_PIXELS_PER_FRAME);
  });

  it('permet de distinguer une image au zoom maximal (§17)', () => {
    expect(MAX_PIXELS_PER_FRAME).toBeGreaterThanOrEqual(20);
  });

  it('permet d afficher plusieurs heures au zoom minimal (§17)', () => {
    const wide = viewport(0, MIN_PIXELS_PER_FRAME, 1000);
    expect(visibleSeconds(wide, TIMEBASES.TB25)).toBeGreaterThanOrEqual(20 * 3600);
  });

  it('ajuste une durée à la largeur', () => {
    const fitted = fit(viewport(0, 1, 1000), 5000);
    expect(fitted.pixelsPerFrame).toBeCloseTo(0.2, 9);
    expect(timeToX(fitted, 5000)).toBeCloseTo(1000, 6);
  });
});

describe('viewport — défilement', () => {
  it('défile en pixels', () => {
    expect(scrollBy(viewport(0, 2, 1000), 100).scroll).toBe(50);
  });

  it('ne bouge pas si la position est déjà confortablement visible', () => {
    const v = viewport(0, 1, 1000);
    expect(scrollIntoView(v, 500)).toBe(v);
  });

  it('ramène une position hors champ', () => {
    const v = viewport(0, 1, 1000);
    expect(timeToX(scrollIntoView(v, 2000), 2000)).toBeCloseTo(960, 6);
    expect(timeToX(scrollIntoView(v, -500), -500)).toBeCloseTo(40, 6);
  });

  it('empêche de dériver loin après la fin du montage', () => {
    const v = viewport(100000, 1, 1000);
    expect(clampScroll(v, 2000).scroll).toBe(1200);
    expect(clampScroll(viewport(-50, 1, 1000), 2000).scroll).toBe(0);
  });
});

describe('viewport — niveaux de détail (§55)', () => {
  it('choisit le niveau selon l échelle', () => {
    expect(detailLevel(viewport(0, 20, 1000))).toBe('frame');
    expect(detailLevel(viewport(0, 2, 1000))).toBe('detailed');
    expect(detailLevel(viewport(0, 0.5, 1000))).toBe('normal');
    expect(detailLevel(viewport(0, 0.05, 1000))).toBe('compact');
    expect(detailLevel(viewport(0, 0.001, 1000))).toBe('overview');
  });

  it('coupe les vignettes et les formes d onde quand elles seraient illisibles', () => {
    const wide = detailPolicy(viewport(0, 0.001, 1000));
    expect(wide.thumbnails).toBe(false);
    expect(wide.waveforms).toBe(false);
    expect(wide.labels).toBe(false);

    const close = detailPolicy(viewport(0, 20, 1000));
    expect(close.thumbnails).toBe(true);
    expect(close.waveforms).toBe(true);
    expect(close.frameGrid).toBe(true);
  });
});

describe('viewport — graduations', () => {
  it('choisit un intervalle rond en secondes quand on est dézoomé', () => {
    const v = viewport(0, 0.5, 1000); // 25 images = 12,5 px
    const step = tickInterval(v, TIMEBASES.TB25, 80);
    expect(step % 25).toBe(0); // multiple entier de secondes
  });

  it('descend à l image au zoom maximal', () => {
    // À 64 px par image, un espacement minimal de 80 px impose une graduation
    // toutes les 2 images ; c est en abaissant l espacement qu on gradue
    // chaque image.
    expect(tickInterval(viewport(0, 100, 1000), TIMEBASES.TB25, 80)).toBe(2);
    expect(tickInterval(viewport(0, 100, 1000), TIMEBASES.TB25, 40)).toBe(1);
  });

  it('respecte l espacement minimal demandé', () => {
    for (const scale of [0.001, 0.01, 0.1, 1, 5, 30]) {
      const v = viewport(0, scale, 1000);
      expect(tickInterval(v, TIMEBASES.TB25, 80) * scale).toBeGreaterThanOrEqual(80);
    }
  });

  it('produit des graduations alignées et dans la vue', () => {
    const v = viewport(137, 1, 500);
    const step = tickInterval(v, TIMEBASES.TB25, 80);
    const list = ticks(v, TIMEBASES.TB25, 80);
    expect(list.length).toBeGreaterThan(0);
    for (const t of list) {
      expect(t % step).toBe(0);
      expect(t).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------- Modèle de rendu

function sequence3x3() {
  return makeSequence([
    { id: 'v2', index: 1, clips: [{ id: 'haut', start: 0, duration: 100 }] },
    {
      id: 'v1',
      index: 0,
      clips: [
        { id: 'a', start: 0, duration: 100 },
        { id: 'b', start: 500, duration: 100 },
      ],
    },
    { id: 'a1', kind: 'audio', clips: [{ id: 'son', start: 0, duration: 600 }] },
  ]);
}

describe('modèle de rendu', () => {
  it('empile les pistes selon la convention NLE : V2 au-dessus de V1, audio en dessous', () => {
    const order = orderTracks(sequence3x3()).map((t) => t.id);
    expect(order).toEqual(['v2', 'v1', 'a1']);
  });

  it('place les pistes verticalement sans chevauchement', () => {
    const layouts = trackLayout(sequence3x3());
    for (let i = 1; i < layouts.length; i += 1) {
      expect(layouts[i]!.y).toBeGreaterThanOrEqual(layouts[i - 1]!.y + layouts[i - 1]!.height);
    }
  });

  it('ne produit que les clips visibles (§55)', () => {
    const seq = sequence3x3();
    const model = buildRenderModel(seq, viewport(0, 1, 200));
    expect(model.clips.map((c) => c.clipId).sort()).toEqual(['a', 'haut', 'son']);
    expect(model.culled).toBe(1); // le clip b est hors champ
  });

  it('borne les coordonnées au viewport et signale le débordement', () => {
    const seq = makeSequence([
      { id: 'v1', clips: [{ id: 'long', start: -0, duration: 1_000_000 }] },
    ]);
    const model = buildRenderModel(seq, viewport(500_000, 1, 800));
    const item = model.clips[0]!;
    expect(item.x).toBe(0);
    expect(item.width).toBeLessThanOrEqual(800);
    expect(item.clippedLeft).toBe(true);
    expect(item.clippedRight).toBe(true);
  });

  it('ne produit rien pour une piste hors du champ vertical', () => {
    const seq = sequence3x3();
    const model = buildRenderModel(seq, viewport(0, 1, 1000), { viewportHeight: 30 });
    expect(model.clips.every((c) => c.trackId === 'v2')).toBe(true);
  });

  it('reporte sélection, effets, liaison et vitesse', () => {
    const seq = makeSequence([
      {
        id: 'v1',
        clips: [{ id: 'a', start: 0, duration: 100, speed: { n: 1, d: 2 }, linkGroup: 'g' }],
      },
    ]);
    const model = buildRenderModel(seq, viewport(0, 1, 1000), { selection: new Set(['a']) });
    const item = model.clips[0]!;
    expect(item.selected).toBe(true);
    expect(item.linked).toBe(true);
    expect(item.speedPercent).toBe(50);
    expect(item.hasEffects).toBe(false);
  });

  it('ne place la tête de lecture que si elle est visible', () => {
    const seq = sequence3x3();
    expect(buildRenderModel(seq, viewport(0, 1, 200), { playhead: 50 }).playheadX).toBe(50);
    expect(buildRenderModel(seq, viewport(0, 1, 200), { playhead: 5000 }).playheadX).toBeNull();
    expect(buildRenderModel(seq, viewport(0, 1, 200), {}).playheadX).toBeNull();
  });

  it('reste correct sur 10 000 clips (§55)', () => {
    const seq = makeSequence([
      {
        id: 'v1',
        clips: Array.from({ length: 10_000 }, (_, i) => ({
          id: `c${i}`,
          start: i * 50,
          duration: 40,
        })),
      },
    ]);
    const model = buildRenderModel(seq, viewport(0, 1, 1000));
    // 1000 px / 50 images par clip = une vingtaine de clips visibles au plus.
    expect(model.clips.length).toBeLessThan(30);
    expect(model.culled).toBeGreaterThan(9900);
  });
});

describe('désignation au pointeur', () => {
  const seq = makeSequence([{ id: 'v1', clips: [{ id: 'a', start: 100, duration: 200 }] }]);
  const v = viewport(0, 1, 1000);
  const model = buildRenderModel(seq, v);
  const y = model.tracks[0]!.y + 10;

  it('distingue le corps du clip et ses deux bords', () => {
    expect(hitTest(model, v, 200, y).kind).toBe('clip');
    expect(hitTest(model, v, 102, y).kind).toBe('clipEdgeIn');
    expect(hitTest(model, v, 298, y).kind).toBe('clipEdgeOut');
  });

  it('rend la piste vide et le hors-piste', () => {
    expect(hitTest(model, v, 500, y).kind).toBe('track');
    expect(hitTest(model, v, 500, 10_000).kind).toBe('empty');
  });

  it('donne toujours l image sous le pointeur', () => {
    expect(hitTest(model, v, 250, y).frame).toBe(250);
  });

  it('ne laisse pas les zones de trim dévorer un clip étroit', () => {
    const narrow = makeSequence([{ id: 'v1', clips: [{ id: 'n', start: 0, duration: 9 }] }]);
    const nm = buildRenderModel(narrow, v);
    const ny = nm.tracks[0]!.y + 5;
    // Un clip de 9 px doit rester saisissable en son centre.
    expect(hitTest(nm, v, 4.5, ny).kind).toBe('clip');
  });

  it('sélectionne au rectangle', () => {
    const many = makeSequence([
      {
        id: 'v1',
        clips: [
          { id: 'a', start: 0, duration: 50 },
          { id: 'b', start: 100, duration: 50 },
        ],
      },
    ]);
    const mm = buildRenderModel(many, v);
    expect(marqueeSelect(mm, 0, 0, 60, 200)).toEqual(['a']);
    expect(marqueeSelect(mm, 0, 0, 600, 200).sort()).toEqual(['a', 'b']);
  });
});

// ------------------------------------------------------------- Accrochage

describe('accrochage magnétique (§14)', () => {
  const seq = makeSequence([
    {
      id: 'v1',
      clips: [
        { id: 'a', start: 0, duration: 100 },
        { id: 'b', start: 300, duration: 100 },
      ],
    },
  ]);
  const v = viewport(0, 1, 1000);

  it('collecte les points d accrochage visibles', () => {
    const targets = collectSnapTargets(seq, v, { playhead: 250 });
    const frames = targets.map((t) => t.frame).sort((x, y) => x - y);
    expect(frames).toEqual([0, 0, 100, 250, 300, 400]);
  });

  it('exclut les clips en cours de déplacement', () => {
    const targets = collectSnapTargets(seq, v, { exclude: new Set(['a']) });
    expect(targets.some((t) => t.frame === 100 && t.kind === 'clipEnd')).toBe(false);
  });

  it('accroche au point le plus proche dans le seuil', () => {
    const targets = collectSnapTargets(seq, v);
    expect(snapFrame(103, targets, v, 8).frame).toBe(100);
    expect(snapFrame(103, targets, v, 8).target?.kind).toBe('clipEnd');
    expect(snapFrame(150, targets, v, 8).frame).toBe(150);
    expect(snapFrame(150, targets, v, 8).target).toBeNull();
  });

  it('exprime le seuil en pixels, donc s adapte au zoom', () => {
    const targets = collectSnapTargets(seq, v);
    // Dézoomé, 8 px couvrent beaucoup d images : l accrochage porte plus loin.
    const wide = viewport(0, 0.1, 1000);
    expect(snapFrame(150, collectSnapTargets(seq, wide), wide, 8).frame).toBe(100);
    // Zoomé, il devient très sélectif.
    const close = viewport(0, 10, 1000);
    expect(snapFrame(103, collectSnapTargets(seq, close), close, 8).frame).toBe(103);
    expect(snapFrame(103, targets, v, 8).frame).toBe(100);
  });

  it('se désactive à la demande', () => {
    const targets = collectSnapTargets(seq, v);
    expect(snapFrame(103, targets, v, 8, false).frame).toBe(103);
  });

  it('accroche un clip déplacé par son début ou par sa fin', () => {
    const targets = collectSnapTargets(seq, v, { exclude: new Set(['a']) });
    // Le début tombe à 5 du point 0 : c est le début qui colle.
    expect(snapClipMove(5, 200, targets, v, 8).frame).toBe(0);
    // Ici c est la FIN du clip (302) qui est proche de 300 : le clip recule.
    expect(snapClipMove(102, 200, targets, v, 8).frame).toBe(100);
  });

  it('ne renvoie aucun accrochage quand rien n est à portée', () => {
    const targets = collectSnapTargets(seq, v, { exclude: new Set(['a', 'b']) });
    const r = snapClipMove(150, 20, targets, v, 2);
    expect(r.target).toBeNull();
    expect(r.frame).toBe(150);
  });
});
