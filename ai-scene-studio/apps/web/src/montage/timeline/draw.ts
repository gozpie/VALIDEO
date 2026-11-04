/**
 * Rendu Canvas de la timeline (sections 2, 17, 18, 55).
 *
 * Aucune dependance a React. Cette fonction est appelee directement depuis une
 * boucle d animation pendant un geste, donc SANS provoquer le moindre rendu
 * React (section 2). Elle ne fait que lire un modele deja calcule par
 * `@valideo/timeline-engine`.
 *
 * Formes d onde et vignettes proviennent de VRAIES donnees : echantillons
 * decodes pour les unes, images decodees par WebCodecs pour les autres. Un clip
 * dont le media n est pas decode n en recoit aucune -- il vaut mieux un fond uni
 * qu une courbe ou une image inventee (section 1003).
 */
import type { SequenceDoc } from '@valideo/project-model';
import type { TimeBase } from '@valideo/time-core';
import { formatTimecode, timebase, rational } from '@valideo/time-core';
import type { RenderModel, Viewport } from '@valideo/timeline-engine';
import { timeToX } from '@valideo/timeline-engine';
import { nomTransition, transitionsEffectives } from '@valideo/timeline-model';
import type { ClipDoc } from '@valideo/project-model';
import type { WaveformColumn } from '@valideo/audio-engine';

export const HAUTEUR_REGLE = 24;

export const PALETTE = {
  fond: '#17181c',
  fondRegle: '#1e2025',
  fondPisteVide: '#121317',
  bord: '#2a2c33',
  bordFort: '#3b3e47',
  texte: '#d9dce4',
  texteDoux: '#8f98a8',
  texteFort: '#ffffff',
  grille: '#22242a',
  clipVideo: '#27406e',
  clipVideoBord: '#4f7fd8',
  clipAudio: '#1f4d3a',
  clipAudioBord: '#3fa877',
  clipTitre: '#6b4f3d',
  clipTitreBord: '#a87c5c',
  clipCalque: '#4a3d6b',
  clipCalqueBord: '#7d5ca8',
  clipDesactive: '#23252b',
  selection: '#f2b632',
  tete: '#f85149',
  accroche: '#5b93ff',
  marqueur: '#d29922',
  zoneTravail: '#5b93ff',
  horsLigne: '#c4574f',
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

/**
 * Fournit une vignette DEJA PRETE pour un clip, ou `null`.
 *
 * Le rendu est synchrone : il ne peut pas attendre un decodage. Une vignette
 * absente est simplement omise ; elle apparaitra au rendu suivant.
 */
export type FournisseurVignette = (
  clip: RenderModel['clips'][number],
  secondesDansLeClip: number,
) => ImageBitmap | null;

export interface ApercuDepose {
  readonly trackId: string;
  readonly start: number;
  readonly duration: number;
  readonly mode: 'overwrite' | 'insert' | 'replace';
}

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
  /** Identifiants des clips dont le media est hors ligne (section 8, section 106). */
  readonly clipsHorsLigne?: ReadonlySet<string> | undefined;
  /** Apercu de depose : plage et piste visees, ou `null`. */
  readonly depose?: ApercuDepose | null | undefined;
  readonly formeOnde?: FournisseurFormeOnde | undefined;
  readonly vignette?: FournisseurVignette | undefined;
  readonly transitionSelectionnee?: string | null | undefined;
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
  dessinerZoneTravail(ctx, o);
  dessinerMarqueurs(ctx, o);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, HAUTEUR_REGLE, largeur, hauteur - HAUTEUR_REGLE);
  ctx.clip();
  ctx.translate(0, HAUTEUR_REGLE);

  dessinerFondsPistes(ctx, o);
  dessinerGraduationsVerticales(ctx, o);
  dessinerClips(ctx, o);
  dessinerTransitions(ctx, o);
  dessinerApercu(ctx, o);
  dessinerApercuDepose(ctx, o);

  ctx.restore();

  dessinerAccroche(ctx, o);
  dessinerTete(ctx, o);
  dessinerRectangleSelection(ctx, o);

  ctx.restore();
}

/**
 * Zone de travail : la plage entre les points d entree et de sortie.
 *
 * Dessinee en bandeau dans la regle, avec deux fanions aux bornes. Une seule
 * borne posee est aussi montree -- le reperage est en cours, et ne rien
 * afficher laisserait croire que la frappe n a pas ete prise.
 */
