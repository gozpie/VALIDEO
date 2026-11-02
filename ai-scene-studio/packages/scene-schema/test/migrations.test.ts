import { describe, expect, it } from 'vitest';
import { migrateScene, SceneMigrationError, type SceneMigration } from '../src';
import { loadSceneFixture } from './fixtures';

describe('migrateScene', () => {
  it('retourne un document v1 valide inchangé', () => {
    const raw = loadSceneFixture('cube-camera-animated.v1.json');
    expect(migrateScene(raw)).toEqual(raw);
  });

  it('refuse une version future', () => {
    expect(() => migrateScene({ schemaVersion: 99 })).toThrow(/plus récente/);
  });

  it('refuse un document sans version', () => {
    expect(() => migrateScene({})).toThrow(SceneMigrationError);
  });

  it("applique une chaîne de migrations jusqu'à la version cible", () => {
    const raw = loadSceneFixture('empty.v1.json');
    const calls: number[] = [];
    // Migration fictive v1 → v2 ; le document reste invalide car le schéma courant est v1.
    const migrations: Record<number, SceneMigration> = {
      1: (doc) => {
        calls.push(1);
        return { ...doc, schemaVersion: 2 };
      },
    };
    expect(() => migrateScene(raw, migrations, 2)).toThrow(/invalide après migration/);
    expect(calls).toEqual([1]);
  });

  it('refuse une chaîne de migrations incomplète', () => {
    expect(() => migrateScene(loadSceneFixture('empty.v1.json'), {}, 2)).toThrow(
      /Aucune migration depuis la version 1/,
    );
  });

  it('expose les erreurs de validation après migration', () => {
    const raw = { ...loadSceneFixture('empty.v1.json'), durationFrames: 0 };
    try {
      migrateScene(raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SceneMigrationError);
      expect((error as SceneMigrationError).issues.length).toBeGreaterThan(0);
    }
  });
});
