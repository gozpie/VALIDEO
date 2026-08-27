import { describe, it, expect } from 'vitest';
import { isErr, isOk, unwrap } from '@valideo/shared';
import { TIMEBASES } from '@valideo/time-core';
import { ProjectSchema, PROJECT_SCHEMA_VERSION } from './schema.js';
import { migrateToCurrent } from './migrate.js';
import type { Migration, RawDocument } from './migrate.js';
import {
  serializeProject,
  deserializeProject,
  projectChecksum,
  touchProject,
} from './serialize.js';
import {
  createProject,
  createSequence,
  createClip,
  createTrack,
  SEQUENCE_PRESETS,
  presetById,
  toTimeBaseDoc,
} from './defaults.js';

describe('fabriques', () => {
  it('cree un projet valide au regard du schema', () => {
    const p = createProject('Mon film');
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(p.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(p.sequences).toEqual([]);
    expect(p.bins).toHaveLength(1);
  });

  it('cree une sequence avec 3 pistes video et 4 pistes audio par defaut', () => {
    const s = createSequence('Séquence 01', { timebase: TIMEBASES.TB23_976 });
    expect(s.tracks.filter((t) => t.kind === 'video')).toHaveLength(3);
    expect(s.tracks.filter((t) => t.kind === 'audio')).toHaveLength(4);
    expect(s.timebase).toEqual({ rate: { n: 24000, d: 1001 }, mode: 'NDF' });
    expect(s.tracks[0]?.name).toBe('V1');
  });

  it('cible la premiere piste de chaque type', () => {
    const s = createSequence('S');
    const video = s.tracks.filter((t) => t.kind === 'video');
    const audio = s.tracks.filter((t) => t.kind === 'audio');
    expect(video.filter((t) => t.targeted)).toHaveLength(1);
    expect(audio.filter((t) => t.targeted)).toHaveLength(1);
    expect(video[0]?.targeted).toBe(true);
  });

  it('cree un clip valide', () => {
    const track = createTrack('video', 0);
    const clip = createClip('video', track.id, 100, 250, { name: 'A001' });
    expect(clip.start).toBe(100);
    expect(clip.duration).toBe(250);
    expect(clip.speed).toEqual({ n: 1, d: 1 });
    const s = createSequence('S');
    const withClip = { ...s, tracks: [{ ...track, clips: [clip] }, ...s.tracks.slice(1)] };
    expect(ProjectSchema.safeParse({ ...createProject('P'), sequences: [withClip] }).success).toBe(
      true,
    );
  });

  it('refuse une duree de clip nulle ou negative', () => {
    const track = createTrack('video', 0);
    const bad = { ...createClip('video', track.id, 0, 1), duration: 0 };
    const s = createSequence('S');
    const doc = {
      ...createProject('P'),
      sequences: [{ ...s, tracks: [{ ...track, clips: [bad] }] }],
    };
    expect(ProjectSchema.safeParse(doc).success).toBe(false);
  });

  it('expose les presets de la section 68', () => {
    expect(SEQUENCE_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(presetById('red-4k-23976')?.timebase.rate).toEqual({ n: 24000, d: 1001 });
    expect(presetById('xdcam-1080i-2997')?.timebase.mode).toBe('DF');
    expect(presetById('xdcam-1080i-2997')?.settings.fieldOrder).toBe('tff');
    expect(presetById('inconnu')).toBeUndefined();
  });

  it('convertit une TimeBase en document', () => {
    expect(toTimeBaseDoc(TIMEBASES.TB29_97_DF)).toEqual({
      rate: { n: 30000, d: 1001 },
      mode: 'DF',
    });
  });
});

describe('serialisation', () => {
  it('est deterministe malgre l ordre des cles', () => {
    const p = createProject('Projet');
    const shuffled = JSON.parse(JSON.stringify({ name: p.name, ...p })) as typeof p;
    expect(serializeProject(shuffled)).toBe(serializeProject(p));
  });

  it('fait l aller-retour sans perte', () => {
    const p = { ...createProject('Projet'), sequences: [createSequence('S1')] };
    const report = unwrap(deserializeProject(serializeProject(p)));
    expect(report.document.name).toBe('Projet');
    expect(report.document.sequences[0]?.tracks).toHaveLength(7);
    expect(report.applied).toEqual([]);
  });

  it('produit une empreinte stable et sensible au contenu', async () => {
    const p = createProject('Projet');
    expect(await projectChecksum(p)).toBe(await projectChecksum(p));
    expect(await projectChecksum(p)).not.toBe(await projectChecksum({ ...p, name: 'Autre' }));
  });

  it('touchProject ne change que la date de modification', () => {
    const p = createProject('P', new Date('2020-01-01T00:00:00.000Z'));
    const t = touchProject(p, new Date('2021-06-15T10:30:00.000Z'));
    expect(t.modifiedAt).toBe('2021-06-15T10:30:00.000Z');
    expect(t.createdAt).toBe(p.createdAt);
    expect(t.id).toBe(p.id);
  });

  it('rejette un JSON invalide avec un message affichable', () => {
    const r = deserializeProject('{ ceci n est pas du json');
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('PROJECT_CORRUPT');
      expect(r.error.detail).toBeTruthy();
    }
  });
});

describe('migrations', () => {
  it('accepte un document deja a la version courante', () => {
    const r = migrateToCurrent(createProject('P'));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.applied).toEqual([]);
  });

  it('refuse un document sans schemaVersion', () => {
    const r = migrateToCurrent({ name: 'sans version' });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('PROJECT_CORRUPT');
  });

  it('refuse un schema plus recent plutot que de retrograder', () => {
    const r = migrateToCurrent({ ...createProject('P'), schemaVersion: 99 });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('PROJECT_SCHEMA_TOO_NEW');
      expect(r.error.action).toBe('Mettre à jour VALIDEO');
    }
  });

  it('applique une chaine de migrations dans l ordre', () => {
    // Chaine de test v-2 -> v-1 -> v1, pour prouver que le mecanisme enchaine
    // reellement plusieurs etapes et non une seule.
    const steps: Migration[] = [
      {
        from: -2,
        to: -1,
        describe: 'ajoute le nom',
        migrate: (d: RawDocument) => ({ ...d, name: 'Récupéré', schemaVersion: -1 }),
      },
      {
        from: -1,
        to: PROJECT_SCHEMA_VERSION,
        describe: 'structure complete',
        migrate: (d: RawDocument) => ({
          ...createProject(String(d['name'])),
          schemaVersion: PROJECT_SCHEMA_VERSION,
        }),
      },
    ];
    const r = migrateToCurrent({ schemaVersion: -2 }, steps);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.document.name).toBe('Récupéré');
      expect(r.value.fromVersion).toBe(-2);
      expect(r.value.applied).toEqual([
        'v-2 -> v-1 : ajoute le nom',
        `v-1 -> v${PROJECT_SCHEMA_VERSION} : structure complete`,
      ]);
    }
  });

  it('echoue proprement quand il manque une etape', () => {
    const r = migrateToCurrent({ schemaVersion: -5 }, []);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('MIGRATION_FAILED');
      expect(r.error.detail).toContain('v-5');
    }
  });

  it('echoue proprement quand une migration leve', () => {
    const steps: Migration[] = [
      {
        from: 0,
        to: PROJECT_SCHEMA_VERSION,
        describe: 'casse',
        migrate: () => {
          throw new Error('disque illisible');
        },
      },
    ];
    const r = migrateToCurrent({ schemaVersion: 0 }, steps);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.detail).toContain('disque illisible');
  });

  it('detecte une migration qui oublie de mettre a jour schemaVersion', () => {
    const steps: Migration[] = [
      {
        from: 0,
        to: PROJECT_SCHEMA_VERSION,
        describe: 'oublieuse',
        migrate: (d: RawDocument) => ({ ...d }),
      },
    ];
    const r = migrateToCurrent({ schemaVersion: 0 }, steps);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.detail).toContain('schemaVersion');
  });

  it('signale un document migre mais structurellement invalide', () => {
    const steps: Migration[] = [
      {
        from: 0,
        to: PROJECT_SCHEMA_VERSION,
        describe: 'incomplete',
        migrate: () => ({ schemaVersion: PROJECT_SCHEMA_VERSION, name: 'X' }),
      },
    ];
    const r = migrateToCurrent({ schemaVersion: 0 }, steps);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe('PROJECT_CORRUPT');
      expect(r.error.detail).toContain('Premier');
    }
  });
});
