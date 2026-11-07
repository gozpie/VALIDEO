/**
 * Vidéo grise du plateau, enregistrée dans le navigateur : la vue caméra est rejouée image par
 * image, sans serveur de rendu. Elle sert de vidéo de référence au générateur, qui reprend alors le
 * mouvement de caméra et les places du plateau.
 */

/** Format accepté par l'enregistreur : MP4 quand le navigateur sait l'écrire, WebM sinon. */
export function formatVideo(
  accepte: (type: string) => boolean,
): { type: string; extension: string } | null {
  for (const type of ['video/mp4;codecs=avc1.42E01E', 'video/mp4']) {
    if (accepte(type)) return { type, extension: 'mp4' };
  }
  for (const type of ['video/webm;codecs=vp9', 'video/webm']) {
    if (accepte(type)) return { type, extension: 'webm' };
  }
  return null;
}

/** Dimensions de la vidéo : celles du rendu, ramenées à `maxLargeur` et à des valeurs paires. */
export function dimensions(
  largeur: number,
  hauteur: number,
  maxLargeur = 1280,
): { largeur: number; hauteur: number } {
  const echelle = Math.min(1, maxLargeur / largeur);
  const pair = (v: number) => Math.max(2, Math.round((v * echelle) / 2) * 2);
  return { largeur: pair(largeur), hauteur: pair(hauteur) };
}

interface Options {
  /** Canvas WebGL de la vue caméra (créé avec `preserveDrawingBuffer`). */
  source: HTMLCanvasElement;
  frames: number;
  fps: number;
  largeur: number;
  hauteur: number;
  /** Place la tête de lecture ; la vue se redessine à l'image suivante du navigateur. */
  allerA: (frame: number) => void;
  onProgres?: (frame: number) => void;
  signal?: AbortSignal;
}

const imageSuivante = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Rejoue les frames au rythme du plan et les enregistre. Le rythme réel compte : l'enregistreur
 * date chaque image à son arrivée, la durée de la vidéo est donc celle du plan.
 */
export async function enregistrerVueCamera(options: Options): Promise<Blob> {
  const format = formatVideo((type) => MediaRecorder.isTypeSupported(type));
  if (!format) throw new Error('Ce navigateur ne sait pas enregistrer de vidéo');
  const toile = document.createElement('canvas');
  toile.width = options.largeur;
  toile.height = options.hauteur;
  const contexte = toile.getContext('2d');
  if (!contexte) throw new Error('Canvas 2D indisponible');
  const flux = toile.captureStream(0);
  const piste = flux.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const enregistreur = new MediaRecorder(flux, {
    mimeType: format.type,
    videoBitsPerSecond: 8_000_000,
  });
  const morceaux: Blob[] = [];
  enregistreur.ondataavailable = (event) => {
    if (event.data.size > 0) morceaux.push(event.data);
  };
  const fin = new Promise<void>((resolve) => {
    enregistreur.onstop = () => resolve();
  });

  const peindre = () => {
    contexte.drawImage(options.source, 0, 0, options.largeur, options.hauteur);
    piste.requestFrame();
  };

  options.allerA(0);
  await imageSuivante();
  await imageSuivante();
  enregistreur.start();
  const debut = performance.now();
  const duree = 1000 / options.fps;
  try {
    for (let frame = 0; frame < options.frames; frame += 1) {
      if (options.signal?.aborted) throw new DOMException('Enregistrement annulé', 'AbortError');
      options.allerA(frame);
      await imageSuivante();
      await imageSuivante();
      peindre();
      options.onProgres?.(frame);
      const attente = debut + (frame + 1) * duree - performance.now();
      if (attente > 0) await new Promise((resolve) => setTimeout(resolve, attente));
    }
  } finally {
    enregistreur.stop();
    flux.getTracks().forEach((t) => t.stop());
  }
  await fin;
  return new Blob(morceaux, { type: format.extension === 'mp4' ? 'video/mp4' : 'video/webm' });
}
