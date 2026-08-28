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
import type { ProjectDoc, SequenceDoc } from '@valideo/project-model';
import type { TimelineContext } from '@valideo/timeline-model';
import { rational } from '@valideo/time-core';
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
  basculerAccrochage(): void;
  effacerErreur(): void;
  /** Remplace le document courant, à l'ouverture ou après une reprise. */
  chargerDocument(doc: ProjectDoc): void;
  signalerErreur(erreur: AppError): void;
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

  const [sequence, setSequence] = useState<SequenceDoc>(() => history.current());
  const [instantane, setInstantane] = useState(() => history.snapshot());
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [tete, setTete] = useState(0);
  const [outil, setOutil] = useState<Outil>('selection');
  const [accrochage, setAccrochage] = useState(true);
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

  const contexte = useMemo<TimelineContext>(
    () => ({
      timebase: timebaseDeSequence(sequence),
      // Le projet de démonstration ne référence aucun média : les bornes de
      // source sont donc inconnues, et les trims ne sont pas contraints. Ce
      // resolveur sera remplacé dès qu'un média réel sera analysé.
      resolveSource: () => null,
    }),
    [sequence],
  );

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
      basculerAccrochage: () => setAccrochage((v) => !v),
      effacerErreur: () => setDerniereErreur(null),
      signalerErreur: (erreur: AppError) => setDerniereErreur(erreur),
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
    sequence,
    selection,
    tete,
    outil,
    accrochage,
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

export const UNE = rational(1);
