/**
 * Rendu Canvas de la timeline (sections 2, 17, 18, 55).
 *
 * Aucune dependance a React. Cette fonction est appelee directement depuis une
 * boucle d animation pendant un geste, donc SANS provoquer le moindre rendu
 * React (section 2). Elle ne fait que lire un modele deja calcule par
 * `@valideo/timeline-engine`.
 *
 * Les formes d onde dessinees ici proviennent de VRAIS echantillons decodes par
 * le navigateur. Un clip dont le media n a pas ete decode n en recoit aucune :
 * il vaut mieux un fond uni qu une courbe inventee (section 1003). Les vignettes
 * video restent absentes pour la meme raison, tant qu il n y a pas de decodeur.
 */
import type { SequenceDoc } from '@valideo/project-model';
import type { TimeBase } from '@valideo/time-core';
import { formatTimecode, timebase, rational } from '@valideo/time-core';
import type { RenderModel, Viewport } from '@valideo/timeline-engine';
import { timeToX } from '@valideo/timeline-engine';
import type { WaveformColumn } from '@valideo/audio-engine';

export const HAUTEUR_REGLE = 24;

export const PALETTE = {
  fond: '#1e1e21',
  fondRegle: '#26262a',
  fondPisteVide: '#1a1a1d',
  bord: '#333338',
  bordFort: '#45454d',
  texte: '#d6d6da',
  texteDoux: '#8e8e96',
  texteFort: '#f2f2f4',
  grille: '#2a2a2f',
  clipVideo: '#3d4f6b',
  clipVideoBord: '#5c7aa8',
  clipAudio: '#3d5f4a',
  clipAudioBord: '#5c9070',
  clipTitre: '#6b4f3d',
  clipTitreBord: '#a87c5c',
  clipCalque: '#4a3d6b',
  clipCalqueBord: '#7d5ca8',
  clipDesactive: '#2b2b30',
  selection: '#f0a800',
  tete: '#e05a52',
  accroche: '#4c8dff',
  marqueur: '#e0a63a',
} as const;

export interface CoulJeu {
  readonly fond: string;
  readonly bord: string;
}

function couleursClip(kind: string, enabled: boolean): CoulJeu {
  if (!enabled) return { fond: PALETTE.clipDesactive, bord: PALETTE.bord };
  switch (kind) {
    case 'audio':
      return { fond: PALETTE.clipAudio, bord: PALETTE.clipAudioBord };
    case 'title':
    case 'graphic':
    case 'caption':
      return { fond: PALETTE.clipTitre, bord: PALETTE.clipTitreBord };
    case 'adjustmentLayer':
      return { fond: PALETTE.clipCalque, bord: PALETTE.clipCalqueBord };
    default:
      return { fond: PALETTE.clipVideo, bord: PALETTE.clipVideoBord };
  }
}

function rectArrondi(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  coinGauche: boolean,
  coinDroit: boolean,
): void {
  const rayon = Math.min(r, w / 2, h / 2);
  const rg = coinGauche ? rayon : 0;
  const rd = coinDroit ? rayon : 0;
  ctx.beginPath();
  ctx.moveTo(x + rg, y);
  ctx.lineTo(x + w - rd, y);
  ctx.arcTo(x + w, y, x + w, y + rd, rd);
  ctx.lineTo(x + w, y + h - rd);
  ctx.arcTo(x + w, y + h, x + w - rd, y + h, rd);
  ctx.lineTo(x + rg, y + h);
  ctx.arcTo(x, y + h, x, y + h - rg, rg);
  ctx.lineTo(x, y + rg);
  ctx.arcTo(x, y, x + rg, y, rg);
  ctx.closePath();
}

export interface ApercuGeste {
  /** Clips deplaces, dessines en surimpression a leur position provisoire. */
  readonly clipIds: ReadonlySet<string>;
  readonly decalageX: number;
  readonly decalageY: number;
  /** Position d accrochage a materialiser, en images. */
  readonly accroche: number | null;
  /** Rectangle de selection en cours. */
  readonly rectangle: { x1: number; y1: number; x2: number; y2: number } | null;
}

/**
 * Fournit les colonnes de forme d onde d un clip, ou `null` si son media n a pas
 * ete decode. La fonction est appelee pendant le dessin : elle doit se contenter
 * de lire la pyramide de pics deja construite (section 19).
 */
export type FournisseurFormeOnde = (
  clip: RenderModel['clips'][number],
  colonnes: number,
) => readonly WaveformColumn[] | null;

export interface OptionsRendu {
  readonly sequence: SequenceDoc;
  readonly modele: RenderModel;
  readonly viewport: Viewport;
  readonly largeur: number;
  readonly hauteur: number;
  readonly tete: number;
  readonly graduations: readonly number[];
  readonly base: TimeBase;
  readonly debutTimecode: number;
  readonly geste: ApercuGeste | null;
  readonly dpr: number;
  readonly formeOnde?: FournisseurFormeOnde | undefined;
}

function baseDe(sequence: SequenceDoc): TimeBase {
  return timebase(
    rational(sequence.timebase.rate.n, sequence.timebase.rate.d),
    sequence.timebase.mode,
  );
}

