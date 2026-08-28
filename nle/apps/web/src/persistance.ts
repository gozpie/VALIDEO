/**
 * Persistance du projet (sections 44, 45, 46, 61).
 *
 * Choix du stockage, par ordre de preference :
 *   OPFS          -- vrai systeme de fichiers, quotas larges ;
 *   localStorage  -- repli, quelques mega-octets, suffisant pour un document ;
 *   memoire       -- dernier recours, et l interface DOIT alors prevenir que
 *                    le travail sera perdu a la fermeture (section 1003).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppError } from '@valideo/shared';
import { isErr } from '@valideo/shared';
import type { ProjectDoc } from '@valideo/project-model';
import {
  Autosave,
  LocalStorageProvider,
  MemoryProvider,
  ProjectStore,
  opfsDisponible,
} from '@valideo/storage';
import type { EtatReprise, RacineOpfs, StorageProvider } from '@valideo/storage';

export interface ChoixStockage {
  readonly fournisseur: StorageProvider;
  /** Vrai si le travail survit a la fermeture de l onglet. */
  readonly persistant: boolean;
}

export function choisirStockage(): ChoixStockage {
  // Le typage DOM du navigateur et celui, minimal, du paquet storage décrivent
  // la même API ; on force la conversion à cette unique frontière.
  const opfs = opfsDisponible(
    globalThis.navigator as unknown as { storage?: RacineOpfs } | undefined,
  );
  if (opfs !== null) return { fournisseur: opfs, persistant: true };

  try {
    const local = (globalThis as { localStorage?: Storage }).localStorage;
    if (local !== undefined) {
      // Vérification réelle : un navigateur en navigation privée peut exposer
      // localStorage tout en refusant l'écriture.
      local.setItem('valideo:test', '1');
      local.removeItem('valideo:test');
      return { fournisseur: new LocalStorageProvider(local), persistant: true };
    }
  } catch {
    // On tombe en mémoire, et on le dira.
  }
  return { fournisseur: new MemoryProvider(), persistant: false };
}

export type EtatEnregistrement = 'propre' | 'modifie' | 'enregistrement' | 'erreur';

export interface Persistance {
  readonly etat: EtatEnregistrement;
  readonly persistant: boolean;
  readonly nomStockage: string;
  readonly reprise: EtatReprise;
  readonly erreur: AppError | null;
  readonly pret: boolean;
  enregistrer(doc: ProjectDoc): Promise<void>;
  accepterReprise(): void;
  refuserReprise(): void;
}

export interface OptionsPersistance {
  readonly document: ProjectDoc;
  readonly modifie: boolean;
  readonly surChargement: (doc: ProjectDoc) => void;
  readonly surEnregistrement: () => void;
  readonly delaiAutosaveMs?: number;
}

/**
 * Branche le document sur le stockage : chargement a l ouverture, detection
 * d une reprise, puis sauvegarde automatique temporisee.
 */
export function usePersistance(options: OptionsPersistance): Persistance {
  const { document, modifie, surChargement, surEnregistrement } = options;

  const choixRef = useRef<ChoixStockage | null>(null);
  if (choixRef.current === null) choixRef.current = choisirStockage();
  const choix = choixRef.current;

  const storeRef = useRef<ProjectStore | null>(null);
  if (storeRef.current === null) storeRef.current = new ProjectStore(choix.fournisseur);
  const store = storeRef.current;

  const autosaveRef = useRef<Autosave | null>(null);
  if (autosaveRef.current === null) {
    autosaveRef.current = new Autosave(store, { delaiMs: options.delaiAutosaveMs ?? 1500 });
  }
  const autosave = autosaveRef.current;

  const [etat, definirEtat] = useState<EtatEnregistrement>('propre');
  const [erreur, definirErreur] = useState<AppError | null>(null);
  const [reprise, definirReprise] = useState<EtatReprise>({ type: 'aucune' });
  const [pret, definirPret] = useState(false);

  const documentRef = useRef(document);
  documentRef.current = document;

  // Ouverture : on charge le dernier enregistrement, puis on regarde s il reste
  // un travail non enregistré d'une session interrompue.
  useEffect(() => {
    let annule = false;
    void (async () => {
      const id = documentRef.current.id;
      const charge = await store.charger(id);
      if (annule) return;
      if (isErr(charge)) {
        // Un projet enregistré illisible doit se VOIR. L'avaler en silence
        // reviendrait à repartir d'un document vide sans prévenir, ce qui est
        // le pire scénario possible pour un monteur (§106).
        definirErreur(charge.error);
        definirEtat('erreur');
      } else if (charge.value !== null) {
        surChargement(charge.value);
      }

      const detection = await store.reprise(id);
      if (annule) return;
      if (isErr(detection)) definirErreur(detection.error);
      else definirReprise(detection.value);
      definirPret(true);
    })();
    return () => {
      annule = true;
    };
    // Volontairement au montage seulement : l'ouverture est un évènement unique.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sauvegarde automatique : chaque modification replanifie une écriture.
  useEffect(() => {
    if (!pret) return;
    if (!modifie) {
      definirEtat('propre');
      return;
    }
    definirEtat('modifie');
    autosave.planifier(document);
  }, [document, modifie, pret, autosave]);

  // Dernière chance avant la fermeture de l'onglet.
  useEffect(() => {
    const surFermeture = (): void => {
      void autosave.ecrireMaintenant();
    };
    window.addEventListener('pagehide', surFermeture);
    return () => window.removeEventListener('pagehide', surFermeture);
  }, [autosave]);

  const enregistrer = useCallback(
    async (doc: ProjectDoc) => {
      definirEtat('enregistrement');
      const r = await store.enregistrer(doc);
      if (isErr(r)) {
        definirErreur(r.error);
        definirEtat('erreur');
        return;
      }
      definirErreur(null);
      definirEtat('propre');
      surEnregistrement();
    },
    [store, surEnregistrement],
  );

  const accepterReprise = useCallback(() => {
    if (reprise.type !== 'disponible') return;
    surChargement(reprise.automatique);
    void store.abandonnerReprise(reprise.automatique.id);
    definirReprise({ type: 'aucune' });
  }, [reprise, store, surChargement]);

  const refuserReprise = useCallback(() => {
    if (reprise.type !== 'disponible') return;
    void store.abandonnerReprise(reprise.automatique.id);
    definirReprise({ type: 'aucune' });
  }, [reprise, store]);

  return {
    etat,
    persistant: choix.persistant,
    nomStockage: choix.fournisseur.nom,
    reprise,
    erreur,
    pret,
    enregistrer,
    accepterReprise,
    refuserReprise,
  };
}
