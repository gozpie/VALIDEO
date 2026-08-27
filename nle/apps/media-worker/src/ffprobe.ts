/**
 * Execution de ffprobe (sections 9, 13).
 *
 * Seul module du projet qui lance un processus. Tout ce qui suit -- lecture,
 * interpretation, construction du `MediaAssetDoc` -- est pur et vit dans
 * `@valideo/media-engine`, donc testable sans ffmpeg.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import type { MediaAnalysis, Probe, TimestampAnalysis } from '@valideo/media-engine';
import { analyzeMedia, analyzeTimestamps, parseProbe } from '@valideo/media-engine';
import type { Rational } from '@valideo/time-core';
import { rational } from '@valideo/time-core';

const run = promisify(execFile);

export interface ProbeOptions {
  readonly ffprobePath?: string;
  /**
   * Nombre d images dont on lit l horodatage pour detecter une cadence variable.
   * Lire un fichier entier serait ruineux ; un echantillon de tete suffit a
   * reperer une cadence variable, qui l est des le debut dans la pratique.
   */
  readonly timestampSampleFrames?: number;
  /** Desactive l analyse des horodatages (plus rapide, mais aveugle au VFR). */
  readonly skipTimestamps?: boolean;
}

function toolMissing(tool: string, cause: unknown): AppError {
  return appError('MEDIA_UNREADABLE', `${tool} est introuvable sur ce serveur.`, {
    action: 'Installer FFmpeg',
    detail: cause instanceof Error ? cause.message : String(cause),
  });
}

function unreadable(path: string, cause: unknown): AppError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return appError('MEDIA_UNREADABLE', `Ce fichier n'a pas pu être analysé.`, {
    action: 'Vérifier le fichier',
    detail: `${path} — ${detail.split('\n').slice(-3).join(' ').trim()}`,
    retryable: false,
  });
}

/** Sortie JSON brute de ffprobe, validee. */
export async function probeFile(
  path: string,
  options: ProbeOptions = {},
): Promise<Result<Probe, AppError>> {
  const bin = options.ffprobePath ?? 'ffprobe';
  let stdout: string;
  try {
    const result = await run(
      bin,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (cause) {
    if (
      cause !== null &&
      typeof cause === 'object' &&
      (cause as { code?: string }).code === 'ENOENT'
    ) {
      return err(toolMissing(bin, cause));
    }
    return err(unreadable(path, cause));
  }

  try {
    return ok(parseProbe(JSON.parse(stdout)));
  } catch (cause) {
    return err(unreadable(path, cause));
  }
}

/**
 * Mesure les ecarts reels entre horodatages d images.
 *
 * C est ce qui distingue une cadence reellement constante d une cadence
 * declaree constante (section 13) : un fichier a cadence variable peut annoncer
 * « 30/1 » au niveau du flux.
 */
export async function probeTimestamps(
  path: string,
  timeBase: Rational,
  options: ProbeOptions = {},
): Promise<Result<TimestampAnalysis, AppError>> {
  const bin = options.ffprobePath ?? 'ffprobe';
  const limit = options.timestampSampleFrames ?? 600;
  try {
    const { stdout } = await run(
      bin,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-read_intervals',
        `%+#${limit}`,
        '-show_entries',
        'frame=pts_time',
        '-of',
        'csv=p=0',
        path,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );

    const times: number[] = [];
    for (const line of stdout.split('\n')) {
      const text = line.trim().replace(/,+$/, '');
      // Ne PAS se contenter de Number.isFinite : Number('') vaut 0, donc une
      // ligne vide de fin de sortie deviendrait un horodatage 0 fantome, qui
      // ferait passer un fichier a cadence constante pour du VFR.
      if (text === '' || text === 'N/A') continue;
      const value = Number(text);
      if (Number.isFinite(value)) times.push(value);
    }
    return ok(analyzeTimestamps(times, timeBase));
  } catch (cause) {
    if (
      cause !== null &&
      typeof cause === 'object' &&
      (cause as { code?: string }).code === 'ENOENT'
    ) {
      return err(toolMissing(bin, cause));
    }
    return err(unreadable(path, cause));
  }
}

function parseTimeBase(text: string | undefined): Rational {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec((text ?? '').trim());
  if (m === null) return rational(1, 1000);
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (n === 0 || d === 0) return rational(1, 1000);
  return rational(n, d);
}

/** Analyse complete d un fichier : ffprobe, horodatages, puis mise en modele. */
export async function analyzeFile(
  path: string,
  options: ProbeOptions = {},
): Promise<Result<MediaAnalysis, AppError>> {
  const probe = await probeFile(path, options);
  if (!probe.ok) return probe;

  let size: number | null = null;
  let modifiedAt: string | null = null;
  try {
    const info = await stat(path);
    size = info.size;
    modifiedAt = info.mtime.toISOString();
  } catch {
    // Un fichier distant ou monte peut ne pas exposer ces informations ;
    // ce n est pas une raison de refuser l analyse.
  }

  const videoStream = probe.value.streams.find((s) => s.codec_type === 'video');
  let timestamps: TimestampAnalysis | undefined;
  if (options.skipTimestamps !== true && videoStream !== undefined) {
    const measured = await probeTimestamps(path, parseTimeBase(videoStream.time_base), options);
    if (measured.ok) timestamps = measured.value;
  }

  return ok(
    analyzeMedia(probe.value, {
      uri: path,
      fileSize: size,
      modifiedAt,
      ...(timestamps === undefined ? {} : { timestamps }),
    }),
  );
}

/** Vrai si ffprobe est utilisable ici. Sert a degrader proprement (section 60). */
export async function ffprobeAvailable(ffprobePath = 'ffprobe'): Promise<boolean> {
  try {
    await run(ffprobePath, ['-version']);
    return true;
  } catch {
    return false;
  }
}