export function timebaseDeSequence(sequence: SequenceDoc): TimeBase {
  return baseDe(sequence);
}

/** Dessine tout. Appelee a chaque image pendant un geste. */
export function dessinerTimeline(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const { largeur, hauteur } = o;

  ctx.save();
  ctx.scale(o.dpr, o.dpr);
  ctx.clearRect(0, 0, largeur, hauteur);

  ctx.fillStyle = PALETTE.fond;
  ctx.fillRect(0, 0, largeur, hauteur);

  dessinerRegle(ctx, o);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HAUTEUR_REGLE, largeur, hauteur - HAUTEUR_REGLE);
  ctx.clip();
  ctx.translate(0, HAUTEUR_REGLE);

  dessinerFondsPistes(ctx, o);
  dessinerGraduationsVerticales(ctx, o);
  dessinerClips(ctx, o);
  dessinerApercu(ctx, o);

  ctx.restore();

  dessinerAccroche(ctx, o);
  dessinerTete(ctx, o);
  dessinerRectangleSelection(ctx, o);

  ctx.restore();
}

function dessinerRegle(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  ctx.fillStyle = PALETTE.fondRegle;
  ctx.fillRect(0, 0, o.largeur, HAUTEUR_REGLE);
  ctx.strokeStyle = PALETTE.bord;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HAUTEUR_REGLE - 0.5);
  ctx.lineTo(o.largeur, HAUTEUR_REGLE - 0.5);
  ctx.stroke();

  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.texteDoux;
  ctx.strokeStyle = PALETTE.bordFort;

  for (const image of o.graduations) {
    const x = Math.round(timeToX(o.viewport, image)) + 0.5;
    if (x < -60 || x > o.largeur + 60) continue;
    ctx.beginPath();
    ctx.moveTo(x, HAUTEUR_REGLE - 7);
    ctx.lineTo(x, HAUTEUR_REGLE - 1);
    ctx.stroke();
    ctx.fillText(formatTimecode(o.debutTimecode + image, o.base), x + 4, 8);
  }

  // Marqueurs de sequence (§41).
  for (const marqueur of o.sequence.markers) {
    const x = Math.round(timeToX(o.viewport, marqueur.time));
    if (x < -8 || x > o.largeur + 8) continue;
    ctx.fillStyle = marqueur.color;
    ctx.beginPath();
    ctx.moveTo(x, HAUTEUR_REGLE - 8);
    ctx.lineTo(x + 6, HAUTEUR_REGLE - 8);
    ctx.lineTo(x + 6, HAUTEUR_REGLE - 3);
    ctx.lineTo(x + 3, HAUTEUR_REGLE);
    ctx.lineTo(x, HAUTEUR_REGLE - 3);
    ctx.closePath();
    ctx.fill();
  }
}

function dessinerFondsPistes(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  for (const piste of o.modele.tracks) {
    ctx.fillStyle = PALETTE.fondPisteVide;
    ctx.fillRect(0, piste.y, o.largeur, piste.height);
    ctx.strokeStyle = PALETTE.bord;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, piste.y + piste.height + 0.5);
    ctx.lineTo(o.largeur, piste.y + piste.height + 0.5);
    ctx.stroke();
    if (piste.locked) {
      // Hachures discretes : une piste verrouillee doit se voir sans crier.
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.strokeStyle = PALETTE.texte;
      ctx.beginPath();
      for (let x = -piste.height; x < o.largeur; x += 8) {
        ctx.moveTo(x, piste.y + piste.height);
        ctx.lineTo(x + piste.height, piste.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}

function dessinerGraduationsVerticales(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const bas = o.hauteur;
  ctx.strokeStyle = PALETTE.grille;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const image of o.graduations) {
    const x = Math.round(timeToX(o.viewport, image)) + 0.5;
    if (x < 0 || x > o.largeur) continue;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, bas);
  }
  ctx.stroke();
}

function dessinerClips(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const deplaces = o.geste?.clipIds ?? new Set<string>();
  for (const clip of o.modele.clips) {
    if (deplaces.has(clip.clipId)) continue;
    dessinerClip(ctx, o, clip, 1);
  }
}

function dessinerApercu(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const geste = o.geste;
  if (geste === null || geste.clipIds.size === 0) return;
  ctx.save();
  ctx.translate(geste.decalageX, geste.decalageY);
  for (const clip of o.modele.clips) {
    if (!geste.clipIds.has(clip.clipId)) continue;
    dessinerClip(ctx, o, clip, 0.8);
  }
  ctx.restore();
}

function dessinerClip(
  ctx: CanvasRenderingContext2D,
  o: OptionsRendu,
  clip: RenderModel['clips'][number],
  opacite: number,
): void {
  const { fond, bord } = couleursClip(clip.kind, clip.enabled);
  const h = clip.height - 2;
  const y = clip.y + 1;

  ctx.save();
  ctx.globalAlpha = opacite;

  rectArrondi(ctx, clip.x, y, clip.width, h, 3, !clip.clippedLeft, !clip.clippedRight);
  ctx.fillStyle = fond;
  ctx.fill();

  // Bandeau superieur : couleur d etiquette du clip (§87).
  if (clip.label !== null && clip.width > 3) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = clip.label;
    ctx.fillRect(clip.x, y, clip.width, 3);
    ctx.restore();
  }

  ctx.strokeStyle = clip.selected ? PALETTE.selection : bord;
  ctx.lineWidth = clip.selected ? 2 : 1;
  rectArrondi(
    ctx,
    clip.x + 0.5,
    y + 0.5,
    clip.width - 1,
    h - 1,
    3,
    !clip.clippedLeft,
    !clip.clippedRight,
  );
  ctx.stroke();

  if (
    o.modele.policy.waveforms &&
    clip.kind === 'audio' &&
    clip.width > 4 &&
    o.formeOnde !== undefined
  ) {
    dessinerFormeOnde(ctx, o, clip, y, h);
  }

  if (o.modele.policy.labels && clip.width > 28) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x + 4, y, clip.width - 8, h);
    ctx.clip();
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = PALETTE.texteFort;
    ctx.fillText(clip.name || clip.kind, clip.x + 5, y + 6);

    if (clip.speedPercent !== null && clip.width > 80) {
      ctx.fillStyle = PALETTE.texteDoux;
      ctx.fillText(`${clip.speedPercent.toFixed(0)} %`, clip.x + 5, y + 18);
    }
    ctx.restore();
  }

  // Indicateurs discrets : liaison A/V et presence d effets.
  if (o.modele.policy.handles && clip.width > 16) {
    let ix = clip.x + clip.width - 6;
    if (clip.hasEffects) {
      ctx.fillStyle = PALETTE.accroche;
      ctx.fillRect(ix - 2, y + 5, 4, 4);
      ix -= 8;
    }
    if (clip.linked) {
      ctx.fillStyle = PALETTE.texteDoux;
      ctx.fillRect(ix - 2, y + 5, 4, 2);
    }
  }

  ctx.restore();
}

