/**
 * Les operations de montage, emballees en commandes annulables.
 *
 * C est la seule porte d entree que l interface doit utiliser : elle garantit
 * que TOUT ce que fait l utilisateur passe par l historique (section 43), y
 * compris les operations composees.
 *
 * La `mergeKey` est ce qui evite qu un glisser-deposer de 200 images produise
 * 200 entrees d annulation : toutes les etapes d un meme geste fusionnent.
 */
import type { Command } from '@valideo/command-system';
import { command } from '@valideo/command-system';
import type { SequenceDoc } from '@valideo/project-model';
import type { TimelineContext } from './source.js';
import * as ops from './edit-ops.js';
import * as clip from './clipboard.js';
import * as mark from './markers.js';

export type SequenceCommand = Command<SequenceDoc>;

export function overwriteCommand(
  options: ops.OverwriteOptions,
  ctx: TimelineContext,
): SequenceCommand {
  return command({
    label: 'Overwrite',
    apply: (seq) => ops.overwrite(seq, options, ctx),
  });
}

export function insertCommand(options: ops.InsertOptions, ctx: TimelineContext): SequenceCommand {
  return command({
    label: 'Insert',
    apply: (seq) => ops.insert(seq, options, ctx),
  });
}

export function liftCommand(options: ops.RangeOptions, ctx: TimelineContext): SequenceCommand {
  return command({
    label: 'Lift',
    apply: (seq) => ops.lift(seq, options, ctx),
  });
}

export function extractCommand(options: ops.ExtractOptions, ctx: TimelineContext): SequenceCommand {
  return command({
    label: 'Extract',
    apply: (seq) => ops.extract(seq, options, ctx),
  });
}

export function deleteClipCommand(
  clipId: string,
  ctx: TimelineContext,
  ripple = false,
): SequenceCommand {
  return command({
    label: ripple ? 'Suppression avec ripple' : 'Supprimer',
    apply: (seq) => ops.deleteClip(seq, clipId, ctx, ripple),
  });
}

export function razorCommand(
  at: number,
  trackIds: readonly string[],
  ctx: TimelineContext,
): SequenceCommand {
  return command({
    label: 'Couper',
    apply: (seq) => ops.razor(seq, at, trackIds, ctx),
  });
}

export function addEditCommand(at: number, ctx: TimelineContext): SequenceCommand {
  return command({
    label: 'Ajouter un point de montage',
    apply: (seq) => ops.addEditAtPlayhead(seq, at, ctx),
  });
}

/** Le glisser-deposer d un clip : toutes les etapes fusionnent en une annulation. */
export function moveClipCommand(options: ops.MoveOptions, ctx: TimelineContext): SequenceCommand {
  return command({
    label: 'Déplacer le clip',
    mergeKey: `move:${options.clipId}`,
    apply: (seq) => ops.moveClip(seq, options, ctx),
  });
}

export function trimCommand(options: ops.TrimOptions, ctx: TimelineContext): SequenceCommand {
  const mode = options.mode ?? 'normal';
  return command({
    label: mode === 'ripple' ? 'Ripple trim' : 'Trim',
    mergeKey: `trim:${options.clipId}:${options.edge}:${mode}`,
    apply: (seq) => ops.trimClip(seq, options, ctx),
  });
}

export function rippleTrimToPlayheadCommand(
  at: number,
  side: 'previous' | 'next',
  ctx: TimelineContext,
): SequenceCommand {
  return command({
    label:
      side === 'previous'
        ? 'Ripple trim jusqu’à la tête (précédent)'
        : 'Ripple trim jusqu’à la tête (suivant)',
    apply: (seq) => ops.rippleTrimToPlayhead(seq, at, side, ctx),
  });
}

export function rollCommand(
  trackId: string,
  at: number,
  delta: number,
  ctx: TimelineContext,
): SequenceCommand {
  return command({
    label: 'Rolling trim',
    mergeKey: `roll:${trackId}:${at}`,
    apply: (seq) => ops.rollEdit(seq, trackId, at, delta, ctx),
  });
}

export function slipCommand(clipId: string, delta: number, ctx: TimelineContext): SequenceCommand {
  return command({
    label: 'Slip',
    mergeKey: `slip:${clipId}`,
    apply: (seq) => ops.slipClip(seq, clipId, delta, ctx),
  });
}

