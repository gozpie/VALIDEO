/**
 * Migrations de schema de projet (section 45).
 *
 * Un projet ouvert dans deux ans doit pouvoir etre relu. La regle est donc :
 * on ne modifie JAMAIS le schema d une version publiee, on ajoute une version
 * et une migration. Le chemin v1 -> v2 -> v3 est applique automatiquement.
 *
 * Un projet ecrit par une version PLUS RECENTE que celle du logiciel est
 * refuse explicitement : retrograder un document ferait perdre des donnees
 * silencieusement, ce que la section 1003 interdit.
 */
import type { AppError } from '@valideo/shared';
import { appError, ok, err } from '@valideo/shared';
import type { Result } from '@valideo/shared';
import { ProjectSchema, PROJECT_SCHEMA_VERSION } from './schema.js';
import type { ProjectDoc } from './schema.js';

/** Document non encore valide, tel que lu sur disque. */
export type RawDocument = Record<string, unknown>;

export interface Migration {
  readonly from: number;
  readonly to: number;
  /** Ce que la migration change, pour le journal et le diagnostic. */
  readonly describe: string;
  migrate(doc: RawDocument): RawDocument;
}

/**
 * Registre des migrations de production.
 *
 * Vide a ce jour : la version 1 est la premiere version publiee, il n y a rien
 * a migrer. Le mecanisme, lui, est complet et teste (voir migrate.test.ts) ;
 * il n est donc pas un `TODO` deguise.
 */
export const MIGRATIONS: readonly Migration[] = [];

export interface MigrationReport {
  readonly document: ProjectDoc;
  /** Etapes reellement appliquees, dans l ordre. */
  readonly applied: readonly string[];
  readonly fromVersion: number;
}

function readVersion(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = (raw as RawDocument)['schemaVersion'];
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

/**
 * Amene un document quelconque a la version courante, puis le valide.
 *
 * Retourne un `Err` porteur d un message affichable : un projet illisible est
 * une issue normale du point de vue de l utilisateur, pas un plantage.
 */
export function migrateToCurrent(
  raw: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
): Result<MigrationReport, AppError> {
  const version = readVersion(raw);
  if (version === null) {
    return err(
      appError('PROJECT_CORRUPT', "Ce fichier n'est pas un projet VALIDEO.", {
        detail: "Le champ 'schemaVersion' est absent ou n'est pas un entier.",
      }),
    );
  }

  if (version > PROJECT_SCHEMA_VERSION) {
    return err(
      appError(
        'PROJECT_SCHEMA_TOO_NEW',
        `Ce projet a été enregistré par une version plus récente du logiciel (schéma v${version}).`,
        {
          action: 'Mettre à jour VALIDEO',
          detail: `Version de schéma lue : ${version}. Version supportée : ${PROJECT_SCHEMA_VERSION}.`,
        },
      ),
    );
  }

  let current = raw as RawDocument;
  let at = version;
  const applied: string[] = [];

  while (at < PROJECT_SCHEMA_VERSION) {
    const step = migrations.find((m) => m.from === at);
    if (step === undefined) {
      return err(
        appError(
          'MIGRATION_FAILED',
          `Impossible de mettre à jour ce projet depuis le schéma v${at}.`,
          {
            detail: `Aucune migration enregistrée pour v${at} -> v${at + 1}.`,
          },
        ),
      );
    }
    try {
      current = step.migrate(current);
    } catch (cause) {
      return err(
        appError(
          'MIGRATION_FAILED',
          `La mise à jour du projet a échoué (v${step.from} -> v${step.to}).`,
          {
            detail: cause instanceof Error ? cause.message : String(cause),
          },
        ),
      );
    }
    if (readVersion(current) !== step.to) {
      return err(
        appError(
          'MIGRATION_FAILED',
          `La mise à jour du projet a échoué (v${step.from} -> v${step.to}).`,
          {
            detail: `La migration n'a pas positionné schemaVersion à ${step.to}.`,
          },
        ),
      );
    }
    applied.push(`v${step.from} -> v${step.to} : ${step.describe}`);
    at = step.to;
  }

  const parsed = ProjectSchema.safeParse(current);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined ? '' : `${first.path.join('.')} : ${first.message}`;
    return err(
      appError(
        'PROJECT_CORRUPT',
        'Ce projet est illisible : sa structure ne correspond pas au schéma.',
        {
          detail: `${parsed.error.issues.length} problème(s). Premier : ${where}`,
        },
      ),
    );
  }

  return ok({ document: parsed.data, applied, fromVersion: version });
}