/**
 * Marqueurs de sequence, dans le bas de la regle (section 41).
 *
 * Un marqueur de duree non nulle est dessine en bandeau, les autres en pastille.
 * La couleur vient du document : c est la seule chose qui distingue deux
 * reperes voisins quand le zoom les rapproche.
 */
/**
 * Aperçu d une depose de media.
 *
 * Montre la place EXACTE que prendra le clip -- meme conversion de duree que
 * l operation qui suivra --, et distingue les trois modes : un cadre plein pour
 * l overwrite, un liseré d insertion pour l insert, un cadre sur le clip
 * remplace pour le replace. Sans cela, deposer serait un pari.
 */
function dessinerApercuDepose(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const d = o.depose;
  if (d === null || d === undefined) return;
  const piste = o.modele.tracks.find((t) => t.trackId === d.trackId);
  if (piste === undefined) return;

  const x1 = timeToX(o.viewport, d.start);
  const x2 = timeToX(o.viewport, d.start + d.duration);
  ctx.save();
  ctx.strokeStyle = PALETTE.accroche;
  ctx.fillStyle = PALETTE.accroche;
  ctx.lineWidth = 2;

  if (d.mode === 'insert') {
    // L insertion ne recouvre rien : ce qui compte est le POINT ou la timeline
    // s ouvrira, pas l etendue du clip.
    const x = Math.round(x1) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, piste.y);
    ctx.lineTo(x, piste.y + piste.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 5, piste.y);
    ctx.lineTo(x + 5, piste.y);
    ctx.lineTo(x, piste.y + 6);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.globalAlpha = 0.18;
    ctx.fillRect(x1, piste.y + 1, x2 - x1, piste.height - 2);
    ctx.globalAlpha = 1;
    ctx.setLineDash(d.mode === 'replace' ? [] : [5, 3]);
    ctx.strokeRect(Math.round(x1) + 0.5, piste.y + 1.5, Math.round(x2 - x1) - 1, piste.height - 3);
  }
  ctx.restore();
}

function dessinerMarqueurs(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const y = HAUTEUR_REGLE - 7;
  for (const m of o.sequence.markers) {
    const x = Math.round(timeToX(o.viewport, m.time));
    if (x < -40 || x > o.largeur + 40) continue;
    ctx.fillStyle = m.color;
    if (m.duration > 0) {
      const fin = Math.round(timeToX(o.viewport, m.time + m.duration));
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, y, Math.max(2, fin - x), 5);
      ctx.globalAlpha = 1;
    }
    // Pastille pointue vers le bas : elle designe une image precise, et une
    // simple barre se confondrait avec les graduations de la regle.
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x, HAUTEUR_REGLE - 1);
    ctx.closePath();
    ctx.fill();
  }
}