export function slideCommand(clipId: string, delta: number, ctx: TimelineContext): SequenceCommand {
  return command({
    label: 'Slide',
    mergeKey: `slide:${clipId}`,
    apply: (seq) => ops.slideClip(seq, clipId, delta, ctx),
  });
}

export function rateStretchCommand(
  clipId: string,
  newDuration: number,
  ctx: TimelineContext,
): SequenceCommand {
  return command({
    label: 'Étirement temporel',
    mergeKey: `rate:${clipId}`,
    apply: (seq) => ops.rateStretch(seq, clipId, newDuration, ctx),
  });
}

export function linkCommand(clipIds: readonly string[]): SequenceCommand {
  return command({ label: 'Lier', apply: (seq) => ops.linkClips(seq, clipIds) });
}

export function unlinkCommand(clipIds: readonly string[]): SequenceCommand {
  return command({ label: 'Délier', apply: (seq) => ops.unlinkClips(seq, clipIds) });
}

/**
 * Pose ou efface les points d entree et de sortie.
 *
 * C est bien une commande annulable : le reperage fait partie du travail de
 * montage, et le perdre a une annulation malheureuse serait aussi penible que
 * de perdre une coupe. La `mergeKey` evite qu un deplacement de point au
 * pointeur n empile une entree par image survolee.
 */
export function setWorkAreaCommand(zone: ops.WorkArea, mergeKey?: string): SequenceCommand {
  return command({
    label: 'Points d\u2019entrée et de sortie',
    apply: (seq) => ops.setWorkArea(seq, zone),
    ...(mergeKey === undefined ? {} : { mergeKey }),
  });
}

export function setTrackFlagsCommand(
  trackId: string,
  flags: ops.TrackFlags,
  libelle: string,
): SequenceCommand {
  return command({ label: libelle, apply: (seq) => ops.setTrackFlags(seq, trackId, flags) });
}

/** Déplacement groupé : une seule entrée d'historique pour tout le geste. */
export function moveClipsCommand(
  deplacements: readonly ops.DeplacementClip[],
  ctx: TimelineContext,
  mergeKey: string | null = null,
): SequenceCommand {
  return command({
    label: deplacements.length > 1 ? `Déplacer ${deplacements.length} clips` : 'Déplacer le clip',
    mergeKey,
    apply: (seq) => ops.moveClips(seq, deplacements, ctx),
  });
}

/** Suppression groupée : une seule annulation pour toute la sélection. */
export function deleteClipsCommand(
  clipIds: readonly string[],
  ctx: TimelineContext,
  ripple = false,
): SequenceCommand {
  const quoi = clipIds.length > 1 ? `${clipIds.length} clips` : 'le clip';
  return command({
    label: ripple ? `Supprimer ${quoi} avec ripple` : `Supprimer ${quoi}`,
    apply: (seq) => ops.deleteClips(seq, clipIds, ctx, ripple),
  });
}

/**
 * Colle le presse-papiers. Le clip du presse-papiers n est PAS capture dans la
 * commande par reference mutable : `ClipboardContent` est une valeur immuable,
 * donc refaire un collage annule redonne exactement le meme resultat, meme si
 * l utilisateur a copie autre chose entre-temps.
 */
export function pasteCommand(
  contenu: clip.ClipboardContent,
  options: clip.PasteOptions,
  ctx: TimelineContext,
): SequenceCommand {
  return command({
    label: options.insert === true ? 'Coller par insertion' : 'Coller',
    apply: (seq) => clip.pasteClips(seq, contenu, options, ctx),
  });
}

export function changeSpeedCommand(
  options: ops.SpeedOptions,
  ctx: TimelineContext,
): SequenceCommand {
  return command({
    label: 'Vitesse et durée',
    apply: (seq) => ops.changeSpeed(seq, options, ctx),
  });
}

export function addMarkerCommand(options: mark.AddMarkerOptions): SequenceCommand {
  return command({ label: 'Ajouter un marqueur', apply: (seq) => mark.addMarker(seq, options) });
}

export function removeMarkerCommand(markerId: string): SequenceCommand {
  return command({ label: 'Supprimer le marqueur', apply: (seq) => mark.removeMarker(seq, markerId) });
}

export function updateMarkerCommand(
  markerId: string,
  modifs: Parameters<typeof mark.updateMarker>[2],
  label = 'Modifier le marqueur',
): SequenceCommand {
  return command({ label, apply: (seq) => mark.updateMarker(seq, markerId, modifs) });
}
