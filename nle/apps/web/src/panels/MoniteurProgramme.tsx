/**
 * Moniteur Programme : l image reelle du montage a la tete de lecture.
 *
 * Le clip affiche est celui de la piste video la plus HAUTE qui soit active et
 * couvre la tete de lecture -- l ordre de composition d un NLE. Il n y a pas
 * encore de composition multicouche : superposition, opacite et fondus
 * demandent le graphe de rendu, qui n existe pas. Un seul clip est donc
 * affiche, et le panneau le dit.
 *
 * PORTEE (section 1003). L image suit reellement la lecture : le decodage
 * anticipe remplit un cache devant la tete, et l affichage se cale sur la
 * position que dicte l horloge audio. Ce qui manque encore : la COMPOSITION --
 * superposition des pistes, opacite, fondus, effets -- qui demande le graphe de
 * rendu. Une seule couche est donc affichee, et le panneau le dit.
 */
import { useEffect, useRef, useState } from 'react';
import type { SequenceDoc } from '@valideo/project-model';
import { clipEnd } from '@valideo/timeline-model';
import type { VideoSource } from '../media/video-source.js';

export interface ProprietesMoniteurProgramme {
  readonly sequence: SequenceDoc;
  readonly tete: number;
  readonly tempsCode: string;
  readonly duree: string;
  readonly sources: ReadonlyMap<string, VideoSource>;
  readonly mediaCadence: (mediaId: string) => number;
  readonly enLecture: boolean;
}

interface ClipVisible {
  readonly mediaId: string;
  readonly secondesSource: number;
  readonly nom: string;
}

/** Clip video visible a la tete de lecture, sur la piste la plus haute. */
function clipVisible(
  sequence: SequenceDoc,
  tete: number,
  mediaCadence: (mediaId: string) => number,
): ClipVisible | null {
  const cadenceSequence = sequence.timebase.rate.n / sequence.timebase.rate.d;
  const pistes = sequence.tracks
    .filter((t) => t.kind === 'video' && t.enabled)
    .sort((a, b) => b.index - a.index);

  for (const piste of pistes) {
    for (const clip of piste.clips) {
      if (!clip.enabled || clip.mediaId === null) continue;
      if (tete < clip.start || tete >= clipEnd(clip)) continue;
      const cadenceSource = mediaCadence(clip.mediaId);
      if (cadenceSource <= 0) continue;
      const vitesse = clip.speed.n / clip.speed.d;
      const secondes =
        clip.sourceIn / cadenceSource + ((tete - clip.start) * vitesse) / cadenceSequence;
      return { mediaId: clip.mediaId, secondesSource: secondes, nom: clip.name };
    }
  }
  return null;
}

export function MoniteurProgramme({
  sequence,
  tete,
  tempsCode,
  duree,
  sources,
  mediaCadence,
  enLecture,
}: ProprietesMoniteurProgramme): React.JSX.Element {
  const toileRef = useRef<HTMLCanvasElement | null>(null);
  const [message, definirMessage] = useState<string>('Aucune image à cette position');
  /** Horodatage de l'image affichée, en microsecondes. Exposé pour les tests. */
  const [ptsAffiche, definirPtsAffiche] = useState<number | null>(null);
  const demandeRef = useRef(0);
  const teteRef = useRef(tete);
  teteRef.current = tete;

  useEffect(() => {
    const visible = clipVisible(sequence, tete, mediaCadence);
    const toile = toileRef.current;
    if (toile === null) return undefined;
    const ctx = toile.getContext('2d');
    if (ctx === null) return undefined;

    if (visible === null) {
      ctx.clearRect(0, 0, toile.width, toile.height);
      definirMessage('Aucun clip vidéo à cette position');
      definirPtsAffiche(null);
      return undefined;
    }

    const source = sources.get(visible.mediaId);
    if (source === undefined) {
      ctx.clearRect(0, 0, toile.width, toile.height);
      definirMessage(`« ${visible.nom} » n’a pas de source décodable`);
      return undefined;
    }
    if (!source.infos.decodable) {
      ctx.clearRect(0, 0, toile.width, toile.height);
      definirMessage(`Ce navigateur ne décode pas ${source.infos.codec} : un proxy est nécessaire`);
      return undefined;
    }

    const demande = demandeRef.current + 1;
    demandeRef.current = demande;
    let annule = false;

    void source
      .imageA(visible.secondesSource)
      .then((image) => {
        // Une demande plus récente a été lancée entre-temps : celle-ci est
        // périmée, l'afficher ferait clignoter une image en arrière.
        if (annule || demande !== demandeRef.current) {
          image?.close();
          return;
        }
        if (image === null) {
          definirMessage('Image non décodée');
          return;
        }
        toile.width = image.displayWidth;
        toile.height = image.displayHeight;
        ctx.drawImage(image, 0, 0);
        definirPtsAffiche(image.timestamp);
        image.close();
        definirMessage('');
      })
      .catch(() => {
        // Même garde que pour le succès : une demande périmée ne doit pas
        // afficher son échec par-dessus une image plus récente qui, elle, a
        // abouti.
        if (!annule && demande === demandeRef.current) definirMessage('Le décodage a échoué');
      });

    return () => {
      annule = true;
    };
  }, [sequence, tete, sources, mediaCadence]);

  /**
   * Décodage anticipé pendant la lecture.
   *
   * C'est ce qui sépare « afficher une image » de « lire » : sans avance, chaque
   * image coûterait un aller-retour de décodage et la cadence s'effondrerait.
   * On remplit le cache une seconde et demie devant la tête, quatre fois par
   * seconde (§121).
   */
  useEffect(() => {
    if (!enLecture) return undefined;
    const avancer = (): void => {
      const visible = clipVisible(sequence, teteRef.current, mediaCadence);
      if (visible === null) return;
      const source = sources.get(visible.mediaId);
      if (source === undefined || !source.infos.decodable) return;
      const cadence = source.infos.cadence.n / source.infos.cadence.d;
      void source.precharger(visible.secondesSource, Math.ceil(cadence * 1.5));
    };
    avancer();
    const id = setInterval(avancer, 250);
    return () => clearInterval(id);
  }, [enLecture, sequence, sources, mediaCadence]);

  return (
    <section className="panneau">
      <div className="panneau-entete">
        <span className="titre">Moniteur Programme</span>
        <span className="espace" />
        <span className="etiquette-etat partiel">Une seule couche · pas de composition</span>
      </div>
      <div className="panneau-corps">
        <div className="moniteur">
          <div className="moniteur-image">
            <canvas
              ref={toileRef}
              className="toile-programme"
              data-test="image-programme"
              data-pts={ptsAffiche ?? ''}
            />
            {message !== '' && (
              <div className="moniteur-vide">
                <h3>{enLecture ? 'Lecture du son en cours' : message}</h3>
                <p>
                  L’image affichée est décodée par WebCodecs à partir du fichier réel, et suit la
                  lecture. La composition — superposition des pistes, opacité, fondus, effets —
                  demande le graphe de rendu, qui n’existe pas encore : une seule couche est
                  affichée.
                </p>
              </div>
            )}
          </div>
          <div className="moniteur-barre">
            <span className="tc mono">{tempsCode}</span>
            <span className="espace" style={{ flex: 1 }} />
            <span className="mono" style={{ color: 'var(--texte-doux)' }}>
              {duree}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