function dessinerZoneTravail(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const { workAreaIn, workAreaOut } = o.sequence;
  if (workAreaIn === null && workAreaOut === null) return;

  const xEntree = workAreaIn === null ? null : timeToX(o.viewport, workAreaIn);
  const xSortie = workAreaOut === null ? null : timeToX(o.viewport, workAreaOut);

  if (xEntree !== null && xSortie !== null && xSortie > xEntree) {
    ctx.fillStyle = PALETTE.zoneTravail;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(xEntree, 0, xSortie - xEntree, HAUTEUR_REGLE - 1);
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = PALETTE.zoneTravail;
  // Le fanion pointe VERS la plage : celui d entree s ouvre a droite, celui de
  // sortie a gauche. C est ce qui rend les deux distinguables d un coup d oeil
  // quand ils sont proches.
  if (xEntree !== null) {
    const x = Math.round(xEntree);
    ctx.beginPath();
    ctx.moveTo(x, 1);
    ctx.lineTo(x + 7, 1);
    ctx.lineTo(x + 2, 7);
    ctx.lineTo(x + 2, HAUTEUR_REGLE - 2);
    ctx.lineTo(x, HAUTEUR_REGLE - 2);
    ctx.closePath();
    ctx.fill();
  }
  if (xSortie !== null) {
    const x = Math.round(xSortie);
    ctx.beginPath();
    ctx.moveTo(x, 1);
    ctx.lineTo(x - 7, 1);
    ctx.lineTo(x - 2, 7);
    ctx.lineTo(x - 2, HAUTEUR_REGLE - 2);
    ctx.lineTo(x, HAUTEUR_REGLE - 2);
    ctx.closePath();
    ctx.fill();
  }
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

/** Hauteur de la bande d'une transition, posée au bas des clips. */
const HAUTEUR_TRANSITION = 16;

export interface ZoneTransition {
  readonly id: string;
  readonly x1: number;
  readonly x2: number;
  readonly y1: number;
  readonly y2: number;
}

/** Bandes des transitions, en coordonnées de la zone des pistes (sous la règle). */
export function zonesTransitions(
  sequence: OptionsRendu['sequence'],
  modele: RenderModel,
  viewport: Viewport,
): readonly ZoneTransition[] {
  return modele.tracks.flatMap((disposition) => {
    const piste = sequence.tracks.find((t) => t.id === disposition.trackId);
    if (piste === undefined) return [];
    const bas = disposition.y + disposition.height - 1;
    return transitionsEffectives(piste).map((t) => ({
      id: t.id,
      x1: timeToX(viewport, t.debut),
      x2: timeToX(viewport, t.fin),
      y1: bas - Math.min(HAUTEUR_TRANSITION, disposition.height / 2),
      y2: bas,
    }));
  });
}

function dessinerTransitions(ctx: CanvasRenderingContext2D, o: OptionsRendu): void {
  const types = new Map(
    o.sequence.tracks.flatMap((p) => transitionsEffectives(p)).map((t) => [t.id, t]),
  );
  for (const zone of zonesTransitions(o.sequence, o.modele, o.viewport)) {
    if (zone.x2 < 0 || zone.x1 > o.largeur) continue;
    const t = types.get(zone.id);
    const l = Math.max(3, zone.x2 - zone.x1);
    const h = zone.y2 - zone.y1;
    const choisie = o.transitionSelectionnee === zone.id;
    ctx.save();
    ctx.fillStyle = choisie ? 'rgba(242, 182, 50, 0.85)' : 'rgba(232, 236, 244, 0.82)';
    ctx.strokeStyle = choisie ? PALETTE.selection : 'rgba(8, 9, 11, 0.8)';
    ctx.lineWidth = 1;
    ctx.fillRect(zone.x1, zone.y1, l, h);
    ctx.strokeRect(Math.round(zone.x1) + 0.5, Math.round(zone.y1) + 0.5, Math.round(l) - 1, h - 1);
    // La diagonale dit le sens : ce qui s'efface, ce qui apparaît.
    ctx.strokeStyle = 'rgba(8, 9, 11, 0.55)';
    ctx.beginPath();
    if (t?.de === null) {
      ctx.moveTo(zone.x1, zone.y2);
      ctx.lineTo(zone.x1 + l, zone.y1);
    } else {
      ctx.moveTo(zone.x1, zone.y1);
      ctx.lineTo(zone.x1 + l, zone.y2);
    }
    ctx.stroke();
    if (l > 70 && t !== undefined) {
      ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#101114';
      ctx.fillText(nomTransition(t.type), zone.x1 + l / 2, zone.y1 + h / 2 + 0.5);
    }
    ctx.restore();
  }
}

const clipsParSequence = new WeakMap<OptionsRendu['sequence'], ReadonlyMap<string, ClipDoc>>();

function clipDoc(sequence: OptionsRendu['sequence'], id: string): ClipDoc | undefined {
  let index = clipsParSequence.get(sequence);
  if (index === undefined) {
    index = new Map(sequence.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const)));
    clipsParSequence.set(sequence, index);
  }
  return index.get(id);
}

