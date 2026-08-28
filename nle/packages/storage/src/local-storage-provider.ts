/**
 * Fournisseur base sur `localStorage`.
 *
 * Repli quand OPFS n est pas disponible. Ses limites sont reelles et doivent
 * etre assumees : quelques mega-octets seulement, ecriture synchrone bloquante,
 * et stockage de chaines. On encode donc en base64, ce qui coute 33 % de
 * volume. Il convient a un document de projet, PAS a des proxies ni a des pics
 * audio.
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok } from '@valideo/shared';
import type { StorageProvider } from './provider.js';

export interface StockageCleValeur {
  getItem(cle: string): string | null;
  setItem(cle: string, valeur: string): void;
  removeItem(cle: string): void;
  readonly length: number;
  key(index: number): string | null;
}

declare const btoa: (donnees: string) => string;
declare const atob: (donnees: string) => string;

function versBase64(donnees: Uint8Array): string {
  let binaire = '';
  for (let i = 0; i < donnees.length; i += 1) binaire += String.fromCharCode(donnees[i] ?? 0);
  return btoa(binaire);
}

function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte);
  const out = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) out[i] = binaire.charCodeAt(i);
  return out;
}

const PREFIXE = 'valideo:';

export class LocalStorageProvider implements StorageProvider {
  readonly nom = 'localStorage';

  constructor(private readonly stockage: StockageCleValeur) {}

  lire(cle: string): Promise<Result<Uint8Array | null, AppError>> {
    const valeur = this.stockage.getItem(PREFIXE + cle);
    if (valeur === null) return Promise.resolve(ok(null));
    try {
      return Promise.resolve(ok(depuisBase64(valeur)));
    } catch (cause) {
      return Promise.resolve(
        err(
          appError('STORAGE_UNAVAILABLE', 'Une donnée enregistrée est illisible.', {
            detail: `${cle} — ${cause instanceof Error ? cause.message : String(cause)}`,
          }),
        ),
      );
    }
  }

  ecrire(cle: string, donnees: Uint8Array): Promise<Result<void, AppError>> {
    try {
      this.stockage.setItem(PREFIXE + cle, versBase64(donnees));
      return Promise.resolve(ok(undefined));
    } catch (cause) {
      // `localStorage` lève QuotaExceededError bien avant les autres stockages.
      return Promise.resolve(
        err(
          appError('INSUFFICIENT_DISK_SPACE', "L'espace de stockage du navigateur est saturé.", {
            action: 'Enregistrer le projet sur disque',
            detail: cause instanceof Error ? cause.message : String(cause),
            retryable: true,
          }),
        ),
      );
    }
  }

  supprimer(cle: string): Promise<Result<void, AppError>> {
    this.stockage.removeItem(PREFIXE + cle);
    return Promise.resolve(ok(undefined));
  }

  lister(prefixe: string): Promise<Result<string[], AppError>> {
    const out: string[] = [];
    for (let i = 0; i < this.stockage.length; i += 1) {
      const cle = this.stockage.key(i);
      if (cle === null || !cle.startsWith(PREFIXE)) continue;
      const nue = cle.slice(PREFIXE.length);
      if (nue.startsWith(prefixe)) out.push(nue);
    }
    return Promise.resolve(ok(out.sort()));
  }
}
