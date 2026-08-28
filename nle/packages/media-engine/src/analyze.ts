/**
 * Analyse d un media : sortie ffprobe -> `MediaAssetDoc` (sections 8, 9, 72).
 *
 * Fonction PURE : elle ne lance aucun processus, ne touche pas au disque. Elle
 * est donc testable sur des sorties ffprobe enregistrees, et le lancement du
 * processus reste l affaire de `apps/media-worker`.
 */
import { newMediaId } from '@valideo/shared';
import type { AudioStreamDoc, MediaAssetDoc, VideoStreamDoc } from '@valideo/project-model';
import type { Rational, TimeBase } from '@valideo/time-core';
import {
  mul,
  rational,
  round,
  timebase,
  supportsDropFrame,
  parseTimecode,
  TimecodeError,
} from '@valideo/time-core';
import { colorInfo } from './color.js';
import { pixelFormatInfo } from './pixel-format.js';
import type { Probe, ProbeStream } from './probe.js';
import type { TimestampAnalysis } from './timestamps.js';

/** `"24000/1001"` -> fraction. `"0/0"` et les valeurs absurdes donnent `null`. */
export function parseFrameRate(text: string | undefined): Rational | null {
  if (text === undefined) return null;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (d === 0 || n === 0) return null;
  return rational(n, d);
}

/** `"1:1"`, `"64:45"` -> fraction. Un ratio nul est traite comme carre. */
export function parseAspect(text: string | undefined): Rational {
  if (text === undefined) return rational(1);
  const m = /^(\d+)\s*[:/]\s*(\d+)$/.exec(text.trim());
  if (m === null) return rational(1);
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (n === 0 || d === 0) return rational(1);
  return rational(n, d);
}

function fieldOrderOf(value: string | undefined): 'progressive' | 'tff' | 'bff' {
  const v = (value ?? '').toLowerCase();
  if (v === 'tt' || v === 'tb' || v === 'top' || v === 'tff') return 'tff';
  if (v === 'bb' || v === 'bt' || v === 'bottom' || v === 'bff') return 'bff';
  return 'progressive';
}

function profileOf(stream: ProbeStream): string | null {
  const p = stream.profile;
  if (p === undefined) return null;
  return typeof p === 'number' ? String(p) : p;
}

function levelOf(stream: ProbeStream): string | null {
  // ffprobe met -99 pour « sans objet » (ProRes, DNxHR...).
  if (stream.level === undefined || stream.level < 0) return null;
  return String(stream.level);
}

function intOf(text: string | undefined): number | null {
  if (text === undefined) return null;
  const v = Number(text);
  return Number.isFinite(v) ? Math.trunc(v) : null;
}

function floatOf(text: string | undefined): number | null {
  if (text === undefined) return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : null;
}

/**
 * Duree en secondes -> nombre d images, en repassant par une fraction exacte.
 * La duree lue est un flottant : on la ramene a la microseconde pres, puis tout
 * le reste du calcul est entier.
 */
function framesFromSeconds(seconds: number, rate: Rational): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const micros = Math.trunc(seconds * 1_000_000);
  return round(mul(rational(micros, 1_000_000), rate));
}

