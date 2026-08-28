/**
 * Lecture et ecriture du document de projet.
 *
 * L ecriture est DETERMINISTE : les cles sont triees, donc deux enregistrements
 * d un projet identique produisent des octets identiques. Cela rend les
 * sommes de controle fiables, les differences lisibles, et l autosave capable
 * de detecter qu il n y a rien a ecrire (section 44).
 */
import type { AppError, Result } from '@valideo/shared';
import { appError, err, ok, sha256Hex } from '@valideo/shared';
import type { ProjectDoc } from './schema.js';
import { migrateToCurrent } from './migrate.js';
import type { Migration, MigrationReport } from './migrate.js';

/** `JSON.stringify` a cles triees, recursivement. */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = stableValue(source[key]);
    }
    return out;
  }
  return value;
}

/** Serialise un projet de maniere reproductible. */
export function serializeProject(doc: ProjectDoc, pretty = true): string {
  return JSON.stringify(stableValue(doc), null, pretty ? 2 : 0);
}

/** Lit, migre et valide un projet depuis son texte JSON. */
export function deserializeProject(
  text: string,
  migrations?: readonly Migration[],
): Result<MigrationReport, AppError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return err(
      appError('PROJECT_CORRUPT', "Ce fichier n'est pas un JSON valide.", {
        detail: cause instanceof Error ? cause.message : String(cause),
      }),
    );
  }
  return migrations === undefined ? migrateToCurrent(raw) : migrateToCurrent(raw, migrations);
}

/** Empreinte stable du contenu, pour l autosave et la detection de modification. */
export function projectChecksum(doc: ProjectDoc): Promise<string> {
  return sha256Hex(serializeProject(doc, false));
}

export function touchProject(doc: ProjectDoc, now = new Date()): ProjectDoc {
  return { ...doc, modifiedAt: now.toISOString() };
}

export { ok };
