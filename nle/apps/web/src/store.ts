/**
 * Etat de l editeur.
 *
 * Un seul point d entree pour modifier la sequence : `executer(commande)`.
 * Tout ce que fait l utilisateur passe donc par l historique (section 43), sans
 * exception possible -- il n existe aucun `setSequence` accessible ailleurs.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { History } from '@valideo/command-system';
import type { Command } from '@valideo/command-system';
import type { AppError } from '@valideo/shared';
import { isErr } from '@valideo/shared';
import type { MediaAssetDoc, ProjectDoc, SequenceDoc } from '@valideo/project-model';
import type { PeakPyramid } from '@valideo/audio-engine';
import type { VideoSource } from './media/video-source.js';
import type { TimelineContext } from '@valideo/timeline-model';
import { rational } from '@valideo/time-core';
import type { SourceInfo } from '@valideo/timeline-model';
import { timebaseDeSequence } from './timeline/draw.js';
import { creerProjetDemo } from './demo-project.js';

export type Outil =
  | 'selection'
  | 'trackSelect'
  | 'ripple'
  | 'rolling'
  | 'razor'
  | 'slip'
  | 'slide'
  | 'rateStretch'
  | 'hand';

export interface EtatEditeur {
  readonly sequence: SequenceDoc;
  readonly selection: ReadonlySet<string>;
  readonly tete: number;
  readonly outil: Outil;
  readonly accrochage: boolean;
  readonly historique: {
    canUndo: boolean;
    canRedo: boolean;
    labels: readonly string[];
    position: number;
    dirty: boolean;
  };
  readonly derniereErreur: AppError | null;
  readonly contexte: TimelineContext;
  /** Document complet, tel qu'il sera enregistré. */
  readonly document: ProjectDoc;
  /** Pyramides de pics des médias dont l'audio a été décodé, par identifiant. */
  readonly pics: ReadonlyMap<string, PeakPyramid>;
  /** Tampons audio décodés, conservés pour la lecture. Jamais persistés. */
  readonly tampons: ReadonlyMap<string, AudioBuffer>;
  /** Sources vidéo démultiplexées, prêtes à décoder. Jamais persistées. */
  readonly sourcesVideo: ReadonlyMap<string, VideoSource>;
  /** Vrai pendant la lecture : certains travaux de fond doivent s'effacer. */
  readonly enLecture: boolean;
  /**
   * Média sélectionné dans le panneau Médias. C'est la source des raccourcis
   * Insert et Overwrite : sans lui, ces touches n'auraient rien à poser.
   */
  readonly mediaSelectionne: string | null;
}

export interface ActionsEditeur {
  executer(commande: Command<SequenceDoc>): boolean;
  annuler(): void;
  retablir(): void;
  allerA(index: number): void;
  enregistrer(): void;
  definirSelection(ids: Iterable<string>): void;
  basculerSelection(id: string, additive: boolean): void;
  definirTete(image: number): void;
  definirOutil(outil: Outil): void;
  definirEnLecture(valeur: boolean): void;
  definirMediaSelectionne(id: string | null): void;
  basculerAccrochage(): void;
  effacerErreur(): void;
  /** Remplace le document courant, à l'ouverture ou après une reprise. */
  chargerDocument(doc: ProjectDoc): void;
  signalerErreur(erreur: AppError): void;
  /**
   * Modifie un média du projet : mise hors ligne, reliaison, renommage.
   *
   * Volontairement HORS de l'historique, qui ne porte que la séquence. Mettre
   * un média hors ligne décrit l'état du disque, pas une décision de montage :
   * une annulation ne doit pas prétendre remettre un fichier en place.
   */
  modifierMedia(id: string, modifs: Partial<MediaAssetDoc>): void;
  /** Remplace les données décodées d'un média déjà présent, après reliaison. */
  definirDonneesMedia(
    id: string,
    pics: PeakPyramid | null,
    tampon: AudioBuffer | null,
    video: VideoSource | null,
  ): void;
  /** Ajoute un média analysé au projet, avec ses pics et son tampon éventuels. */
  ajouterMedia(
    asset: MediaAssetDoc,
    pics: PeakPyramid | null,
    tampon: AudioBuffer | null,
    video: VideoSource | null,
  ): void;
}

