import type { MediaAssetDoc, SequenceDoc } from '@valideo/project-model';
import { describe, expect, it } from 'vitest';
import {
  clipsImageDuPlan,
  documentInitial,
  LIENS_VIDES,
  mediasManquants,
  oublierPlan,
  synchroniserFilm,
  type LiensFilm,
  type MediaRecu,
  type PlanDuFilm,
} from '@/montage/film';

const CADENCE = { n: 24, d: 1 };

function sequenceVide(): SequenceDoc {
  const document = documentInitial({
    projectId: '11111111-1111-4111-8111-111111111111',
    name: 'Le phare',
    fps: { numerator: 24, denominator: 1 },
    width: 1920,
    height: 1080,
  });
  return document.sequences[0]!;
}

function plan(numero: number, assetId: string | null, kind = 'image', seconds = 2): PlanDuFilm {
  return {
    shotId: `plan-${numero}`,
    label: `P${numero}`,
    name: `Plan ${numero}`,
    sequence: 'Séquence 1',
    status: 'draft',
    seconds,
    media:
      assetId === null
        ? null
        : {
            assetId,
            kind,
            mimeType: kind === 'image' ? 'image/png' : 'video/mp4',
            versionNumber: 1,
            retained: true,
          },
  };
}

function media(id: string, options: { frames?: number; son?: boolean; fixe?: boolean } = {}) {
  const fixe = options.fixe ?? true;
  return {
    id,
    name: id,
    duration: {
      frames: fixe ? 86400 : (options.frames ?? 48),
      base: { rate: CADENCE, mode: 'NDF' },
    },
    videoStreams: [{}],
    audioStreams: options.son ? [{}] : [],
    metadata: fixe ? { imageFixe: 'oui' } : {},
    status: 'online',
  } as unknown as MediaAssetDoc;
}

function recu(p: PlanDuFilm, asset: MediaAssetDoc): MediaRecu {
  return {
    shotId: p.shotId,
    assetId: p.media!.assetId,
    mimeType: p.media!.mimeType,
    nom: p.label,
    asset,
  };
}

/** Une synchronisation complète : ce que `useFilm` fait après avoir récupéré les fichiers. */
function synchro(
  sequence: SequenceDoc,
  plans: PlanDuFilm[],
  liens: LiensFilm,
  connus: MediaAssetDoc[],
  nouveaux: Record<string, MediaAssetDoc>,
) {
  const recus = mediasManquants(plans, liens).map((besoin) => {
    const asset = nouveaux[besoin.assetId];
    if (asset === undefined) throw new Error(`média inattendu : ${besoin.assetId}`);
    return { ...besoin, asset };
  });
  return synchroniserFilm(sequence, plans, liens, [...connus, ...recus.map((r) => r.asset)], recus);
}

const piste = (sequence: SequenceDoc, kind: 'video' | 'audio') =>
  sequence.tracks.find((t) => t.kind === kind && t.index === 0)!.clips;

describe('assemblage du film', () => {
  it('pose les plans dans l’ordre, un plan sans image garde sa place', () => {
    const plans = [plan(1, 'a1'), plan(2, null, 'image', 3), plan(3, 'a3')];
    const { sequence, liens, bilan } = synchro(sequenceVide(), plans, LIENS_VIDES, [], {
      a1: media('m1'),
      a3: media('m3'),
    });
    const clips = piste(sequence, 'video');
    expect(clips.map((c) => [c.start, c.duration, c.kind, c.mediaId])).toEqual([
      [0, 48, 'video', 'm1'],
      [48, 72, 'colorMatte', null],
      [120, 48, 'video', 'm3'],
    ]);
    expect(clips[1]!.name).toBe('P2 — Plan 2');
    expect(bilan).toEqual({ ajoutes: 3, remplaces: 0, horsFilm: 0 });
    expect(liens.shots['plan-2']).toEqual({ assetId: null });
  });

  it('ne dépasse pas ce que la vidéo contient, et garde le découpage quand elle est plus longue', () => {
    const plans = [plan(1, 'court', 'video', 5), plan(2, 'long', 'video', 2)];
    const { sequence } = synchro(sequenceVide(), plans, LIENS_VIDES, [], {
      court: media('m1', { fixe: false, frames: 48 }),
      long: media('m2', { fixe: false, frames: 240 }),
    });
    expect(piste(sequence, 'video').map((c) => c.duration)).toEqual([48, 48]);
  });

  it('lie le son d’une vidéo sonore sur A1', () => {
    const plans = [plan(1, 'a1', 'video', 2)];
    const { sequence } = synchro(sequenceVide(), plans, LIENS_VIDES, [], {
      a1: media('m1', { fixe: false, frames: 48, son: true }),
    });
    const [image] = piste(sequence, 'video');
    const [son] = piste(sequence, 'audio');
    expect(son!.mediaId).toBe('m1');
    expect(son!.linkGroup).not.toBeNull();
    expect(son!.linkGroup).toBe(image!.linkGroup);
  });
});