/** Losanges des images clés, en haut du clip. */
function dessinerCles(
  ctx: CanvasRenderingContext2D,
  o: OptionsRendu,
  clip: RenderModel['clips'][number],
  y: number,
): void {
  const doc = clipDoc(o.sequence, clip.clipId);
  if (doc === undefined) return;
  const temps = new Set(
    [
      doc.opacity,
      doc.transform.position,
      doc.transform.scale,
      doc.transform.rotation,
      doc.audio.gainDb,
      doc.audio.pan,
    ].flatMap((p) => p.keyframes.map((k) => k.time)),
  );
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(8, 9, 11, 0.8)';
  ctx.lineWidth = 1;
  for (const t of temps) {
    if (t < 0 || t >= doc.duration) continue;
    const x = timeToX(o.viewport, doc.start + t);
    const cy = y + 5;
    ctx.beginPath();
    ctx.moveTo(x, cy - 4);
    ctx.lineTo(x + 4, cy);
    ctx.lineTo(x, cy + 4);
    ctx.lineTo(x - 4, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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

  // Media hors ligne : hachures rouges par-dessus le fond, et bordure rouge.
  // Le clip reste MONTABLE -- on peut le deplacer, le trimer, le remplacer --
  // mais rien ne doit laisser croire qu il a encore une image a montrer.
  const horsLigne = o.clipsHorsLigne?.has(clip.clipId) === true;
  if (horsLigne) {
    ctx.save();
    rectArrondi(ctx, clip.x, y, clip.width, h, 3, !clip.clippedLeft, !clip.clippedRight);
    ctx.clip();
    ctx.strokeStyle = PALETTE.horsLigne;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = -h; d < clip.width; d += 8) {
      ctx.moveTo(clip.x + d, y + h);
      ctx.lineTo(clip.x + d + h, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = clip.selected ? PALETTE.selection : horsLigne ? PALETTE.horsLigne : bord;
  ctx.lineWidth = clip.selected || horsLigne ? 2 : 1;
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

  if (clip.kind === 'audio' && clip.width > 4 && o.formeOnde !== undefined) {
    dessinerFormeOnde(ctx, o, clip, y, h);
  }

  if (clip.kind !== 'audio' && clip.width >= 20 && o.vignette !== undefined) {
    dessinerVignettes(ctx, o, clip, y, h);
  }

  if (o.modele.policy.labels && clip.width > 28) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(clip.x + 4, y, clip.width - 8, h);
    ctx.clip();
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    const nom = clip.name || clip.kind;
    // Le nom reste lisible par-dessus l'image.
    ctx.fillStyle = 'rgba(8, 9, 11, 0.62)';
    ctx.fillRect(clip.x + 2, y + 3, Math.min(clip.width - 4, ctx.measureText(nom).width + 8), 16);
    ctx.fillStyle = PALETTE.texteFort;
    ctx.fillText(nom, clip.x + 6, y + 6);

    if (horsLigne && clip.width > 90) {
      ctx.fillStyle = PALETTE.horsLigne;
      ctx.fillText('MÉDIA HORS LIGNE', clip.x + 5, y + h - 14);
    }

    if (clip.speedPercent !== null && clip.width > 80) {
      ctx.fillStyle = PALETTE.texteDoux;
      ctx.fillText(`${clip.speedPercent.toFixed(0)} %`, clip.x + 5, y + 18);
    }
    ctx.restore();
  }

  dessinerCles(ctx, o, clip, y);

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

/** Images différentes décodées par clip, au plus : le reste de la bande les répète. */
const VIGNETTES_MAX = 6;

/**
 * Bande d'images d'un clip : tout le clip est couvert, on voit ce qu'il contient à tous les zooms.
 * Une vignette pas encore décodée laisse le fond du clip ; elle apparaîtra au dessin suivant.
 */
function dessinerVignettes(
  ctx: CanvasRenderingContext2D,
  o: OptionsRendu,
  clip: RenderModel['clips'][number],
  y: number,
  h: number,
): void {
  const fournir = o.vignette;
  if (fournir === undefined || h < 28) return;

  const dureeSecondes = clip.duration / (o.base.rate.n / o.base.rate.d);
  const hauteur = h - 2;
  const premiere = fournir(clip, 0);
  const largeur =
    premiere === null
      ? Math.round((hauteur * 16) / 9)
      : Math.max(1, Math.round((premiere.width / premiere.height) * hauteur));
  const colonnes = Math.max(1, Math.ceil(clip.width / largeur));
  const images = Math.min(colonnes, VIGNETTES_MAX);

  ctx.save();
  ctx.beginPath();
  ctx.rect(clip.x + 1, y + 1, clip.width - 2, h - 2);
  ctx.clip();
  for (let colonne = 0; colonne < colonnes; colonne += 1) {
    const x = clip.x + colonne * largeur;
    if (x > o.largeur || x + largeur < 0) continue;
    const rang = Math.floor((colonne * images) / colonnes);
    const bitmap = fournir(clip, (rang * dureeSecondes) / images);
    if (bitmap !== null) ctx.drawImage(bitmap, x, y + 1, largeur, hauteur);
  }
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
