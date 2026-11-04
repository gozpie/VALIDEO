/**
 * Image fixe présentée comme une source vidéo : le moniteur et les vignettes la lisent de la même
 * façon qu'un film, et elle donne la même image à toutes les positions.
 */
import type { InfosVideo, SourceVisuelle } from './video-source';

/** Largeur maximale gardée en mémoire : au-delà, le moniteur n'en montrerait rien de plus. */
const LARGEUR_MAX = 2560;

export class ImageFixe implements SourceVisuelle {
  private constructor(
    readonly infos: InfosVideo,
    private readonly bitmap: ImageBitmap,
  ) {}

  static async ouvrir(fichier: File, cadence: { n: number; d: number }): Promise<ImageFixe> {
    let bitmap = await createImageBitmap(fichier);
    if (bitmap.width > LARGEUR_MAX) {
      const reduite = await createImageBitmap(bitmap, {
        resizeWidth: LARGEUR_MAX,
        resizeHeight: Math.round((bitmap.height * LARGEUR_MAX) / bitmap.width),
        resizeQuality: 'high',
      });
      bitmap.close();
      bitmap = reduite;
    }
    return new ImageFixe(
      {
        codec: 'image',
        largeur: bitmap.width,
        hauteur: bitmap.height,
        cadence,
        nombreImages: 1,
        timescale: 1,
        decodable: true,
      },
      bitmap,
    );
  }

  imageA(): Promise<VideoFrame | null> {
    return Promise.resolve(new VideoFrame(this.bitmap, { timestamp: 0 }));
  }

  precharger(): Promise<void> {
    return Promise.resolve();
  }

  fermer(): void {
    this.bitmap.close();
  }
}
