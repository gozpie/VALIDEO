/**
 * Interface de stockage (sections 62 et 63).
 *
 * Le moteur ne doit dependre d aucun fournisseur particulier : disque local,
 * OPFS, S3, R2, NAS. Une seule interface, plusieurs implementations, et le
 * projet reste identique quelle que soit l origine des donnees.
 *
 * L interface est volontairement minuscule -- lire, ecrire, supprimer, lister.
 * Tout fournisseur imaginable sait faire ces quatre choses ; en demander plus
 * exclurait des cibles.
 */
import type { AppError, Result } from '@valideo/shared';

export interface StorageProvider {
  readonly nom: string;
  lire(cle: string): Promise<Result<Uint8Array | null, AppError>>;
  ecrire(cle: string, donnees: Uint8Array): Promise<Result<void, AppError>>;
  supprimer(cle: string): Promise<Result<void, AppError>>;
  lister(prefixe: string): Promise<Result<string[], AppError>>;
}

export interface EntreeStockage {
  readonly cle: string;
  readonly taille: number;
}
