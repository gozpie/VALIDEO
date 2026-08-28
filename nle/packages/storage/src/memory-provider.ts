/**
 * Fournisseur en memoire.
 *
 * Sert aux tests, et de repli quand aucun stockage persistant n est disponible.
 * Dans ce dernier cas l appelant DOIT le signaler a l utilisateur : un
 * enregistrement qui disparait a la fermeture de l onglet sans prevenir serait
 * une fausse persistance (section 1003).
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import type { StorageProvider } from './provider.js';

export class MemoryProvider implements StorageProvider {
  readonly nom = 'mémoire';
  private readonly donnees = new Map<string, Uint8Array>();
  /** Simule une saturation, pour tester le chemin d erreur. */
  quotaOctets: number | null = null;

  private tailleTotale(): number {
    let total = 0;
    for (const v of this.donnees.values()) total += v.byteLength;
    return total;
  }

  lire(cle: string): Promise<Result<Uint8Array | null, AppError>> {
    return Promise.resolve(ok(this.donnees.get(cle) ?? null));
  }

  ecrire(cle: string, donnees: Uint8Array): Promise<Result<void, AppError>> {
    if (this.quotaOctets !== null) {
      const apres =
        this.tailleTotale() - (this.donnees.get(cle)?.byteLength ?? 0) + donnees.byteLength;
      if (apres > this.quotaOctets) {
        return Promise.resolve(
          err(
            appError('INSUFFICIENT_DISK_SPACE', "L'espace de stockage est saturé.", {
              action: 'Libérer de l’espace',
              detail: `${apres} octets demandés pour un quota de ${this.quotaOctets}.`,
              retryable: true,
            }),
          ),
        );
      }
    }
    this.donnees.set(cle, donnees);
    return Promise.resolve(ok(undefined));
  }

  supprimer(cle: string): Promise<Result<void, AppError>> {
    this.donnees.delete(cle);
    return Promise.resolve(ok(undefined));
  }

  lister(prefixe: string): Promise<Result<string[], AppError>> {
    return Promise.resolve(
      ok([...this.donnees.keys()].filter((c) => c.startsWith(prefixe)).sort()),
    );
  }
}
