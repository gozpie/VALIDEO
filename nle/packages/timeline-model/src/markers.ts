/**
 * Marqueurs de sequence (section 41).
 *
 * Un marqueur est un REPERE, pas un clip : il ne bouge pas avec le montage, il
 * n a pas de piste, et il peut couvrir une duree (marqueur de segment) ou un
 * seul point. Les operations restent volontairement simples -- poser, deplacer,
 * renommer, retirer -- parce que c est tout ce qu un repere doit savoir faire.
 *
 * La liste est maintenue TRIEE par position. Rien ne l exige au niveau du
 * document, mais la navigation « marqueur suivant » devient alors une recherche
 * lineaire evidente au lieu d un tri a chaque frappe.
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok, randomUuid } from '@valideo/shared';
import type { MarkerDoc, SequenceDoc } from '@valideo/project-model';

export type MarkerResult = Result<SequenceDoc, AppError>;

function trier(marqueurs: readonly MarkerDoc[]): MarkerDoc[] {
  return [...marqueurs].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

export interface AddMarkerOptions {
  readonly time: number;
  readonly name?: string;
  readonly comment?: string;
  readonly color?: string;
  readonly duration?: number;
  readonly type?: MarkerDoc['type'];
}

/**
 * Pose un marqueur. Deux marqueurs a la meme image sont REFUSES : c est
 * quasiment toujours une double frappe, et deux reperes superposes seraient
 * indiscernables a l ecran comme au clavier.
 */
export function addMarker(sequence: SequenceDoc, options: AddMarkerOptions): MarkerResult {
  const time = Math.max(0, Math.trunc(options.time));
  if (sequence.markers.some((m) => m.time === time)) {
    return err(
      appError('EDIT_REJECTED', 'Il y a déjà un marqueur à cette image.', {
        action: 'Déplacez la tête de lecture, ou modifiez le marqueur existant',
      }),
    );
  }
  const marqueur: MarkerDoc = {
    id: randomUuid(),
    name: options.name ?? '',
    comment: options.comment ?? '',
    color: options.color ?? '#f0c040',
    time,
    duration: Math.max(0, Math.trunc(options.duration ?? 0)),
    type: options.type ?? 'comment',
  };
  return ok({ ...sequence, markers: trier([...sequence.markers, marqueur]) });
}

export function removeMarker(sequence: SequenceDoc, markerId: string): MarkerResult {
  if (!sequence.markers.some((m) => m.id === markerId)) {
    return err(appError('EDIT_REJECTED', 'Ce marqueur n’existe plus.', { detail: markerId }));
  }
  return ok({ ...sequence, markers: sequence.markers.filter((m) => m.id !== markerId) });
}

export function updateMarker(
  sequence: SequenceDoc,
  markerId: string,
  modifs: Partial<Omit<MarkerDoc, 'id'>>,
): MarkerResult {
  const existant = sequence.markers.find((m) => m.id === markerId);
  if (existant === undefined) {
    return err(appError('EDIT_REJECTED', 'Ce marqueur n’existe plus.', { detail: markerId }));
  }
  const fusionne: MarkerDoc = { ...existant, ...modifs, id: existant.id };
  const time = Math.max(0, Math.trunc(fusionne.time));
  if (time !== existant.time && sequence.markers.some((m) => m.id !== markerId && m.time === time)) {
    return err(appError('EDIT_REJECTED', 'Il y a déjà un marqueur à cette image.'));
  }
  return ok({
    ...sequence,
    markers: trier(sequence.markers.map((m) => (m.id === markerId ? { ...fusionne, time } : m))),
  });
}

/** Marqueur strictement apres `at`, ou `null`. */
export function nextMarker(sequence: SequenceDoc, at: number): MarkerDoc | null {
  for (const m of sequence.markers) if (m.time > at) return m;
  return null;
}

/** Marqueur strictement avant `at`, ou `null`. */
export function previousMarker(sequence: SequenceDoc, at: number): MarkerDoc | null {
  let trouve: MarkerDoc | null = null;
  for (const m of sequence.markers) {
    if (m.time >= at) break;
    trouve = m;
  }
  return trouve;
}
