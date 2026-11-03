import { describe, expect, it } from 'vitest';
import { migrateScene, SceneMigrationError, type SceneMigration } from '../src';
import { loadSceneFixture } from './fixtures';

describe('migrateScene', () => {
  it('migre un document v1 vers v2 (fixtures avant/après)', () => {
    for (const name of ['empty', 'cube-camera-animated']) {
      expect(migrateScene(loadSceneFixture(`${name}.v1.json`))).toEqual(
        loadSceneFixture(`${name}.v2.json`),
      );
    }
  });

  it('ne modifie pas le document source et laisse un document v2 inchangé', () => {
    const raw = loadSceneFixture('cube-camera-animated.v1.json');
    const before = structuredClone(raw);
    migrateScene(raw);
    expect(raw).toEqual(before);
    const current = loadSceneFixture('cube-camera-animated.v2.json');
    expect(migrateScene(current)).toEqual(current);
  });

  it('choisit la première caméra comme caméra active, ou aucune', () => {
    expect(migrateScene(loadSceneFixture('cube-camera-animated.v1.json')).activeCameraId).toBe(
      '20000000-0000-4000-8000-000000000001',
    );
    expect(migrateScene(loadSceneFixture('empty.v1.json')).activeCameraId).toBeNull();
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
    // Migration fictive v1 → v2 incomplète : le document reste invalide pour le schéma v2.
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
