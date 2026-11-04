/**
 * Poser un média sur la timeline (§91).
 *
 * Un seul endroit pour ce calcul, parce qu'il y a trois portes d'entrée — le
 * bouton « Poser », les raccourcis Insert et Overwrite, et le glisser-déposer —
 * et qu'elles doivent produire EXACTEMENT le même clip. Trois copies de la
 * conversion de durée, c'est trois occasions de les voir diverger d'une image.
 */
import { createClip } from '@valideo/project-model';
import type { ClipDoc, MediaAssetDoc, SequenceDoc, TrackDoc } from '@valideo/project-model';
import { appError, newLinkGroupId } from '@valideo/shared';
import type { AppError, Result } from '@valideo/shared';
import { err, ok } from '@valideo/shared';
import { div, mul, rational, round } from '@valideo/time-core';

export type TypePiste = 'video' | 'audio';

/** Le média porte-t-il de l'image ? Sinon c'est un clip audio. */
export function typeDeMedia(asset: MediaAssetDoc): TypePiste {
  return asset.videoStreams.length > 0 ? 'video' : 'audio';
}

/**
 * Durée du média exprimée dans la cadence de la SÉQUENCE.
 *
 * Un rush à 50 i/s posé sur une timeline à 25 i/s occupe deux fois moins
 * d'images qu'il n'en contient. Convertir en rationnel exact, jamais en
 * flottant : à 23,976 l'erreur s'accumule et décale la fin d'un plan long.
 */
export function dureeSurTimeline(asset: MediaAssetDoc, sequence: SequenceDoc): number {
  const cadenceSource = rational(asset.duration.base.rate.n, asset.duration.base.rate.d);
  const cadenceSequence = rational(sequence.timebase.rate.n, sequence.timebase.rate.d);
  return Math.max(
    1,
    round(mul(rational(asset.duration.frames), div(cadenceSequence, cadenceSource))),
  );
}

/** Image fixe : sa durée sur la timeline est libre, elle fournit autant d'images qu'on veut. */
export function estImageFixe(asset: MediaAssetDoc): boolean {
  return asset.metadata['imageFixe'] === 'oui';
}

/** Durée d'une image fixe posée sur la timeline, avant que le monteur l'ajuste. */
const SECONDES_IMAGE_FIXE = 5;

/**
 * Piste d'accueil : la première CIBLÉE du bon type, sinon la première
 * déverrouillée. Le repli est délibéré — poser un média sans avoir rien ciblé
 * est le geste d'un débutant, et refuser ne lui apprendrait rien.
 */
export function pisteDAccueil(sequence: SequenceDoc, type: TypePiste): Result<TrackDoc, AppError> {
  const piste =
    sequence.tracks.find((t) => t.kind === type && t.targeted && !t.locked) ??
    sequence.tracks.find((t) => t.kind === type && !t.locked);
  if (piste === undefined) {
    return err(
      appError(
        'EDIT_REJECTED',
        `Aucune piste ${type === 'video' ? 'vidéo' : 'audio'} disponible.`,
        {
          action: 'Déverrouillez ou ciblez une piste',
        },
      ),
    );
  }
  return ok(piste);
}

/** Construit le clip correspondant au média, prêt à être posé à `at`. */
export function clipDepuisMedia(
  asset: MediaAssetDoc,
  sequence: SequenceDoc,
  trackId: string,
  at: number,
): ClipDoc {
  const cadence = sequence.timebase.rate;
  const duree = estImageFixe(asset)
    ? Math.round((SECONDES_IMAGE_FIXE * cadence.n) / cadence.d)
    : dureeSurTimeline(asset, sequence);
  return createClip(typeDeMedia(asset), trackId, at, duree, {
    mediaId: asset.id,
    name: asset.name,
  });
}

/**
 * Clip son lié à un clip image, quand le média contient du son : posé sur la première piste audio
 * disponible, il suit l'image. `null` pour un média sans son.
 */
export function clipSonLie(
  asset: MediaAssetDoc,
  image: ClipDoc,
  sequence: SequenceDoc,
): { readonly image: ClipDoc; readonly son: ClipDoc } | null {
  if (asset.videoStreams.length === 0 || asset.audioStreams.length === 0) return null;
  const piste = pisteDAccueil(sequence, 'audio');
  if (!piste.ok) return null;
  const groupe = newLinkGroupId();
  return {
    image: { ...image, linkGroup: groupe },
    son: createClip('audio', piste.value.id, image.start, image.duration, {
      mediaId: asset.id,
      name: asset.name,
      sourceIn: image.sourceIn,
      linkGroup: groupe,
    }),
  };
}
