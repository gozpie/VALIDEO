/**
 * Moniteur du film : l'image composée à la tête de lecture, toutes pistes empilées. La tête suit
 * l'horloge audio ; le décodage anticipé garde les images prêtes devant elle.
 *
 * Cliquer-glisser sur l'image déplace le calque sélectionné.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SequenceDoc } from '@valideo/project-model';
import { composerImage } from '@valideo/playback';
import type { CalqueComposition, CouchePiste, SourcesComposition } from '@valideo/playback';
import { dessinerComposition } from '../composition/compositeur';
import type { SourceVisuelle } from '../media/video-source';

export interface ProprietesMoniteurProgramme {
  readonly sequence: SequenceDoc;
  readonly tete: number;
  readonly tempsCode: string;
  readonly duree: string;
  readonly sources: ReadonlyMap<string, SourceVisuelle>;
  readonly sourcesComposition: SourcesComposition;
  readonly enLecture: boolean;
  /** Des médias sont encore en cours de récupération. */
  readonly chargement: boolean;
  /** Clips sélectionnés : le plus haut d'entre eux se déplace à la souris sur l'image. */
  readonly selection: ReadonlySet<string>;
  /** Décalage demandé par rapport à ce que le clip avait au début du geste, en pixels du cadre. */
  readonly surDeplacer: (
    clipId: string,
    debut: readonly [number, number],
    dx: number,
    dy: number,
  ) => void;
  /** Commandes de lecture, sous l'image. */
  readonly commandes: React.ReactNode;
}

function calquesDe(couches: readonly CouchePiste[]): readonly CalqueComposition[] {
  return couches.flatMap((c) => [c.sortant, c.entrant].filter((x) => x !== null));
}

