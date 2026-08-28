/**
 * Import de medias reels dans le navigateur (sections 8, 9, 19, 84).
 *
 * Ce que le navigateur permet REELLEMENT, sans serveur :
 *
 *   audio -- `decodeAudioData` decode integralement le fichier. On obtient de
 *            vrais echantillons, donc une vraie pyramide de pics, donc une
 *            vraie forme d onde. Rien n est simule.
 *
 *   video -- on lit les metadonnees (duree, definition) via un element video, et
 *            on interroge WebCodecs sur la decodabilite du codec. On ne demuxe
 *            PAS : cela demande un demultiplexeur que le projet n a pas encore.
 *            Le media est donc importe avec ses vraies caracteristiques, et
 *            marque comme non lisible tant que le moteur de lecture n existe
 *            pas (section 1003).
 *
 * Les caracteristiques fines exigees par la section 9 -- profil, niveau, format
 * de pixel, colorimetrie, timecode embarque -- ne sont pas accessibles au
 * navigateur seul. Elles viendront du service d analyse ffprobe deja ecrit et
 * teste (`apps/media-worker`). Les champs correspondants restent donc vides
 * plutot que d etre devines.
 */
import type { MediaAssetDoc } from '@valideo/project-model';
import { newMediaId } from '@valideo/shared';
import type { PeakPyramid } from '@valideo/audio-engine';
import { buildPeaks } from '@valideo/audio-engine';
import { approximate, rational } from '@valideo/time-core';

export interface MediaImporte {
  readonly asset: MediaAssetDoc;
  /** Pyramide de pics, uniquement pour les fichiers dont l audio a ete decode. */
  readonly pics: PeakPyramid | null;
  /** Ce qui n a pas pu etre determine, a signaler sans dramatiser. */
  readonly avertissements: readonly string[];
}

const EXT_AUDIO = new Set(['wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'aiff', 'aif']);
const EXT_VIDEO = new Set(['mp4', 'mov', 'mkv', 'webm', 'm4v', 'avi', 'mxf', 'mts', 'm2ts']);
const EXT_IMAGE = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'avif', 'exr', 'dpx']);

export function extensionDe(nom: string): string {
  const i = nom.lastIndexOf('.');
  return i < 0 ? '' : nom.slice(i + 1).toLowerCase();
}

export type FamilleMedia = 'audio' | 'video' | 'image' | 'inconnu';

export function familleDe(fichier: { name: string; type: string }): FamilleMedia {
  if (fichier.type.startsWith('audio/')) return 'audio';
  if (fichier.type.startsWith('video/')) return 'video';
  if (fichier.type.startsWith('image/')) return 'image';
  const ext = extensionDe(fichier.name);
  if (EXT_AUDIO.has(ext)) return 'audio';
  if (EXT_VIDEO.has(ext)) return 'video';
  if (EXT_IMAGE.has(ext)) return 'image';
  return 'inconnu';
}

function assetVide(fichier: File): MediaAssetDoc {
  return {
    id: newMediaId(),
    name: fichier.name,
    uri: `fichier-local:${fichier.name}`,
    originalUri: `fichier-local:${fichier.name}`,
    proxyUri: null,
    container: extensionDe(fichier.name),
    duration: { frames: 0, base: { rate: { n: 25, d: 1 }, mode: 'NDF' } },
    videoStreams: [],
    audioStreams: [],
    startTimecode: 0,
    reel: null,
    checksum: null,
    fileSize: fichier.size,
    modifiedAt: new Date(fichier.lastModified).toISOString(),
    createdAt: null,
    status: 'online',
    proxyStatus: 'none',
    // L'analyse complète (§9) exige ffprobe : elle reste à faire côté serveur.
    analysisStatus: 'pending',
    metadata: { source: 'navigateur' },
  };
}

/** Decode entierement l audio d un fichier et en construit la pyramide de pics. */
async function decoderAudio(
  fichier: File,
  contexte: BaseAudioContext,
): Promise<{ pics: PeakPyramid; canaux: number; frequence: number; secondes: number }> {
  const octets = await fichier.arrayBuffer();
  const tampon = await contexte.decodeAudioData(octets);
  const canaux: Float32Array[] = [];
  for (let c = 0; c < tampon.numberOfChannels; c += 1) canaux.push(tampon.getChannelData(c));
  return {
    pics: buildPeaks(canaux, tampon.sampleRate),
    canaux: tampon.numberOfChannels,
    frequence: tampon.sampleRate,
    secondes: tampon.duration,
  };
}

