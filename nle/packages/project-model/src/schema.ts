/**
 * Schema de projet, version 1 (sections 45, 71, 72).
 *
 * Regles :
 *   - le document est du JSON pur, jamais du state d interface (section 45) ;
 *   - toutes les positions et durees sont des ENTIERS d images ;
 *   - toutes les cadences et ratios sont des fractions {n, d} ;
 *   - le document est valide a la lecture, avec un chemin d erreur precis.
 *
 * Ce fichier est une FRONTIERE : c est le seul endroit ou l on accepte des
 * donnees venues du disque ou du reseau. Tout ce qui passe cette porte est
 * ensuite considere comme structurellement sain par le moteur.
 */
import { z } from 'zod';

export const PROJECT_SCHEMA_VERSION = 1;

const int = z.number().int();
const nonNegInt = int.min(0);
const positiveInt = int.min(1);
const uuidString = z.string().uuid();

/** Fraction exacte. Denominateur strictement positif. */
export const RationalSchema = z.object({
  n: int,
  d: positiveInt,
});

export const TimeBaseSchema = z.object({
  rate: RationalSchema,
  mode: z.enum(['NDF', 'DF']),
});

// ---------------------------------------------------------------- Media (§72)

export const ColorSpaceSchema = z.object({
  primaries: z.string().default('bt709'),
  transfer: z.string().default('bt709'),
  matrix: z.string().default('bt709'),
  range: z.enum(['limited', 'full']).default('limited'),
});

export const VideoStreamSchema = z.object({
  index: nonNegInt,
  codec: z.string(),
  profile: z.string().nullable().default(null),
  level: z.string().nullable().default(null),
  width: positiveInt,
  height: positiveInt,
  /** Cadence moyenne. Pour un media VFR c est une moyenne, pas une verite. */
  frameRate: RationalSchema,
  /** Vrai si le conteneur declare une cadence variable (section 13). */
  variableFrameRate: z.boolean().default(false),
  pixelAspect: RationalSchema.default({ n: 1, d: 1 }),
  bitDepth: positiveInt.default(8),
  pixelFormat: z.string().default('yuv420p'),
  colorSpace: ColorSpaceSchema.default({}),
  hasAlpha: z.boolean().default(false),
  alphaMode: z.enum(['straight', 'premultiplied']).nullable().default(null),
  fieldOrder: z.enum(['progressive', 'tff', 'bff']).default('progressive'),
});

export const AudioStreamSchema = z.object({
  index: nonNegInt,
  codec: z.string(),
  sampleRate: positiveInt,
  channels: positiveInt,
  channelLayout: z.string().default('stereo'),
  bitDepth: positiveInt.nullable().default(null),
});

/** Etat de disponibilite du media (section 8). */
export const MediaStatusSchema = z.enum(['online', 'offline', 'missing', 'unreadable']);
export const ProxyStatusSchema = z.enum(['none', 'queued', 'generating', 'ready', 'failed']);
export const AnalysisStatusSchema = z.enum(['pending', 'analyzing', 'done', 'failed']);

export const MediaAssetSchema = z.object({
  id: uuidString,
  name: z.string(),
  uri: z.string(),
  /** Chemin d origine a l ingestion, conserve meme apres deplacement (section 8). */
  originalUri: z.string(),
  proxyUri: z.string().nullable().default(null),
  container: z.string().default(''),
  /** Duree exprimee dans la cadence du media lui-meme. */
  duration: z.object({ frames: nonNegInt, base: TimeBaseSchema }),
  videoStreams: z.array(VideoStreamSchema).default([]),
  audioStreams: z.array(AudioStreamSchema).default([]),
  /** Timecode de depart embarque, en images sur la cadence du media. */
  startTimecode: int.default(0),
  reel: z.string().nullable().default(null),
  checksum: z.string().nullable().default(null),
  fileSize: nonNegInt.nullable().default(null),
  modifiedAt: z.string().nullable().default(null),
  createdAt: z.string().nullable().default(null),
  status: MediaStatusSchema.default('online'),
  proxyStatus: ProxyStatusSchema.default('none'),
  analysisStatus: AnalysisStatusSchema.default('pending'),
  metadata: z.record(z.string()).default({}),
});

// ----------------------------------------------------------------- Bins (§7)

export const BinSchema = z.object({
  id: uuidString,
  name: z.string(),
  parentId: uuidString.nullable().default(null),
  mediaIds: z.array(uuidString).default([]),
  sequenceIds: z.array(uuidString).default([]),
  label: z.string().nullable().default(null),
});

// ------------------------------------------------------ Effets et keyframes

