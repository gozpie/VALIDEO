/**
 * Enregistrement, instantanes et reprise apres incident (sections 44, 45, 46).
 *
 * Organisation des cles :
 *
 *   projets/<id>/projet.json           dernier enregistrement EXPLICITE
 *   projets/<id>/auto.json             derniere sauvegarde AUTOMATIQUE
 *   projets/<id>/instantanes/<n>.json  instantanes horodates, en rotation
 *   projets/<id>/meta.json             dates et empreintes
 *
 * La reprise apres incident repose sur une comparaison simple : si la
 * sauvegarde automatique est plus recente que le dernier enregistrement
 * explicite, c est que la session s est interrompue sans enregistrer. On
 * PROPOSE alors la reprise, sans jamais ecraser d office le travail enregistre.
 *
 * PORTEE : ce mecanisme est fonde sur des INSTANTANES du document. Le journal
 * transactionnel par commande evoque en section 44 n est PAS implemente : il
 * exigerait des commandes serialisables, ce que le moteur actuel ne fournit pas
 * (les commandes sont des fonctions). C est signale ici plutot que sous-entendu.
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, depuisUtf8, err, ok, utf8 } from '@valideo/shared';
import type { ProjectDoc } from '@valideo/project-model';
import { deserializeProject, serializeProject } from '@valideo/project-model';
import type { StorageProvider } from './provider.js';

const RACINE = 'projets';

function cleProjet(id: string): string {
  return `${RACINE}/${id}/projet.json`;
}
function cleAuto(id: string): string {
  return `${RACINE}/${id}/auto.json`;
}
function cleMeta(id: string): string {
  return `${RACINE}/${id}/meta.json`;
}
function cleInstantane(id: string, horodatage: number): string {
  return `${RACINE}/${id}/instantanes/${String(horodatage).padStart(15, '0')}.json`;
}

export interface MetaProjet {
  readonly id: string;
  readonly nom: string;
  /** Millisecondes du dernier enregistrement explicite. */
  readonly enregistreLe: number | null;
  /** Millisecondes de la derniere sauvegarde automatique. */
  readonly autoLe: number | null;
}

export type EtatReprise =
  | { readonly type: 'aucune' }
  | {
      readonly type: 'disponible';
      readonly automatique: ProjectDoc;
      readonly autoLe: number;
      readonly enregistreLe: number | null;
    };

export interface OptionsProjectStore {
  /** Nombre d instantanes conserves. Les plus anciens sont supprimes. */
  readonly maxInstantanes?: number;
  /** Horloge injectable, pour des tests deterministes. */
  readonly maintenant?: () => number;
}

/**
 * Decode des octets stockes. Un stockage tronque ou ecrase produit des octets
 * qui ne sont pas de l UTF-8 : on le remonte comme une corruption de projet,
 * plutot que de laisser une exception traverser l application.
 */
