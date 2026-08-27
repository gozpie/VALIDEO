/**
 * Fabriques de documents valides.
 *
 * Toute creation d entite passe par ici : c est la garantie qu aucun document
 * partiellement initialise ne circule dans le moteur.
 */
import {
  newBinId,
  newClipId,
  newProjectId,
  newSequenceId,
  newTrackId,
  uuid,
} from '@valideo/shared';
import type { TimeBase } from '@valideo/time-core';
import { TIMEBASES } from '@valideo/time-core';
import { PROJECT_SCHEMA_VERSION } from './schema.js';
import type {
  ClipDoc,
  ClipKind,
  ProjectDoc,
  SequenceDoc,
  SequenceSettingsDoc,
  TimeBaseDoc,
  TrackDoc,
  TrackKind,
} from './schema.js';

export function toTimeBaseDoc(tb: TimeBase): TimeBaseDoc {
  return { rate: { n: tb.rate.n, d: tb.rate.d }, mode: tb.mode };
}

const DEFAULT_PARAM = { keyframes: [] as never[] };

export function createTrack(
  kind: TrackKind,
  index: number,
  overrides: Partial<TrackDoc> = {},
): TrackDoc {
  return {
    id: newTrackId(),
    kind,
    name: `${kind === 'video' ? 'V' : 'A'}${index + 1}`,
    index,
    locked: false,
    enabled: true,
    muted: false,
    solo: false,
    syncLock: true,
    // Par convention NLE, la premiere piste video et la premiere piste audio
    // sont ciblees a la creation : Insert et Overwrite ont ainsi une cible.
    targeted: index === 0,
    height: kind === 'video' ? 60 : 50,
    channels: 2,
    clips: [],
    transitions: [],
    ...overrides,
  };
}

export interface CreateSequenceOptions {
  readonly timebase?: TimeBase;
  readonly settings?: Partial<SequenceSettingsDoc>;
  readonly videoTracks?: number;
  readonly audioTracks?: number;
  readonly startTimecode?: number;
}

export function createSequence(name: string, options: CreateSequenceOptions = {}): SequenceDoc {
  const timebase = options.timebase ?? TIMEBASES.TB25;
  const videoTracks = options.videoTracks ?? 3;
  const audioTracks = options.audioTracks ?? 4;

  const tracks: TrackDoc[] = [];
  for (let i = 0; i < videoTracks; i += 1) tracks.push(createTrack('video', i));
  for (let i = 0; i < audioTracks; i += 1) tracks.push(createTrack('audio', i));

  return {
    id: newSequenceId(),
    name,
    timebase: toTimeBaseDoc(timebase),
    settings: {
      width: 1920,
      height: 1080,
      pixelAspect: { n: 1, d: 1 },
      fieldOrder: 'progressive',
      audioSampleRate: 48000,
      audioChannels: 2,
      workingColorSpace: 'rec709',
      previewFormat: 'h264',
      displayFormat: 'timecode',
      ...options.settings,
    },
    startTimecode: options.startTimecode ?? 0,
    tracks,
    markers: [],
    workAreaIn: null,
    workAreaOut: null,
  };
}

export interface CreateClipOptions {
  readonly mediaId?: string | null;
  readonly nestedSequenceId?: string | null;
  readonly name?: string;
  readonly sourceIn?: number;
  readonly linkGroup?: string | null;
}

export function createClip(
  kind: ClipKind,
  trackId: string,
  start: number,
  duration: number,
  options: CreateClipOptions = {},
): ClipDoc {
  return {
    id: newClipId(),
    kind,
    mediaId: options.mediaId ?? null,
    nestedSequenceId: options.nestedSequenceId ?? null,
    trackId,
    name: options.name ?? '',
    start,
    duration,
    sourceIn: options.sourceIn ?? 0,
    speed: { n: 1, d: 1 },
    reverse: false,
    frameSampling: 'nearest',
    enabled: true,
    linkGroup: options.linkGroup ?? null,
    effects: [],
    transform: {
      position: { value: [0, 0], ...DEFAULT_PARAM },
      scale: { value: [100, 100], ...DEFAULT_PARAM },
      rotation: { value: 0, ...DEFAULT_PARAM },
      anchorPoint: { value: [0, 0], ...DEFAULT_PARAM },
    },
    opacity: { value: 100, ...DEFAULT_PARAM },
    blendMode: 'normal',
    audio: {
      gainDb: { value: 0, ...DEFAULT_PARAM },
      pan: { value: 0, ...DEFAULT_PARAM },
      channelMap: [],
    },
    label: null,
    markers: [],
  };
}

export function createProject(name: string, now = new Date()): ProjectDoc {
  const stamp = now.toISOString();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: newProjectId(),
    name,
    createdAt: stamp,
    modifiedAt: stamp,
    settings: { useProxies: false, scratchPath: null, defaultTimebase: null },
    media: [],
    bins: [
      { id: newBinId(), name: name, parentId: null, mediaIds: [], sequenceIds: [], label: null },
    ],
    sequences: [],
    activeSequenceId: null,
  };
}

/**
 * Presets de sequence (section 68).
 *
 * Chaque preset fixe la cadence, la definition et l espace de travail attendus
 * du format d acquisition correspondant.
 */
export interface SequencePreset {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly timebase: TimeBase;
  readonly settings: Partial<SequenceSettingsDoc>;
}

export const SEQUENCE_PRESETS: readonly SequencePreset[] = [
  {
    id: 'arri-uhd-25',
    label: 'ARRI UHD 25p',
    group: 'ARRI',
    timebase: TIMEBASES.TB25,
    settings: { width: 3840, height: 2160, workingColorSpace: 'rec709' },
  },
  {
    id: 'red-4k-23976',
    label: 'RED 4K 23.976p',
    group: 'RED',
    timebase: TIMEBASES.TB23_976,
    settings: { width: 4096, height: 2160, workingColorSpace: 'rec709' },
  },
  {
    id: 'blackmagic-uhd-24',
    label: 'Blackmagic UHD 24p',
    group: 'Blackmagic',
    timebase: TIMEBASES.TB24,
    settings: { width: 3840, height: 2160, workingColorSpace: 'rec709' },
  },
  {
    id: 'avchd-1080-25',
    label: 'AVCHD 1080p25',
    group: 'AVCHD',
    timebase: TIMEBASES.TB25,
    settings: { width: 1920, height: 1080 },
  },
  {
    id: 'dslr-1080-2997',
    label: 'DSLR 1080p29.97',
    group: 'DSLR',
    timebase: TIMEBASES.TB29_97_NDF,
    settings: { width: 1920, height: 1080 },
  },
  {
    id: 'digital-cinema-2k-24',
    label: 'Cinéma numérique 2K 24p',
    group: 'Digital Cinema',
    timebase: TIMEBASES.TB24,
    settings: { width: 2048, height: 1080, pixelAspect: { n: 1, d: 1 } },
  },
  {
    id: 'xdcam-1080i-2997',
    label: 'XDCAM 1080i29.97',
    group: 'XDCAM',
    timebase: TIMEBASES.TB29_97_DF,
    settings: { width: 1920, height: 1080, fieldOrder: 'tff' },
  },
  {
    id: 'broadcast-1080-25',
    label: 'Broadcast HD 1080p25',
    group: 'Broadcast',
    timebase: TIMEBASES.TB25,
    settings: { width: 1920, height: 1080 },
  },
] as const;

export function presetById(id: string): SequencePreset | undefined {
  return SEQUENCE_PRESETS.find((p) => p.id === id);
}

/** Identifiant neuf, pour les entites qui n ont pas de fabrique dediee. */
export const newId = uuid;