export function toVideoStream(stream: ProbeStream, timestamps?: TimestampAnalysis): VideoStreamDoc {
  const pixelFormat = pixelFormatInfo(stream.pix_fmt ?? 'yuv420p');
  const declared = parseFrameRate(stream.r_frame_rate) ?? parseFrameRate(stream.avg_frame_rate);

  // La cadence DECLAREE fait foi quand elle l est. Elle est exacte -- 24000/1001
  // -- alors qu une cadence reconstruite depuis des horodatages quantifies au
  // millieme donnerait une fraction absurde du genre 12250000/10427.
  // La mesure ne sert qu a DETECTER la variabilite, et a fournir une cadence
  // moyenne quand le media est effectivement a cadence variable (section 13).
  const rate =
    timestamps?.variable === true && timestamps.averageRate.n > 0
      ? timestamps.averageRate
      : (declared ?? rational(25));
  const color = colorInfo(
    stream.color_primaries,
    stream.color_transfer,
    stream.color_space,
    stream.color_range,
  );

  // La profondeur declaree par le codec prime sur celle deduite du format de
  // pixel : `bits_per_raw_sample` est la verite du flux.
  const declaredDepth = intOf(stream.bits_per_raw_sample);

  return {
    index: stream.index,
    codec: stream.codec_name ?? 'unknown',
    profile: profileOf(stream),
    level: levelOf(stream),
    width: stream.width ?? stream.coded_width ?? 0,
    height: stream.height ?? stream.coded_height ?? 0,
    frameRate: { n: rate.n, d: rate.d },
    variableFrameRate: timestamps?.variable ?? false,
    pixelAspect: (() => {
      const a = parseAspect(stream.sample_aspect_ratio);
      return { n: a.n, d: a.d };
    })(),
    bitDepth: declaredDepth !== null && declaredDepth > 0 ? declaredDepth : pixelFormat.bitDepth,
    pixelFormat: pixelFormat.name,
    colorSpace: {
      primaries: color.primaries,
      transfer: color.transfer,
      matrix: color.matrix,
      range: color.range,
    },
    hasAlpha: pixelFormat.hasAlpha,
    // Sans indication du conteneur, on n invente pas : l alpha d un ProRes 4444
    // est droit, mais le dire pour tous les formats serait faux.
    alphaMode: pixelFormat.hasAlpha ? 'straight' : null,
    fieldOrder: fieldOrderOf(stream.field_order),
  };
}

export function toAudioStream(stream: ProbeStream): AudioStreamDoc {
  return {
    index: stream.index,
    codec: stream.codec_name ?? 'unknown',
    sampleRate: intOf(stream.sample_rate) ?? 48000,
    channels: stream.channels ?? 2,
    channelLayout: stream.channel_layout ?? (stream.channels === 1 ? 'mono' : 'stereo'),
    bitDepth: intOf(stream.bits_per_raw_sample) ?? stream.bits_per_sample ?? null,
  };
}

/**
 * Timecode embarque -> numero d image.
 *
 * Le point-virgule dans `01:00:00;00` signale le drop-frame. On ne l applique
 * que si la cadence l autorise reellement : un `;` sur du 25 images/s est une
 * incoherence du fichier, pas une instruction.
 */
export function parseEmbeddedTimecode(text: string | undefined, rate: Rational): number {
  if (text === undefined || text.trim() === '') return 0;
  const dropFrame = text.includes(';') && supportsDropFrame(rate);
  try {
    return parseTimecode(text, timebase(rate, dropFrame ? 'DF' : 'NDF'));
  } catch (cause) {
    if (cause instanceof TimecodeError) return 0;
    throw cause;
  }
}

function firstTag(probe: Probe, key: string): string | undefined {
  for (const stream of probe.streams) {
    const value = stream.tags?.[key];
    if (value !== undefined && value !== '') return value;
  }
  return probe.format.tags?.[key];
}

export interface AnalyzeOptions {
  readonly uri: string;
  readonly name?: string;
  readonly originalUri?: string;
  readonly fileSize?: number | null;
  readonly checksum?: string | null;
  readonly modifiedAt?: string | null;
  /** Analyse des horodatages, quand elle a ete faite (section 13). */
  readonly timestamps?: TimestampAnalysis;
}

export interface MediaAnalysis {
  readonly asset: MediaAssetDoc;
  /** Points qui meritent d etre signales a l utilisateur sans etre des erreurs. */
  readonly warnings: readonly string[];
}