/**
 * Forme d onde : enveloppe (min/max) en clair, energie (RMS) en plus dense.
 * Une colonne par pixel, lue au niveau de pyramide adapte au zoom.
 */
function dessinerFormeOnde(
  ctx: CanvasRenderingContext2D,
  o: OptionsRendu,
  clip: RenderModel['clips'][number],
  y: number,
  h: number,
): void {
  const colonnes = Math.max(1, Math.floor(clip.width));
  const donnees = o.formeOnde?.(clip, colonnes);
  if (donnees === null || donnees === undefined || donnees.length === 0) return;

  const milieu = y + h / 2;
  const amplitude = (h - 10) / 2;
  if (amplitude <= 1) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x, y, clip.width, h);
  ctx.clip();

  ctx.fillStyle = 'rgba(198, 236, 214, 0.45)';
  for (let i = 0; i < donnees.length; i += 1) {
    const col = donnees[i];
    if (col === undefined) continue;
    const haut = milieu - col.max * amplitude;
    const bas = milieu - col.min * amplitude;
    ctx.fillRect(clip.x + i, haut, 1, Math.max(1, bas - haut));
  }

  ctx.fillStyle = 'rgba(226, 248, 234, 0.85)';
  for (let i = 0; i < donnees.length; i += 1) {
    const col = donnees[i];
    if (col === undefined) continue;
    const demi = col.rms * amplitude;
    ctx.fillRect(clip.x + i, milieu - demi, 1, Math.max(1, demi * 2));
  }

  ctx.strokeStyle = 'rgba(226, 248, 234, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(clip.x, Math.round(milieu) + 0.5);
  ctx.lineTo(clip.x + clip.width, Math.round(milieu) + 0.5);
  ctx.stroke();

  ctx.restore();
}

function dessinerAccroche(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const image = o.geste?.accroche;
  if (image === null || image === undefined) return;
  const x = Math.round(timeToX(o.viewport, image)) + 0.5;
  ctx.strokeStyle = PALETTE.accroche;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, o.hauteur);
  ctx.stroke();
  ctx.setLineDash([]);
}

function dessinerTete(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const x = Math.round(timeToX(o.viewport, o.tete)) + 0.5;
  if (x < -10 || x > o.largeur + 10) return;

  ctx.strokeStyle = PALETTE.tete;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, o.hauteur);
  ctx.stroke();

  ctx.fillStyle = PALETTE.tete;
  ctx.beginPath();
  ctx.moveTo(x - 6, 0);
  ctx.lineTo(x + 6, 0);
  ctx.lineTo(x + 6, 9);
  ctx.lineTo(x, 15);
  ctx.lineTo(x - 6, 9);
  ctx.closePath();
  ctx.fill();
}

function dessinerRectangleSelection(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const r = o.geste?.rectangle;
  if (r === null || r === undefined) return;
  const x = Math.min(r.x1, r.x2);
  const y = Math.min(r.y1, r.y2);
  const w = Math.abs(r.x2 - r.x1);
  const h = Math.abs(r.y2 - r.y1);
  ctx.fillStyle = 'rgba(76, 141, 255, 0.15)';
  ctx.strokeStyle = PALETTE.accroche;
  ctx.lineWidth = 1;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}