function decoder(donnees: Uint8Array): Result<string, AppError> {
  try {
    return ok(depuisUtf8(donnees));
  } catch (cause) {
    return err(
      appError('PROJECT_CORRUPT', 'Le fichier de projet est illisible.', {
        action: 'Ouvrir un instantane precedent',
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
}

export class ProjectStore {
  private readonly maxInstantanes: number;
  private readonly maintenant: () => number;

  constructor(
    private readonly stockage: StorageProvider,
    options: OptionsProjectStore = {},
  ) {
    this.maxInstantanes = options.maxInstantanes ?? 20;
    this.maintenant = options.maintenant ?? (() => Date.now());
  }

  private async ecrireDocument(cle: string, doc: ProjectDoc): Promise<Result<void, AppError>> {
    return this.stockage.ecrire(cle, utf8(serializeProject(doc)));
  }

  private async lireDocument(cle: string): Promise<Result<ProjectDoc | null, AppError>> {
    const brut = await this.stockage.lire(cle);
    if (!brut.ok) return brut;
    if (brut.value === null) return ok(null);
    const texte = decoder(brut.value);
    if (!texte.ok) return texte;
    const lu = deserializeProject(texte.value);
    if (!lu.ok) return lu;
    return ok(lu.value.document);
  }

  private async lireMeta(id: string): Promise<MetaProjet | null> {
    const brut = await this.stockage.lire(cleMeta(id));
    if (!brut.ok || brut.value === null) return null;
    const texte = decoder(brut.value);
    if (!texte.ok) return null;
    try {
      return JSON.parse(texte.value) as MetaProjet;
    } catch {
      return null;
    }
  }

  private async ecrireMeta(meta: MetaProjet): Promise<Result<void, AppError>> {
    return this.stockage.ecrire(cleMeta(meta.id), utf8(JSON.stringify(meta)));
  }

  /** Enregistrement explicite. Cree aussi un instantane. */
  async enregistrer(doc: ProjectDoc): Promise<Result<void, AppError>> {
    const ecrit = await this.ecrireDocument(cleProjet(doc.id), doc);
    if (!ecrit.ok) return ecrit;

    const horodatage = this.maintenant();
    const instantane = await this.ecrireDocument(cleInstantane(doc.id, horodatage), doc);
    if (!instantane.ok) return instantane;
    await this.rotationInstantanes(doc.id);

    const precedent = await this.lireMeta(doc.id);
    return this.ecrireMeta({
      id: doc.id,
      nom: doc.name,
      enregistreLe: horodatage,
      autoLe: precedent?.autoLe ?? null,
    });
  }

  /**
   * Sauvegarde automatique (section 44).
   *
   * N ecrase JAMAIS le dernier enregistrement explicite : elle ecrit dans un
   * fichier distinct. Le travail volontairement enregistre reste donc intact,
   * meme si l autosave enregistre une modification que l utilisateur regrettera.
   */
  async autosauver(doc: ProjectDoc): Promise<Result<void, AppError>> {
    const ecrit = await this.ecrireDocument(cleAuto(doc.id), doc);
    if (!ecrit.ok) return ecrit;
    const precedent = await this.lireMeta(doc.id);
    return this.ecrireMeta({
      id: doc.id,
      nom: doc.name,
      enregistreLe: precedent?.enregistreLe ?? null,
      autoLe: this.maintenant(),
    });
  }

  async charger(id: string): Promise<Result<ProjectDoc | null, AppError>> {
    return this.lireDocument(cleProjet(id));
  }

  /**
   * Detecte un travail non enregistre laisse par une session interrompue :
   * plantage du navigateur, machine eteinte, perte reseau (section 44).
   */
  async reprise(id: string): Promise<Result<EtatReprise, AppError>> {
    const meta = await this.lireMeta(id);
    if (meta === null || meta.autoLe === null) return ok({ type: 'aucune' });
    if (meta.enregistreLe !== null && meta.autoLe <= meta.enregistreLe)
      return ok({ type: 'aucune' });

    const automatique = await this.lireDocument(cleAuto(id));
    if (!automatique.ok) return automatique;
    if (automatique.value === null) return ok({ type: 'aucune' });

    return ok({
      type: 'disponible',
      automatique: automatique.value,
      autoLe: meta.autoLe,
      enregistreLe: meta.enregistreLe,
    });
  }

  /** Efface la proposition de reprise, une fois la decision prise. */
  async abandonnerReprise(id: string): Promise<Result<void, AppError>> {
    const supprime = await this.stockage.supprimer(cleAuto(id));
    if (!supprime.ok) return supprime;
    const meta = await this.lireMeta(id);
    if (meta === null) return ok(undefined);
    return this.ecrireMeta({ ...meta, autoLe: null });
  }

  async listerInstantanes(id: string): Promise<Result<string[], AppError>> {
    const liste = await this.stockage.lister(`${RACINE}/${id}/instantanes`);
    if (!liste.ok) return liste;
    return ok([...liste.value].sort().reverse());
  }

  async restaurerInstantane(cle: string): Promise<Result<ProjectDoc | null, AppError>> {
    return this.lireDocument(cle);
  }

  private async rotationInstantanes(id: string): Promise<void> {
    const liste = await this.listerInstantanes(id);
    if (!liste.ok) return;
    for (const vieux of liste.value.slice(this.maxInstantanes)) {
      await this.stockage.supprimer(vieux);
    }
  }

  async listerProjets(): Promise<Result<MetaProjet[], AppError>> {
    const liste = await this.stockage.lister(RACINE);
    if (!liste.ok) return liste;
    const ids = new Set<string>();
    for (const cle of liste.value) {
      const parts = cle.split('/');
      const id = parts[1];
      if (id !== undefined) ids.add(id);
    }
    const metas: MetaProjet[] = [];
    for (const id of ids) {
      const meta = await this.lireMeta(id);
      if (meta !== null) metas.push(meta);
    }
    metas.sort((a, b) => (b.enregistreLe ?? 0) - (a.enregistreLe ?? 0));
    return ok(metas);
  }

  async supprimerProjet(id: string): Promise<Result<void, AppError>> {
    const liste = await this.stockage.lister(`${RACINE}/${id}`);
    if (!liste.ok) return liste;
    for (const cle of liste.value) {
      const r = await this.stockage.supprimer(cle);
      if (!r.ok) return r;
    }
    for (const cle of [cleProjet(id), cleAuto(id), cleMeta(id)]) {
      const r = await this.stockage.supprimer(cle);
      if (!r.ok) return r;
    }
    const instantanes = await this.listerInstantanes(id);
    if (instantanes.ok) {
      for (const cle of instantanes.value) await this.stockage.supprimer(cle);
    }
    return ok(undefined);
  }
}

/** Duplique un projet sous une nouvelle identite (section 46, Enregistrer sous). */
export function dupliquerProjet(
  doc: ProjectDoc,
  nouvelId: string,
  nouveauNom: string,
  maintenant = new Date(),
): ProjectDoc {
  return {
    ...doc,
    id: nouvelId,
    name: nouveauNom,
    createdAt: maintenant.toISOString(),
    modifiedAt: maintenant.toISOString(),
  };
}

/**
 * Planificateur de sauvegarde automatique.
 *
 * Deux garde-fous :
 *   - une temporisation, pour ne pas ecrire a chaque frappe ;
 *   - un verrou d ecriture, pour qu une sauvegarde lente ne se chevauche pas
 *     avec la suivante et ne produise pas un fichier entrelace.
 */
/**
 * Le minuteur est injectable : les paquets du moteur ne dependent ni du typage
 * DOM ni de celui de Node, et un test doit pouvoir controler le temps.
 */
declare const setTimeout: (fn: () => void, ms: number) => unknown;
declare const clearTimeout: (id: unknown) => void;

export interface OptionsAutosave {
  readonly delaiMs?: number;
  readonly minuteur?: (fn: () => void, ms: number) => unknown;
  readonly annuler?: (id: unknown) => void;
}

export class Autosave {
  private minuterie: unknown = null;
  private enCours = false;
  private enAttente: ProjectDoc | null = null;
  private readonly delaiMs: number;
  private readonly minuteur: (fn: () => void, ms: number) => unknown;
  private readonly annulerMinuterie: (id: unknown) => void;
  private derniereErreur: AppError | null = null;

  constructor(
    private readonly store: ProjectStore,
    options: OptionsAutosave = {},
  ) {
    this.delaiMs = options.delaiMs ?? 2000;
    this.minuteur = options.minuteur ?? ((fn, ms) => setTimeout(fn, ms));
    this.annulerMinuterie = options.annuler ?? ((id) => clearTimeout(id));
  }

  /** Signale une modification. L ecriture reelle est differee. */
  planifier(doc: ProjectDoc): void {
    this.enAttente = doc;
    if (this.minuterie !== null) this.annulerMinuterie(this.minuterie);
    this.minuterie = this.minuteur(() => {
      this.minuterie = null;
      void this.ecrireMaintenant();
    }, this.delaiMs);
  }

  /** Force l ecriture immediate. Utile avant de fermer l onglet. */
  async ecrireMaintenant(): Promise<Result<void, AppError> | null> {
    if (this.enCours) return null;
    const doc = this.enAttente;
    if (doc === null) return null;
    this.enAttente = null;
    this.enCours = true;
    try {
      const r = await this.store.autosauver(doc);
      this.derniereErreur = r.ok ? null : r.error;
      return r;
    } finally {
      this.enCours = false;
      // Une modification survenue pendant l ecriture ne doit pas etre perdue.
      if (this.enAttente !== null) this.planifier(this.enAttente);
    }
  }

  erreur(): AppError | null {
    return this.derniereErreur;
  }

  arreter(): void {
    if (this.minuterie !== null) this.annulerMinuterie(this.minuterie);
    this.minuterie = null;
  }
}

export function erreurStockageIndisponible(): AppError {
  return appError(
    'STORAGE_UNAVAILABLE',
    "Aucun stockage persistant n'est disponible dans ce navigateur.",
    {
      action: 'Exporter le projet manuellement',
      detail: "Le travail sera perdu à la fermeture de l'onglet.",
    },
  );
}