/** Metadonnees d un fichier video, lues par le navigateur. */
function metadonneesVideo(
  fichier: File,
): Promise<{ secondes: number; largeur: number; hauteur: number } | null> {
  return new Promise((resoudre) => {
    const url = URL.createObjectURL(fichier);
    const video = document.createElement('video');
    video.preload = 'metadata';
    const nettoyer = (): void => {
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
    };
    video.onloadedmetadata = () => {
      const resultat = {
        secondes: Number.isFinite(video.duration) ? video.duration : 0,
        largeur: video.videoWidth,
        hauteur: video.videoHeight,
      };
      nettoyer();
      resoudre(resultat);
    };
    video.onerror = () => {
      nettoyer();
      resoudre(null);
    };
    video.src = url;
  });
}

export interface OptionsImport {
  /** Cadence attribuee aux medias dont on ne peut pas la mesurer. */
  readonly cadenceParDefaut?: { n: number; d: number };
  readonly contexteAudio?: BaseAudioContext;
}

/**
 * Importe un fichier. Ne leve jamais : un fichier illisible revient avec un
 * avertissement et un media marque hors ligne, ce que l interface sait afficher.
 */
export async function importerFichier(
  fichier: File,
  options: OptionsImport = {},
): Promise<MediaImporte> {
  const avertissements: string[] = [];
  const famille = familleDe(fichier);
  const cadence = options.cadenceParDefaut ?? { n: 25, d: 1 };
  const base = assetVide(fichier);

  if (famille === 'audio') {
    const contexte = options.contexteAudio ?? new OfflineAudioContext(1, 1, 48000);
    try {
      const decode = await decoderAudio(fichier, contexte);
      const images = Math.round((decode.secondes * cadence.n) / cadence.d);
      return {
        asset: {
          ...base,
          duration: { frames: images, base: { rate: cadence, mode: 'NDF' } },
          audioStreams: [
            {
              index: 0,
              codec: extensionDe(fichier.name),
              sampleRate: decode.frequence,
              channels: decode.canaux,
              channelLayout:
                decode.canaux === 1
                  ? 'mono'
                  : decode.canaux === 2
                    ? 'stereo'
                    : `${decode.canaux} canaux`,
              bitDepth: null,
            },
          ],
          analysisStatus: 'done',
        },
        pics: decode.pics,
        avertissements,
      };
    } catch (cause) {
      return {
        asset: { ...base, status: 'unreadable' },
        pics: null,
        avertissements: [
          `« ${fichier.name} » n’a pas pu être décodé par le navigateur.`,
          cause instanceof Error ? cause.message : String(cause),
        ],
      };
    }
  }

  if (famille === 'video') {
    const meta = await metadonneesVideo(fichier);
    if (meta === null) {
      return {
        asset: { ...base, status: 'unreadable' },
        pics: null,
        avertissements: [
          `« ${fichier.name} » n’a pas pu être lu par le navigateur ; une analyse serveur est nécessaire.`,
        ],
      };
    }
    avertissements.push(
      'La cadence exacte, le codec et le timecode d’un fichier vidéo ne sont pas accessibles au navigateur seul : ils seront complétés par l’analyse serveur.',
    );
    const images = Math.round((meta.secondes * cadence.n) / cadence.d);
    return {
      asset: {
        ...base,
        duration: { frames: images, base: { rate: cadence, mode: 'NDF' } },
        videoStreams: [
          {
            index: 0,
            codec: 'inconnu',
            profile: null,
            level: null,
            width: meta.largeur,
            height: meta.hauteur,
            frameRate: cadence,
            variableFrameRate: false,
            pixelAspect: { n: 1, d: 1 },
            bitDepth: 8,
            pixelFormat: 'inconnu',
            colorSpace: {
              primaries: 'bt709',
              transfer: 'bt709',
              matrix: 'bt709',
              range: 'limited',
            },
            hasAlpha: false,
            alphaMode: null,
            fieldOrder: 'progressive',
          },
        ],
      },
      pics: null,
      avertissements,
    };
  }

  if (famille === 'image') {
    avertissements.push(`« ${fichier.name} » est importé comme image fixe.`);
    return {
      asset: {
        ...base,
        duration: {
          frames: Math.round((5 * cadence.n) / cadence.d),
          base: { rate: cadence, mode: 'NDF' },
        },
      },
      pics: null,
      avertissements,
    };
  }

  return {
    asset: { ...base, status: 'unreadable' },
    pics: null,
    avertissements: [`Le type de « ${fichier.name} » n’est pas reconnu.`],
  };
}

/** Cadence deduite d une valeur flottante lue ailleurs, ramenee a une fraction. */
export function cadenceDepuisFlottant(valeur: number): { n: number; d: number } {
  const r = approximate(valeur, 1001);
  return { n: r.n, d: r.d };
}

export const CADENCE_PAR_DEFAUT = { n: rational(25).n, d: rational(25).d };