describe('le film suit le studio', () => {
  function filmDepart() {
    const plans = [plan(1, 'a1'), plan(2, null), plan(3, 'a3')];
    const medias = [media('m1'), media('m3')];
    const debut = synchro(sequenceVide(), plans, LIENS_VIDES, [], {
      a1: medias[0]!,
      a3: medias[1]!,
    });
    return { ...debut, medias };
  }

  it('ne fait rien quand rien n’a changé', () => {
    const { sequence, liens, medias } = filmDepart();
    const plans = [plan(1, 'a1'), plan(2, null), plan(3, 'a3')];
    expect(mediasManquants(plans, liens)).toEqual([]);
    const suite = synchro(sequence, plans, liens, medias, {});
    expect(suite.sequence).toBe(sequence);
    expect(suite.bilan).toEqual({ ajoutes: 0, remplaces: 0, horsFilm: 0 });
  });

  it('remplace l’attente quand le plan arrive, sans bouger le reste', () => {
    const { sequence, liens, medias } = filmDepart();
    const plans = [plan(1, 'a1'), plan(2, 'a2'), plan(3, 'a3')];
    const suite = synchro(sequence, plans, liens, medias, { a2: media('m2') });
    const clips = piste(suite.sequence, 'video');
    expect(clips.map((c) => [c.start, c.kind, c.mediaId, c.label])).toEqual([
      [0, 'video', 'm1', null],
      [48, 'video', 'm2', null],
      [96, 'video', 'm3', null],
    ]);
    expect(suite.bilan.remplaces).toBe(1);
    expect(suite.liens.attentes).toEqual({});
  });

  it('une nouvelle version garde le montage du monteur : place, durée, nom mis à jour', () => {
    const { sequence, liens, medias } = filmDepart();
    const clip = piste(sequence, 'video')[0]!;
    const raccourci: SequenceDoc = {
      ...sequence,
      tracks: sequence.tracks.map((t) =>
        t.clips.includes(clip)
          ? { ...t, clips: t.clips.map((c) => (c === clip ? { ...c, duration: 20 } : c)) }
          : t,
      ),
    };
    const plans = [{ ...plan(1, 'a1b'), name: 'Nouveau' }, plan(2, null), plan(3, 'a3')];
    const suite = synchro(raccourci, plans, liens, medias, { a1b: media('m1b') });
    const remplace = piste(suite.sequence, 'video')[0]!;
    expect([remplace.start, remplace.duration, remplace.mediaId, remplace.name]).toEqual([
      0,
      20,
      'm1b',
      'P1 — Nouveau',
    ]);
    expect(remplace.id).toBe(clip.id);
  });

  it('une version vidéo plus courte raccourcit le clip au lieu de laisser une fin noire', () => {
    const { sequence, liens, medias } = filmDepart();
    const plans = [plan(1, 'a1b', 'video'), plan(2, null), plan(3, 'a3')];
    const suite = synchro(sequence, plans, liens, medias, {
      a1b: media('m1b', { fixe: false, frames: 30 }),
    });
    expect(piste(suite.sequence, 'video')[0]!.duration).toBe(30);
    expect(piste(suite.sequence, 'video')[1]!.start).toBe(48);
  });

  it('une version sans son retire le son de la précédente', () => {
    const plans = [plan(1, 'a1', 'video')];
    const avecSon = media('m1', { fixe: false, frames: 48, son: true });
    const debut = synchro(sequenceVide(), plans, LIENS_VIDES, [], { a1: avecSon });
    const suite = synchro(debut.sequence, [plan(1, 'a1b', 'video')], debut.liens, [avecSon], {
      a1b: media('m1b', { fixe: false, frames: 48 }),
    });
    expect(piste(suite.sequence, 'audio')).toEqual([]);
    expect(piste(suite.sequence, 'video')[0]!.mediaId).toBe('m1b');
  });

  it('un plan nouveau s’insère après celui qui le précède et décale la suite', () => {
    const { sequence, liens, medias } = filmDepart();
    const plans = [plan(1, 'a1'), plan(9, 'a9'), plan(2, null), plan(3, 'a3')];
    const suite = synchro(sequence, plans, liens, medias, { a9: media('m9') });
    const clips = piste(suite.sequence, 'video');
    expect(clips.map((c) => [c.start, c.mediaId])).toEqual([
      [0, 'm1'],
      [48, 'm9'],
      [96, null],
      [144, 'm3'],
    ]);
  });

  it('un clip retiré à la main ne revient pas tout seul, même avec une nouvelle version', () => {
    const { sequence, liens, medias } = filmDepart();
    const sansPremier: SequenceDoc = {
      ...sequence,
      tracks: sequence.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => c.mediaId !== 'm1'),
      })),
    };
    const plans = [plan(1, 'a1b'), plan(2, null), plan(3, 'a3')];
    const suite = synchro(sansPremier, plans, liens, medias, { a1b: media('m1b') });
    expect(piste(suite.sequence, 'video').some((c) => c.mediaId === 'm1b')).toBe(false);
    expect(suite.bilan).toEqual({ ajoutes: 0, remplaces: 0, horsFilm: 1 });

    const remis = synchro(
      suite.sequence,
      plans,
      oublierPlan(suite.liens, 'plan-1'),
      [...medias, media('m1b')],
      {},
    );
    expect(clipsImageDuPlan(remis.sequence, 'plan-1', remis.liens)[0]!.mediaId).toBe('m1b');
  });

  it('un média non récupéré laisse le plan en attente, à réessayer', () => {
    const plans = [plan(1, 'a1')];
    const { sequence, liens } = synchroniserFilm(sequenceVide(), plans, LIENS_VIDES, [], []);
    expect(piste(sequence, 'video')[0]!.kind).toBe('colorMatte');
    expect(liens.shots['plan-1']).toEqual({ assetId: null });
    expect(mediasManquants(plans, liens).map((b) => b.assetId)).toEqual(['a1']);
    const asset = media('m1');
    const reprise = synchroniserFilm(sequence, plans, liens, [asset], [recu(plans[0]!, asset)]);
    expect(piste(reprise.sequence, 'video')[0]!.mediaId).toBe('m1');
  });
});