export const InterpolationSchema = z.enum([
  'linear',
  'bezier',
  'continuousBezier',
  'hold',
  'easeIn',
  'easeOut',
  'easeInOut',
]);

export const KeyframeSchema = z.object({
  id: uuidString,
  /** Position en images, relative au DEBUT DU CLIP (pas de la sequence). */
  time: int,
  value: z.union([z.number(), z.array(z.number())]),
  interpolation: InterpolationSchema.default('linear'),
  /** Poignees Bezier, en unites normalisees. */
  inHandle: z.tuple([z.number(), z.number()]).nullable().default(null),
  outHandle: z.tuple([z.number(), z.number()]).nullable().default(null),
});

export const ParameterSchema = z.object({
  /** Valeur constante, utilisee quand il n y a aucun keyframe. */
  value: z.union([z.number(), z.array(z.number()), z.string(), z.boolean()]),
  keyframes: z.array(KeyframeSchema).default([]),
});

export const EffectSchema = z.object({
  id: uuidString,
  /** Identifiant du type d effet dans le registre : "blur.gaussian". */
  type: z.string(),
  enabled: z.boolean().default(true),
  parameters: z.record(ParameterSchema).default({}),
});

// ----------------------------------------------------------- Clips (§15, §71)

export const ClipKindSchema = z.enum([
  'video',
  'audio',
  'image',
  'imageSequence',
  'nestedSequence',
  'adjustmentLayer',
  'title',
  'graphic',
  'caption',
  'colorMatte',
  'transparentVideo',
  'generator',
  'multicam',
]);

export const BlendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'colorDodge',
  'colorBurn',
  'hardLight',
  'softLight',
  'difference',
  'exclusion',
]);

export const TransformSchema = z.object({
  position: ParameterSchema.default({ value: [0, 0], keyframes: [] }),
  scale: ParameterSchema.default({ value: [100, 100], keyframes: [] }),
  rotation: ParameterSchema.default({ value: 0, keyframes: [] }),
  anchorPoint: ParameterSchema.default({ value: [0, 0], keyframes: [] }),
});

export const ClipAudioSchema = z.object({
  gainDb: ParameterSchema.default({ value: 0, keyframes: [] }),
  pan: ParameterSchema.default({ value: 0, keyframes: [] }),
  /** Correspondance canal source -> canal de piste. */
  channelMap: z.array(nonNegInt).default([]),
});

export const ClipSchema = z.object({
  id: uuidString,
  kind: ClipKindSchema,
  /** Null pour les clips synthetiques (titre, cache couleur, calque d effet). */
  mediaId: uuidString.nullable().default(null),
  /** Pour kind === 'nestedSequence'. */
  nestedSequenceId: uuidString.nullable().default(null),
  trackId: uuidString,
  name: z.string().default(''),

  /** Position sur la timeline, en images de la SEQUENCE. */
  start: int,
  /** Duree sur la timeline, en images de la SEQUENCE. Toujours >= 1. */
  duration: positiveInt,
  /** Point d entree dans la source, en images de la cadence de la SOURCE. */
  sourceIn: int,

  /**
   * Vitesse de lecture. 1/1 = 100 %. Le point de sortie source n est PAS
   * stocke : il se derive de sourceIn, duration et speed. Voir ADR-006.
   */
  speed: RationalSchema.default({ n: 1, d: 1 }),
  reverse: z.boolean().default(false),
  /** Interpolation temporelle quand speed != 1 (section 38). */
  frameSampling: z.enum(['nearest', 'blend', 'opticalFlow']).default('nearest'),

  enabled: z.boolean().default(true),
  /** Clips lies audio/video : meme identifiant de groupe (section 80). */
  linkGroup: uuidString.nullable().default(null),

  effects: z.array(EffectSchema).default([]),
  transform: TransformSchema.default({}),
  opacity: ParameterSchema.default({ value: 100, keyframes: [] }),
  blendMode: BlendModeSchema.default('normal'),
  audio: ClipAudioSchema.default({}),
  label: z.string().nullable().default(null),
  markers: z.array(z.string().uuid()).default([]),
});

// ---------------------------------------------------------------- Transitions

export const TransitionSchema = z.object({
  id: uuidString,
  type: z.string(),
  trackId: uuidString,
  /** Debut sur la timeline, en images de la sequence. */
  start: int,
  duration: positiveInt,
  /** Clip sortant et clip entrant. L un des deux peut manquer en bord de piste. */
  fromClipId: uuidString.nullable().default(null),
  toClipId: uuidString.nullable().default(null),
  alignment: z.enum(['centered', 'startOnCut', 'endOnCut', 'custom']).default('centered'),
  parameters: z.record(ParameterSchema).default({}),
});