/** Construit un `MediaAssetDoc` complet a partir d une sortie ffprobe. */
export function analyzeMedia(probe: Probe, options: AnalyzeOptions): MediaAnalysis {
  const warnings: string[] = [];

  const videoProbes = probe.streams.filter((s) => s.codec_type === 'video');
  const audioProbes = probe.streams.filter((s) => s.codec_type === 'audio');

  const videoStreams = videoProbes.map((s, i) =>
    toVideoStream(s, i === 0 ? options.timestamps : undefined),
  );
  const audioStreams = audioProbes.map(toAudioStream);

  const primaryVideo = videoStreams[0];

  // Cadence de reference du media : celle de sa premiere piste video, sinon une
  // cadence nominale pour un media purement sonore.
  const rate: Rational =
    primaryVideo === undefined
      ? rational(25)
      : rational(primaryVideo.frameRate.n, primaryVideo.frameRate.d);

  const timecodeText = firstTag(probe, 'timecode');
  const dropFrame =
    timecodeText !== undefined && timecodeText.includes(';') && supportsDropFrame(rate);
  if (timecodeText !== undefined && timecodeText.includes(';') && !dropFrame) {
    warnings.push(
      `Le timecode « ${timecodeText} » est noté drop-frame alors que la cadence ne le permet pas ; lu en non drop-frame.`,
    );
  }
  const base: TimeBase = timebase(rate, dropFrame ? 'DF' : 'NDF');

  // Duree en images : le nombre d images annonce fait foi ; a defaut on convertit
  // la duree en secondes, ce qui est moins sur mais reste exact au rationnel pres.
  const durationSeconds =
    floatOf(probe.format.duration) ??
    floatOf(videoProbes[0]?.duration) ??
    floatOf(audioProbes[0]?.duration) ??
    0;
  const declaredFrames = intOf(videoProbes[0]?.nb_frames);
  // Ordre de confiance pour la duree :
  //   1. le nombre d images annonce par le conteneur, quand il existe ;
  //   2. la duree en secondes convertie a la cadence ;
  //   3. le comptage d horodatages, et SEULEMENT s il a couvert tout le
  //      fichier -- l analyse de cadence variable ne lit qu une fenetre de
  //      tete, prendre son comptage pour une duree tronquerait tout media plus
  //      long que cette fenetre.
  const parHorodatages =
    options.timestamps !== undefined &&
    options.timestamps.complet &&
    options.timestamps.frameCount > 0
      ? options.timestamps.frameCount
      : null;
  const parDuree = framesFromSeconds(durationSeconds, rate);
  const frames = declaredFrames ?? (parDuree > 0 ? parDuree : (parHorodatages ?? 0));

  if (primaryVideo?.variableFrameRate === true) {
    warnings.push(
      'Ce média est à cadence variable. Le montage utilisera la cadence moyenne ; un conform en cadence constante est recommandé.',
    );
  }
  if (options.timestamps?.duplicateTimestamps === true) {
    warnings.push('Plusieurs images de ce média portent le même horodatage.');
  }
  if (videoStreams.length === 0 && audioStreams.length === 0) {
    warnings.push("Aucune piste vidéo ni audio exploitable n'a été trouvée.");
  }

  const container = (probe.format.format_name ?? '').split(',')[0] ?? '';

  const asset: MediaAssetDoc = {
    id: newMediaId(),
    name: options.name ?? options.uri.split('/').pop() ?? options.uri,
    uri: options.uri,
    originalUri: options.originalUri ?? options.uri,
    proxyUri: null,
    container,
    duration: {
      frames: Math.max(0, frames),
      base: { rate: { n: base.rate.n, d: base.rate.d }, mode: base.mode },
    },
    videoStreams,
    audioStreams,
    startTimecode: parseEmbeddedTimecode(timecodeText, rate),
    reel: firstTag(probe, 'reel_name') ?? null,
    checksum: options.checksum ?? null,
    fileSize: options.fileSize ?? intOf(probe.format.size),
    modifiedAt: options.modifiedAt ?? null,
    createdAt: firstTag(probe, 'creation_time') ?? null,
    status: 'online',
    proxyStatus: 'none',
    analysisStatus: 'done',
    metadata: { ...probe.format.tags },
  };

  return { asset, warnings };
}

/** Vrai si aucun navigateur ne saura decoder ce media sans proxy (sections 10, 60). */
export function requiresProxy(asset: MediaAssetDoc): boolean {
  const decodable = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1']);
  return asset.videoStreams.some((s) => !decodable.has(s.codec));
}