export function MoniteurProgramme({
  sequence,
  tete,
  tempsCode,
  duree,
  sources,
  sourcesComposition,
  enLecture,
  chargement,
  selection,
  surDeplacer,
  commandes,
}: ProprietesMoniteurProgramme): React.JSX.Element {
  const toileRef = useRef<HTMLCanvasElement | null>(null);
  const brouillonRef = useRef<HTMLCanvasElement | null>(null);
  const [message, definirMessage] = useState('');
  /** Horodatage de l'image du calque le plus haut, en microsecondes. Exposé pour les tests. */
  const [ptsAffiche, definirPtsAffiche] = useState<number | null>(null);
  const [nombreCalques, definirNombreCalques] = useState(0);
  const demandeRef = useRef(0);
  const teteRef = useRef(tete);
  teteRef.current = tete;

  const { width: largeur, height: hauteur } = sequence.settings;

  const couches = useMemo(
    () => composerImage(sequence, tete, sourcesComposition),
    [sequence, tete, sourcesComposition],
  );

  useEffect(() => {
    const toile = toileRef.current;
    const ctx = toile?.getContext('2d');
    if (toile === undefined || toile === null || ctx === null || ctx === undefined)
      return undefined;
    if (brouillonRef.current === null) brouillonRef.current = document.createElement('canvas');
    const feuille = brouillonRef.current;
    if (toile.width !== largeur || toile.height !== hauteur) {
      toile.width = largeur;
      toile.height = hauteur;
      feuille.width = largeur;
      feuille.height = hauteur;
    }
    const brouillon = feuille.getContext('2d');
    if (brouillon === null) return undefined;

    const calques = calquesDe(couches);
    const demande = demandeRef.current + 1;
    demandeRef.current = demande;
    let manque: string | null = null;

    const dessiner = (images: ReadonlyMap<string, VideoFrame>): void => {
      const { dessines } = dessinerComposition(ctx, brouillon, couches, images, largeur, hauteur);
      let pts: number | null = null;
      for (const calque of calques) {
        const image = images.get(calque.clipId);
        if (image !== undefined) pts = image.timestamp;
      }
      definirPtsAffiche(pts);
      definirNombreCalques(dessines);
    };

    const medias = calques.flatMap((calque) => {
      if (calque.nature !== 'media' || calque.mediaId === null) return [];
      const source = sources.get(calque.mediaId);
      if (source === undefined) {
        manque = chargement ? `Chargement de ${calque.nom}…` : `${calque.nom} : média hors ligne`;
        return [];
      }
      if (!source.infos.decodable) {
        manque = `Ce navigateur ne décode pas ${source.infos.codec} : un proxy est nécessaire`;
        return [];
      }
      return [{ calque, source }];
    });

    // En lecture, on n'attend jamais le décodeur : si une image n'est pas encore là, l'écran garde la
    // précédente et la lecture continue. Attendre désynchroniserait l'image du son.
    if (enLecture) {
      const images = new Map<string, VideoFrame>();
      let complet = true;
      for (const { calque, source } of medias) {
        const image = source.imagePrete(calque.secondesSource);
        if (image === null) {
          complet = false;
          void source.precharger(calque.secondesSource, 24);
        } else {
          images.set(calque.clipId, image);
        }
      }
      if (complet) {
        dessiner(images);
        definirMessage(manque ?? (couches.length === 0 ? 'Aucun plan à cette position' : ''));
      }
      for (const image of images.values()) image.close();
      return undefined;
    }

    let annule = false;
    const lectures = medias.map(({ calque, source }) =>
      source
        .imageA(calque.secondesSource)
        .then((image) => [calque.clipId, image] as const)
        .catch(() => [calque.clipId, null] as const),
    );
    void Promise.all(lectures).then((lues) => {
      const images = new Map<string, VideoFrame>();
      for (const [clipId, image] of lues) if (image !== null) images.set(clipId, image);
      // Une demande plus récente a été lancée entre-temps : l'afficher ferait clignoter une image en
      // arrière.
      if (!annule && demande === demandeRef.current) {
        dessiner(images);
        if (lues.some(([, image]) => image === null)) manque ??= 'Image non décodée';
        definirMessage(manque ?? (couches.length === 0 ? 'Aucun plan à cette position' : ''));
      }
      for (const image of images.values()) image.close();
    });

    return () => {
      annule = true;
    };
  }, [couches, sources, chargement, enLecture, largeur, hauteur]);

  /**
   * Décodage anticipé pendant la lecture : chaque média qui va être vu (même s'il n'entre que dans une
   * seconde, au prochain raccord) prend de l'avance, quatre fois par seconde.
   */
  useEffect(() => {
    if (!enLecture) return undefined;
    const cadence = sequence.timebase.rate.n / sequence.timebase.rate.d;
    const avancer = (): void => {
      const dejaVus = new Set<string>();
      for (const seconde of [0, 0.5, 1, 1.5]) {
        const image = teteRef.current + Math.round(seconde * cadence);
        for (const calque of calquesDe(composerImage(sequence, image, sourcesComposition))) {
          if (calque.mediaId === null || dejaVus.has(calque.clipId)) continue;
          dejaVus.add(calque.clipId);
          const source = sources.get(calque.mediaId);
          if (source === undefined || !source.infos.decodable) continue;
          const cadenceSource = source.infos.cadence.n / source.infos.cadence.d;
          void source.precharger(calque.secondesSource, Math.ceil(cadenceSource * 1.5));
        }
      }
    };
    avancer();
    const id = setInterval(avancer, 250);
    return () => clearInterval(id);
  }, [enLecture, sequence, sources, sourcesComposition]);

  const geste = useRef<{
    clipId: string;
    debut: readonly [number, number];
    x: number;
    y: number;
    pixels: number;
  } | null>(null);

  const surPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const calque = [...calquesDe(couches)].reverse().find((c) => selection.has(c.clipId));
      if (calque === undefined) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      // Le canvas affiche le cadre entier sans le déformer : un pixel d'écran vaut tant de pixels du cadre.
      const r = e.currentTarget.getBoundingClientRect();
      geste.current = {
        clipId: calque.clipId,
        debut: calque.position,
        x: e.clientX,
        y: e.clientY,
        pixels: Math.max(largeur / r.width, hauteur / r.height),
      };
    },
    [couches, hauteur, largeur, selection],
  );

  return (
    <section className="panneau">
      <div className="panneau-corps">
        <div className="moniteur">
          <div className="moniteur-image">
            <canvas
              ref={toileRef}
              className="toile-programme"
              data-test="image-programme"
              data-pts={ptsAffiche ?? ''}
              data-calques={nombreCalques}
              onPointerDown={surPointerDown}
              onPointerMove={(e) => {
                const g = geste.current;
                if (g === null) return;
                surDeplacer(
                  g.clipId,
                  g.debut,
                  Math.round((e.clientX - g.x) * g.pixels),
                  Math.round((e.clientY - g.y) * g.pixels),
                );
              }}
              onPointerUp={() => {
                geste.current = null;
              }}
              onPointerCancel={() => {
                geste.current = null;
              }}
            />
            {message !== '' && (
              <div className={nombreCalques > 0 ? 'moniteur-vide discret' : 'moniteur-vide'}>
                <h3>{message}</h3>
              </div>
            )}
          </div>
          <div className="moniteur-barre">
            <span className="tc mono">{tempsCode}</span>
            <span className="moniteur-commandes">{commandes}</span>
            <span className="mono moniteur-duree">{duree}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