export function useEditeur(): [EtatEditeur, ActionsEditeur] {
  const demoRef = useRef<ProjectDoc | null>(null);
  if (demoRef.current === null) demoRef.current = creerProjetDemo().projet;

  const historyRef = useRef<History<SequenceDoc> | null>(null);
  if (historyRef.current === null) {
    const premiere = demoRef.current.sequences[0];
    if (premiere === undefined) throw new Error('Projet de démonstration sans séquence.');
    historyRef.current = new History<SequenceDoc>(premiere, { maxDepth: 300 });
  }
  const history = historyRef.current;
  const [enveloppe, setEnveloppe] = useState<ProjectDoc>(demoRef.current);
  const [pics, setPics] = useState<ReadonlyMap<string, PeakPyramid>>(() => new Map());
  const [tampons, setTampons] = useState<ReadonlyMap<string, AudioBuffer>>(() => new Map());
  const [sourcesVideo, setSourcesVideo] = useState<ReadonlyMap<string, VideoSource>>(
    () => new Map(),
  );

  const [sequence, setSequence] = useState<SequenceDoc>(() => history.current());
  const [instantane, setInstantane] = useState(() => history.snapshot());
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [tete, setTete] = useState(0);
  const [outil, setOutil] = useState<Outil>('selection');
  const [accrochage, setAccrochage] = useState(true);
  const [enLecture, setEnLecture] = useState(false);
  const [mediaSelectionne, setMediaSelectionne] = useState<string | null>(null);
  const [derniereErreur, setDerniereErreur] = useState<AppError | null>(null);

  const rafraichir = useCallback(() => {
    setSequence(history.current());
    setInstantane(history.snapshot());
  }, [history]);

  const executer = useCallback(
    (commande: Command<SequenceDoc>): boolean => {
      const resultat = history.execute(commande);
      if (isErr(resultat)) {
        setDerniereErreur(resultat.error);
        return false;
      }
      setDerniereErreur(null);
      rafraichir();
      return true;
    },
    [history, rafraichir],
  );

  const contexte = useMemo<TimelineContext>(() => {
    const parId = new Map(enveloppe.media.map((m) => [m.id, m]));
    return {
      timebase: timebaseDeSequence(sequence),
      /**
       * Bornes réelles de la source, quand le média est connu.
       *
       * C'est ce qui rend les butées de trim exactes : on ne peut plus tirer un
       * clip au-delà de ce que le fichier contient. Pour un clip sans média —
       * titre, cache couleur, calque d'effet — il n'y a rien à borner, et on
       * retourne `null` plutôt que d'inventer une limite.
       */
      resolveSource: (clip): SourceInfo | null => {
        if (clip.mediaId === null) return null;
        const asset = parId.get(clip.mediaId);
        if (asset === undefined) return null;
        return {
          first: 0,
          count: asset.duration.frames,
          rate: rational(asset.duration.base.rate.n, asset.duration.base.rate.d),
        };
      },
    };
  }, [enveloppe.media, sequence]);

  const actions = useMemo<ActionsEditeur>(
    () => ({
      executer,
      annuler: () => {
        if (!isErr(history.undo())) rafraichir();
      },
      retablir: () => {
        if (!isErr(history.redo())) rafraichir();
      },
      allerA: (index: number) => {
        if (!isErr(history.goTo(index))) rafraichir();
      },
      enregistrer: () => {
        history.markSaved();
        rafraichir();
      },
      definirSelection: (ids: Iterable<string>) => setSelection(new Set(ids)),
      basculerSelection: (id: string, additive: boolean) =>
        setSelection((courante) => {
          if (!additive) return new Set([id]);
          const suivante = new Set(courante);
          if (suivante.has(id)) suivante.delete(id);
          else suivante.add(id);
          return suivante;
        }),
      definirTete: (image: number) => setTete(Math.max(0, Math.trunc(image))),
      definirOutil: setOutil,
      definirEnLecture: setEnLecture,
      definirMediaSelectionne: setMediaSelectionne,
      basculerAccrochage: () => setAccrochage((v) => !v),
      effacerErreur: () => setDerniereErreur(null),
      signalerErreur: (erreur: AppError) => setDerniereErreur(erreur),
      ajouterMedia: (
        asset: MediaAssetDoc,
        nouveauxPics: PeakPyramid | null,
        tampon: AudioBuffer | null,
        video: VideoSource | null,
      ) => {
        setEnveloppe((courante) => ({ ...courante, media: [...courante.media, asset] }));
        if (nouveauxPics !== null) {
          setPics((courants) => new Map(courants).set(asset.id, nouveauxPics));
        }
        if (tampon !== null) {
          setTampons((courants) => new Map(courants).set(asset.id, tampon));
        }
        if (video !== null) {
          setSourcesVideo((courantes) => new Map(courantes).set(asset.id, video));
        }
      },
      modifierMedia: (id: string, modifs: Partial<MediaAssetDoc>) => {
        setEnveloppe((courante) => ({
          ...courante,
          media: courante.media.map((m) => (m.id === id ? { ...m, ...modifs, id: m.id } : m)),
        }));
        if (modifs.status !== undefined && modifs.status !== 'online') {
          // Les données décodées ne décrivent plus rien : les garder ferait
          // jouer un son dont le fichier n'est plus là, ce qui contredirait
          // exactement ce que « hors ligne » annonce.
          setPics((c) => {
            const suivant = new Map(c);
            suivant.delete(id);
            return suivant;
          });
          setTampons((c) => {
            const suivant = new Map(c);
            suivant.delete(id);
            return suivant;
          });
          setSourcesVideo((c) => {
            const suivant = new Map(c);
            suivant.get(id)?.fermer();
            suivant.delete(id);
            return suivant;
          });
        }
      },
      definirDonneesMedia: (
        id: string,
        nouveauxPics: PeakPyramid | null,
        tampon: AudioBuffer | null,
        video: VideoSource | null,
      ) => {
        setPics((c) => {
          const suivant = new Map(c);
          if (nouveauxPics === null) suivant.delete(id);
          else suivant.set(id, nouveauxPics);
          return suivant;
        });
        setTampons((c) => {
          const suivant = new Map(c);
          if (tampon === null) suivant.delete(id);
          else suivant.set(id, tampon);
          return suivant;
        });
        setSourcesVideo((c) => {
          const suivant = new Map(c);
          // L'ancienne source tient un décodeur : la remplacer sans la fermer
          // laisserait un `VideoDecoder` vivant pour un fichier disparu.
          suivant.get(id)?.fermer();
          if (video === null) suivant.delete(id);
          else suivant.set(id, video);
          return suivant;
        });
      },
      chargerDocument: (doc: ProjectDoc) => {
        const premiere = doc.sequences[0];
        if (premiere === undefined) return;
        setEnveloppe(doc);
        history.reinitialiser(premiere);
        setSelection(new Set<string>());
        setTete(0);
        rafraichir();
      },
    }),
    [executer, history, rafraichir],
  );

  const document = useMemo<ProjectDoc>(
    () => ({ ...enveloppe, sequences: [sequence], activeSequenceId: sequence.id }),
    [enveloppe, sequence],
  );

  const etat: EtatEditeur = {
    document,
    pics,
    tampons,
    sourcesVideo,
    sequence,
    selection,
    tete,
    outil,
    accrochage,
    enLecture,
    mediaSelectionne,
    historique: instantane,
    derniereErreur,
    contexte,
  };

  return [etat, actions];
}

/** Cadence de la séquence, en flottant, pour l affichage seul. */
export function cadenceAffichee(sequence: SequenceDoc): number {
  return sequence.timebase.rate.n / sequence.timebase.rate.d;
}
