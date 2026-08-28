/**
 * Vignettes de timeline (section 18).
 *
 * Deux exigences de la section 18, et elles se contredisent en apparence :
 * « afficher des vignettes » et « ne jamais decoder les images inutilement ».
 * La resolution tient en trois regles :
 *
 *   1. le rendu Canvas est SYNCHRONE : il ne peut dessiner qu une vignette deja
 *      prete. Une vignette absente n est pas attendue, elle est demandee et le
 *      clip est dessine sans elle ;
 *   2. les demandes sont dedupliquees et limitees en nombre simultane, sinon
 *      une timeline dense lancerait des centaines de decodages ;
 *   3. rien n est demande pendant la LECTURE : le decodeur y est deja occupe a
 *      tenir la cadence, et lui voler du temps ferait sauter des images.
 *
 * Les vignettes sont converties en `ImageBitmap`, bien plus economes qu une
 * `VideoFrame` conservee vivante : la `VideoFrame` est fermee aussitot.
 */
import type { VideoSource } from './video-source.js';

/** Hauteur de rendu des vignettes. La largeur suit le rapport de l image. */
const HAUTEUR = 48;
/** Nombre maximal de decodages de vignettes en cours. */
const SIMULTANEES = 2;

function cle(mediaId: string, secondes: number): string {
  // Arrondi au centieme : deux demandes a 1,002 s et 1,004 s ne doivent pas
  // produire deux decodages distincts.
  return `${mediaId}@${secondes.toFixed(2)}`;
}

export class CacheVignettes {
  private readonly images = new Map<string, ImageBitmap>();
  private readonly enCours = new Set<string>();
  private readonly echecs = new Set<string>();
  private actives = 0;
  private suspendu = false;

  constructor(
    private readonly capacite = 400,
    private readonly surPret: () => void = () => undefined,
  ) {}

  /** Suspend les demandes, typiquement pendant la lecture. */
  suspendre(valeur: boolean): void {
    this.suspendu = valeur;
  }

  /**
   * Vignette prete, ou `null`. Dans ce second cas la demande est lancee, et
   * `surPret` sera appele quand elle aboutira.
   */
  obtenir(mediaId: string, source: VideoSource, secondes: number): ImageBitmap | null {
    const k = cle(mediaId, secondes);
    const prete = this.images.get(k);
    if (prete !== undefined) return prete;
    if (this.suspendu || this.enCours.has(k) || this.echecs.has(k)) return null;
    if (this.actives >= SIMULTANEES) return null;
    void this.decoder(k, source, secondes);
    return null;
  }

  private async decoder(k: string, source: VideoSource, secondes: number): Promise<void> {
    this.enCours.add(k);
    this.actives += 1;
    try {
      const image = await source.imageA(secondes);
      if (image === null) {
        this.echecs.add(k);
        return;
      }
      const rapport = image.displayWidth / Math.max(1, image.displayHeight);
      const bitmap = await createImageBitmap(image, {
        resizeHeight: HAUTEUR,
        resizeWidth: Math.max(1, Math.round(HAUTEUR * rapport)),
        resizeQuality: 'low',
      });
      image.close();
      this.ranger(k, bitmap);
      this.surPret();
    } catch {
      this.echecs.add(k);
    } finally {
      this.enCours.delete(k);
      this.actives -= 1;
    }
  }

  private ranger(k: string, bitmap: ImageBitmap): void {
    this.images.set(k, bitmap);
    // Eviction des plus anciennes : `Map` conserve l ordre d insertion.
    while (this.images.size > this.capacite) {
      const premiere = this.images.keys().next();
      if (premiere.done === true) break;
      this.images.get(premiere.value)?.close();
      this.images.delete(premiere.value);
    }
  }

  /** Oublie ce qui concerne un media, par exemple apres sa suppression. */
  oublier(mediaId: string): void {
    for (const k of [...this.images.keys()]) {
      if (k.startsWith(`${mediaId}@`)) {
        this.images.get(k)?.close();
        this.images.delete(k);
      }
    }
  }

  etat(): { pretes: number; enCours: number; echecs: number } {
    return { pretes: this.images.size, enCours: this.enCours.size, echecs: this.echecs.size };
  }

  vider(): void {
    for (const bitmap of this.images.values()) bitmap.close();
    this.images.clear();
    this.echecs.clear();
  }
}