// -------------------------------------------------------------- Marqueurs (§41)

export const MarkerSchema = z.object({
  id: uuidString,
  name: z.string().default(''),
  comment: z.string().default(''),
  color: z.string().default('#f0c040'),
  /** Position en images, dans le referentiel du proprietaire du marqueur. */
  time: int,
  duration: nonNegInt.default(0),
  type: z.enum(['comment', 'chapter', 'segment', 'web', 'cue']).default('comment'),
});

// ------------------------------------------------------------- Pistes (§14)

export const TrackKindSchema = z.enum(['video', 'audio']);

export const TrackSchema = z.object({
  id: uuidString,
  kind: TrackKindSchema,
  name: z.string().default(''),
  /** Rang dans la pile : V1 = 0, V2 = 1. Doit etre unique par type. */
  index: nonNegInt,
  locked: z.boolean().default(false),
  /** Video : visible. Audio : non muet. */
  enabled: z.boolean().default(true),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  syncLock: z.boolean().default(true),
  targeted: z.boolean().default(false),
  height: positiveInt.default(60),
  /** Nombre de canaux pour une piste audio. */
  channels: positiveInt.default(2),
  clips: z.array(ClipSchema).default([]),
  transitions: z.array(TransitionSchema).default([]),
});

// ---------------------------------------------------------- Sequences (§69)

export const SequenceSettingsSchema = z.object({
  width: positiveInt,
  height: positiveInt,
  pixelAspect: RationalSchema.default({ n: 1, d: 1 }),
  fieldOrder: z.enum(['progressive', 'tff', 'bff']).default('progressive'),
  audioSampleRate: positiveInt.default(48000),
  audioChannels: positiveInt.default(2),
  workingColorSpace: z.string().default('rec709'),
  previewFormat: z.string().default('h264'),
  displayFormat: z.enum(['timecode', 'frames', 'feetFrames']).default('timecode'),
});

export const SequenceSchema = z.object({
  id: uuidString,
  name: z.string(),
  timebase: TimeBaseSchema,
  settings: SequenceSettingsSchema,
  /** Timecode de depart, en images. 0 ou souvent 01:00:00:00 en broadcast. */
  startTimecode: int.default(0),
  tracks: z.array(TrackSchema).default([]),
  markers: z.array(MarkerSchema).default([]),
  /** Points d entree et de sortie de la zone de travail. */
  workAreaIn: int.nullable().default(null),
  workAreaOut: int.nullable().default(null),
});

// ---------------------------------------------------------------- Projet (§45)

export const ProjectSettingsSchema = z.object({
  /** Lecture sur proxies plutot que sur les masters (section 11). */
  useProxies: z.boolean().default(false),
  scratchPath: z.string().nullable().default(null),
  defaultTimebase: TimeBaseSchema.nullable().default(null),
});

export const ProjectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: uuidString,
  name: z.string(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  settings: ProjectSettingsSchema.default({}),
  media: z.array(MediaAssetSchema).default([]),
  bins: z.array(BinSchema).default([]),
  sequences: z.array(SequenceSchema).default([]),
  /** Sequence ouverte au dernier enregistrement. Confort, pas de la donnee metier. */
  activeSequenceId: uuidString.nullable().default(null),
});

export type RationalDoc = z.infer<typeof RationalSchema>;
export type TimeBaseDoc = z.infer<typeof TimeBaseSchema>;
export type VideoStreamDoc = z.infer<typeof VideoStreamSchema>;
export type AudioStreamDoc = z.infer<typeof AudioStreamSchema>;
export type MediaAssetDoc = z.infer<typeof MediaAssetSchema>;
export type BinDoc = z.infer<typeof BinSchema>;
export type KeyframeDoc = z.infer<typeof KeyframeSchema>;
export type ParameterDoc = z.infer<typeof ParameterSchema>;
export type EffectDoc = z.infer<typeof EffectSchema>;
export type ClipDoc = z.infer<typeof ClipSchema>;
export type ClipKind = z.infer<typeof ClipKindSchema>;
export type TransitionDoc = z.infer<typeof TransitionSchema>;
export type MarkerDoc = z.infer<typeof MarkerSchema>;
export type TrackDoc = z.infer<typeof TrackSchema>;
export type TrackKind = z.infer<typeof TrackKindSchema>;
export type SequenceDoc = z.infer<typeof SequenceSchema>;
export type SequenceSettingsDoc = z.infer<typeof SequenceSettingsSchema>;
export type ProjectDoc = z.infer<typeof ProjectSchema>;
