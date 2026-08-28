/**
 * Fournisseur OPFS (Origin Private File System, section 3).
 *
 * C est le stockage local rapide du navigateur : un vrai systeme de fichiers,
 * sans boite de dialogue, avec des quotas bien plus larges que localStorage.
 * C est la cible naturelle pour les projets, les proxies, les vignettes et les
 * pics audio.
 *
 * Les types du DOM ne sont pas importes : le paquet doit rester utilisable dans
 * un Worker comme sur serveur. On declare donc localement la surface utilisee.
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import type { StorageProvider } from './provider.js';

interface FichierOpfs {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

interface RepertoireOpfs {
  getFileHandle(nom: string, options?: { create?: boolean }): Promise<FichierOpfs>;
  getDirectoryHandle(nom: string, options?: { create?: boolean }): Promise<RepertoireOpfs>;
  removeEntry(nom: string, options?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterableIterator<string>;
}

export interface RacineOpfs {
  getDirectory(): Promise<RepertoireOpfs>;
}

function echec(operation: string, cle: string, cause: unknown): AppError {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (message.includes('Quota') || message.includes('quota')) {
    return appError('INSUFFICIENT_DISK_SPACE', "L'espace de stockage du navigateur est saturé.", {
      action: 'Libérer de l’espace',
      detail: message,
      retryable: true,
    });
  }
  return appError(
    'STORAGE_UNAVAILABLE',
    `Le stockage local a refusé l'opération « ${operation} ».`,
    {
      detail: `${cle} — ${message}`,
      retryable: true,
    },
  );
}

/**
 * Les cles sont plates ; le `/` sert de separateur de repertoire. On evite ainsi
 * a l appelant de manipuler des poignees de repertoire.
 */
export class OpfsProvider implements StorageProvider {
  readonly nom = 'OPFS';

  constructor(private readonly racine: RacineOpfs) {}

  private async dossier(chemin: readonly string[], creer: boolean): Promise<RepertoireOpfs> {
    let courant = await this.racine.getDirectory();
    for (const segment of chemin) {
      courant = await courant.getDirectoryHandle(segment, { create: creer });
    }
    return courant;
  }

  private static decouper(cle: string): { chemin: string[]; nom: string } {
    const parts = cle.split('/').filter((p) => p !== '');
    const nom = parts.pop() ?? cle;
    return { chemin: parts, nom };
  }

  async lire(cle: string): Promise<Result<Uint8Array | null, AppError>> {
    const { chemin, nom } = OpfsProvider.decouper(cle);
    try {
      const dossier = await this.dossier(chemin, false);
      const fichier = await dossier.getFileHandle(nom);
      const donnees = await (await fichier.getFile()).arrayBuffer();
      return ok(new Uint8Array(donnees));
    } catch (cause) {
      // Un fichier absent n est pas une erreur : c est une absence.
      const message = cause instanceof Error ? cause.name : '';
      if (message === 'NotFoundError') return ok(null);
      return err(echec('lecture', cle, cause));
    }
  }

  async ecrire(cle: string, donnees: Uint8Array): Promise<Result<void, AppError>> {
    const { chemin, nom } = OpfsProvider.decouper(cle);
    try {
      const dossier = await this.dossier(chemin, true);
      const fichier = await dossier.getFileHandle(nom, { create: true });
      const flux = await fichier.createWritable();
      await flux.write(donnees);
      await flux.close();
      return ok(undefined);
    } catch (cause) {
      return err(echec('écriture', cle, cause));
    }
  }

  async supprimer(cle: string): Promise<Result<void, AppError>> {
    const { chemin, nom } = OpfsProvider.decouper(cle);
    try {
      const dossier = await this.dossier(chemin, false);
      await dossier.removeEntry(nom, { recursive: true });
      return ok(undefined);
    } catch (cause) {
      const message = cause instanceof Error ? cause.name : '';
      if (message === 'NotFoundError') return ok(undefined);
      return err(echec('suppression', cle, cause));
    }
  }

  async lister(prefixe: string): Promise<Result<string[], AppError>> {
    const { chemin } = OpfsProvider.decouper(`${prefixe}/x`);
    try {
      const dossier = await this.dossier(chemin, false);
      const noms: string[] = [];
      for await (const nom of dossier.keys()) noms.push(`${chemin.join('/')}/${nom}`);
      return ok(noms.filter((c) => c.startsWith(prefixe)).sort());
    } catch (cause) {
      const message = cause instanceof Error ? cause.name : '';
      if (message === 'NotFoundError') return ok([]);
      return err(echec('listage', prefixe, cause));
    }
  }
}

/** Construit un fournisseur OPFS si le navigateur le permet, sinon `null`. */
export function opfsDisponible(
  navigateur: { storage?: RacineOpfs } | undefined,
): OpfsProvider | null {
  const stockage = navigateur?.storage;
  if (stockage === undefined || typeof stockage.getDirectory !== 'function') return null;
  return new OpfsProvider(stockage);
}
