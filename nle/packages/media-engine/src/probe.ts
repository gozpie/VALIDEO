/**
 * Lecture de la sortie JSON de ffprobe.
 *
 * FRONTIERE : c est ici qu on accepte des donnees exterieures. ffprobe est
 * tolerant et omet volontiers des champs selon le conteneur ; le schema reflete
 * cette realite (presque tout est optionnel) plutot que de supposer une forme
 * ideale qui ferait planter l analyse sur un fichier reel.
 */
import { z } from 'zod';

export const ProbeStreamSchema = z
  .object({
    index: z.number().int(),
    codec_name: z.string().optional(),
    codec_long_name: z.string().optional(),
    codec_type: z.string().optional(),
    profile: z.union([z.string(), z.number()]).optional(),
    level: z.number().optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    coded_width: z.number().int().optional(),
    coded_height: z.number().int().optional(),
    pix_fmt: z.string().optional(),
    sample_aspect_ratio: z.string().optional(),
    display_aspect_ratio: z.string().optional(),
    field_order: z.string().optional(),
    r_frame_rate: z.string().optional(),
    avg_frame_rate: z.string().optional(),
    time_base: z.string().optional(),
    start_time: z.string().optional(),
    duration: z.string().optional(),
    duration_ts: z.number().optional(),
    nb_frames: z.string().optional(),
    bits_per_raw_sample: z.string().optional(),
    bits_per_sample: z.number().optional(),
    sample_rate: z.string().optional(),
    channels: z.number().int().optional(),
    channel_layout: z.string().optional(),
    color_primaries: z.string().optional(),
    color_transfer: z.string().optional(),
    color_space: z.string().optional(),
    color_range: z.string().optional(),
    tags: z.record(z.string()).optional(),
  })
  .passthrough();

export const ProbeFormatSchema = z
  .object({
    filename: z.string().optional(),
    nb_streams: z.number().int().optional(),
    format_name: z.string().optional(),
    format_long_name: z.string().optional(),
    duration: z.string().optional(),
    size: z.string().optional(),
    bit_rate: z.string().optional(),
    tags: z.record(z.string()).optional(),
  })
  .passthrough();

export const ProbeSchema = z.object({
  streams: z.array(ProbeStreamSchema).default([]),
  format: ProbeFormatSchema.default({}),
});

export type ProbeStream = z.infer<typeof ProbeStreamSchema>;
export type ProbeFormat = z.infer<typeof ProbeFormatSchema>;
export type Probe = z.infer<typeof ProbeSchema>;

export function parseProbe(raw: unknown): Probe {
  return ProbeSchema.parse(raw);
}
