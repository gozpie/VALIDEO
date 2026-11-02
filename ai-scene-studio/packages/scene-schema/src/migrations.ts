import { CURRENT_SCHEMA_VERSION, type SceneDocument } from './scene';
import { validateScene, type SceneValidationIssue } from './validate';

/** Une migration transforme un document de la version N vers N+1, sans le muter. */
export type SceneMigration = (document: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registre des migrations, indexé par version source.
 * Exemple futur : `1: migrateV1toV2` transformera un document v1 en v2.
 */
export const SCENE_MIGRATIONS: Readonly<Record<number, SceneMigration>> = {};

export class SceneMigrationError extends Error {
  constructor(
    message: string,
    readonly issues: SceneValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'SceneMigrationError';
  }
}

function readVersion(document: Record<string, unknown>): number {
  const version = document['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SceneMigrationError('schemaVersion absent ou invalide');
  }
  return version;
}

/** Fait monter un document brut jusqu'à la version courante puis le valide intégralement. */
export function migrateScene(
  input: unknown,
  migrations: Readonly<Record<number, SceneMigration>> = SCENE_MIGRATIONS,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): SceneDocument {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SceneMigrationError('Le document de scène doit être un objet JSON');
  }
  let document = input as Record<string, unknown>;
  let version = readVersion(document);
  if (version > targetVersion) {
    throw new SceneMigrationError(
      `Version de schéma ${version} plus récente que la version supportée ${targetVersion}`,
    );
  }
  while (version < targetVersion) {
    const migrate = migrations[version];
    if (migrate === undefined) {
      throw new SceneMigrationError(`Aucune migration depuis la version ${version}`);
    }
    document = migrate(document);
    const next = readVersion(document);
    if (next !== version + 1) {
      throw new SceneMigrationError(`La migration ${version} a produit la version ${next}`);
    }
    version = next;
  }
  const result = validateScene(document);
  if (!result.success) {
    throw new SceneMigrationError('Document invalide après migration', result.issues);
  }
  return result.data;
}
