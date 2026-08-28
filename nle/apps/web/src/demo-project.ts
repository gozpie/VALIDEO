/**
 * Projet de demonstration.
 *
 * IMPORTANT (section 1003) : ces clips ne referencent AUCUN media reel. Ce sont
 * de vrais objets du modele -- caches couleur, titres, calques d effet -- qui
 * permettent d exercer le montage sans faire croire qu une lecture video est
 * disponible. L interface le signale explicitement.
 */
import { createClip, createProject, createSequence, toTimeBaseDoc } from '@valideo/project-model';
import type { ClipDoc, ProjectDoc, SequenceDoc } from '@valideo/project-model';
import { TIMEBASES } from '@valideo/time-core';
import { newLinkGroupId, newMarkerId, newProjectId, newSequenceId } from '@valideo/shared';

/**
 * Identite STABLE du projet de demonstration.
 *
 * Sans identifiant fixe, chaque chargement de page creerait un projet different
 * et rien ne pourrait jamais etre retrouve dans le stockage : l enregistrement
 * ecrirait a une adresse neuve a chaque fois. Un vrai projet, lui, recevra son
 * identifiant a la creation et le conservera.
 */
export const ID_PROJET_DEMO = newProjectId.of('00000000-0000-4000-8000-000000000001');
export const ID_SEQUENCE_DEMO = newSequenceId.of('00000000-0000-4000-8000-000000000002');

const ETIQUETTES = ['#c0563f', '#3f7fc0', '#4f9e5c', '#a05fbf', '#c08f3f', '#3f9ea0'];

interface Motif {
  readonly nom: string;
  readonly debut: number;
  readonly duree: number;
  readonly entree: number;
}

const PLANS: readonly Motif[] = [
  { nom: 'A001_ouverture', debut: 0, duree: 118, entree: 1200 },
  { nom: 'A002_contrechamp', debut: 118, duree: 87, entree: 2400 },
  { nom: 'A003_large', debut: 205, duree: 143, entree: 640 },
  { nom: 'A004_insert_mains', debut: 348, duree: 62, entree: 90 },
  { nom: 'A005_travelling', debut: 410, duree: 176, entree: 3010 },
  { nom: 'A006_reaction', debut: 586, duree: 94, entree: 512 },
  { nom: 'A007_final', debut: 680, duree: 145, entree: 1808 },
];

export function creerSequenceDemo(): SequenceDoc {
  const base = createSequence('Séquence 01', {
    timebase: TIMEBASES.TB25,
    videoTracks: 3,
    audioTracks: 4,
    startTimecode: 90000, // 01:00:00:00, convention broadcast
  });

  const pistes = [...base.tracks];
  const v1 = pistes.find((t) => t.kind === 'video' && t.index === 0);
  const v2 = pistes.find((t) => t.kind === 'video' && t.index === 1);
  const a1 = pistes.find((t) => t.kind === 'audio' && t.index === 0);
  const a2 = pistes.find((t) => t.kind === 'audio' && t.index === 1);
  if (v1 === undefined || v2 === undefined || a1 === undefined || a2 === undefined) return base;

  const clipsV1: ClipDoc[] = [];
  const clipsA1: ClipDoc[] = [];

  PLANS.forEach((plan, i) => {
    const groupe = newLinkGroupId();
    const image = createClip('colorMatte', v1.id, plan.debut, plan.duree, {
      name: plan.nom,
      sourceIn: plan.entree,
      linkGroup: groupe,
    });
    const son = createClip('audio', a1.id, plan.debut, plan.duree, {
      name: `${plan.nom}.wav`,
      sourceIn: plan.entree,
      linkGroup: groupe,
    });
    clipsV1.push({ ...image, label: ETIQUETTES[i % ETIQUETTES.length] ?? null });
    clipsA1.push(son);
  });

  // V2 : un titre et un calque d effet, pour montrer la superposition.
  const clipsV2: ClipDoc[] = [
    { ...createClip('title', v2.id, 30, 70, { name: 'Générique début' }), label: '#c08f3f' },
    {
      ...createClip('adjustmentLayer', v2.id, 410, 176, { name: 'Étalonnage séquence' }),
      label: '#3f9ea0',
    },
  ];

  // A2 : une ambiance continue, non liée à l image.
  const clipsA2: ClipDoc[] = [createClip('audio', a2.id, 0, 825, { name: 'Ambiance_salle.wav' })];

  const tracks = base.tracks.map((t) => {
    if (t.id === v1.id) return { ...t, clips: clipsV1 };
    if (t.id === v2.id) return { ...t, clips: clipsV2 };
    if (t.id === a1.id) return { ...t, clips: clipsA1 };
    if (t.id === a2.id) return { ...t, clips: clipsA2 };
    return t;
  });

  return {
    ...base,
    id: ID_SEQUENCE_DEMO,
    timebase: toTimeBaseDoc(TIMEBASES.TB25),
    tracks,
    markers: [
      {
        id: newMarkerId(),
        name: 'Départ montage',
        comment: '',
        color: '#4fb477',
        time: 0,
        duration: 0,
        type: 'comment',
      },
      {
        id: newMarkerId(),
        name: 'Point à revoir',
        comment: 'Raccord à retravailler',
        color: '#e0a63a',
        time: 348,
        duration: 0,
        type: 'comment',
      },
      {
        id: newMarkerId(),
        name: 'Fin',
        comment: '',
        color: '#4c8dff',
        time: 825,
        duration: 0,
        type: 'chapter',
      },
    ],
  };
}

export function creerProjetDemo(): { projet: ProjectDoc; sequence: SequenceDoc } {
  const sequence = creerSequenceDemo();
  const projet = createProject('Démonstration VALIDEO');
  return {
    projet: { ...projet, id: ID_PROJET_DEMO, sequences: [sequence], activeSequenceId: sequence.id },
    sequence,
  };
}
