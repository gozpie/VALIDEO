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
import type { SequenceDoc } from '@valideo/project-model';
import type { TimelineContext } from '@valideo/timeline-model';
import { rational } from '@valideo/time-core';
import { timebaseDeSequence } from './timeline/draw.js';
import { creerSequenceDemo } from './demo-project.js';

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
}

export function useEditeur(): [EtatEditeur, ActionsEditeur] {
  const historyRef = useRef<History<SequenceDoc> | null>(null);
  if (historyRef.current === null) {
    historyRef.current = new History<SequenceDoc>(creerSequenceDemo(), { maxDepth: 300 });
  }
  const history = historyRef.current;

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
    }),
    [executer, history, rafraichir],
  );

  const etat: EtatEditeur = {
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
