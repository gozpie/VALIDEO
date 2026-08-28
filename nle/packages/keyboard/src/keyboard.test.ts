import { describe, it, expect } from 'vitest';
import { isErr, isOk } from '@valideo/shared';
import { ChordError, chordFromEvent, chordKey, formatChord, parseChord } from './chord.js';
import type { KeyEventLike } from './chord.js';
import { ACTIONS, ACTION_IDS, actionById, actionsByCategory } from './actions.js';
import {
  KeyResolver,
  customize,
  findConflicts,
  findUnknownActions,
  keymap,
  validateKeymap,
} from './keymap.js';
import {
  AVID_LIKE_KEYMAP,
  DEFAULT_KEYMAP,
  FCP_LIKE_KEYMAP,
  PRESETS,
  presetById,
} from './presets.js';
import { ShuttleController, audioDuringShuttle } from './shuttle.js';

function press(code: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('combinaisons de touches', () => {
  it('accepte les lettres, chiffres et touches nommées', () => {
    expect(parseChord('j').code).toBe('KeyJ');
    expect(parseChord('Space').code).toBe('Space');
    expect(parseChord('1').code).toBe('Digit1');
    expect(parseChord('F5').code).toBe('F5');
    expect(parseChord('left').code).toBe('ArrowLeft');
    expect(parseChord('Comma').code).toBe('Comma');
  });

  it('lit les modificateurs dans n importe quel ordre', () => {
    expect(chordKey(parseChord('Mod+Shift+k'))).toBe(chordKey(parseChord('Shift+Mod+k')));
    expect(parseChord('Mod+z')).toMatchObject({ mod: true, code: 'KeyZ' });
    expect(parseChord('Alt+Shift+ArrowRight')).toMatchObject({ alt: true, shift: true });
  });

  it('refuse les combinaisons impossibles', () => {
    expect(() => parseChord('')).toThrow(ChordError);
    expect(() => parseChord('Mod+Shift')).toThrow(ChordError);
    expect(() => parseChord('a+b')).toThrow(ChordError);
    expect(() => parseChord('TrucBidule!')).toThrow(ChordError);
  });

  it('résout Mod selon la plateforme', () => {
    const cmd = press('KeyS', { metaKey: true });
    const ctrl = press('KeyS', { ctrlKey: true });
    expect(chordFromEvent(cmd, 'mac').mod).toBe(true);
    expect(chordFromEvent(cmd, 'other').mod).toBe(false);
    expect(chordFromEvent(ctrl, 'other').mod).toBe(true);
    expect(chordFromEvent(ctrl, 'mac').mod).toBe(false);
  });

  it('affiche les libellés selon la plateforme', () => {
    expect(formatChord(parseChord('Mod+s'), 'mac')).toBe('⌘S');
    expect(formatChord(parseChord('Mod+s'), 'other')).toBe('Ctrl+S');
    expect(formatChord(parseChord('Space'), 'other')).toBe('Espace');
    expect(formatChord(parseChord('Shift+ArrowLeft'), 'other')).toBe('Maj+←');
  });
});

describe('catalogue d actions', () => {
  it('couvre les touches exigées par §34', () => {
    const ids = ACTION_IDS;
    for (const id of [
      'playback.togglePlay',
      'playback.shuttleReverse',
      'playback.stop',
      'playback.shuttleForward',
      'marks.markIn',
      'marks.markOut',
      'edit.rippleTrimPrevious',
      'edit.rippleTrimNext',
      'tool.selection',
      'tool.razor',
      'tool.slip',
      'tool.slide',
      'edit.insert',
      'edit.overwrite',
      'marks.addMarker',
      'nav.start',
      'nav.end',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('donne un libellé et une catégorie à chaque action', () => {
    for (const action of ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0);
      expect(actionById(action.id)).toBe(action);
    }
    expect(actionsByCategory('outils').length).toBeGreaterThan(5);
  });

  it('n a aucun identifiant en double', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });
});

describe('tables de raccourcis', () => {
  it('les trois presets sont valides et sans conflit', () => {
    for (const preset of PRESETS) {
      expect(findUnknownActions(preset)).toEqual([]);
      const conflicts = findConflicts(preset);
      expect(conflicts, `${preset.id} : ${JSON.stringify(conflicts)}`).toEqual([]);
      expect(isOk(validateKeymap(preset))).toBe(true);
    }
    expect(presetById('avid-like')).toBe(AVID_LIKE_KEYMAP);
    expect(presetById('inconnu')).toBeUndefined();
  });

  it('détecte un conflit', () => {
    const bancal = keymap('bancal', 'Bancal', {
      'edit.insert': 'Comma',
      'edit.overwrite': 'Comma',
    });
    const conflicts = findConflicts(bancal);
    expect(conflicts).toHaveLength(1);
    expect([...(conflicts[0]?.actionIds ?? [])].sort()).toEqual(['edit.insert', 'edit.overwrite']);
    expect(isErr(validateKeymap(bancal))).toBe(true);
  });

  it('détecte une action inconnue', () => {
    const obsolete = keymap('obsolete', 'Obsolète', { 'edit.action.qui.nexiste.plus': 'F9' });
    expect(findUnknownActions(obsolete)).toEqual(['edit.action.qui.nexiste.plus']);
    expect(isErr(validateKeymap(obsolete))).toBe(true);
  });

  it('résout une touche vers son action', () => {
    const r = new KeyResolver(DEFAULT_KEYMAP, 'other');
    expect(r.resolve(press('Space'))).toBe('playback.togglePlay');
    expect(r.resolve(press('KeyI'))).toBe('marks.markIn');
    expect(r.resolve(press('KeyZ', { ctrlKey: true }))).toBe('edit.undo');
    expect(r.resolve(press('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('edit.redo');
    expect(r.resolve(press('F13'))).toBeNull();
  });

  it('distingue les contextes, le plus précis l emportant', () => {
    const map = keymap('ctx', 'Contextes', { 'edit.undo': 'KeyX' });
    const mixte = {
      id: 'mixte',
      label: 'Mixte',
      bindings: [
        ...map.bindings,
        { chord: parseChord('KeyX'), actionId: 'tool.razor', context: 'timeline' as const },
      ],
    };
    const r = new KeyResolver(mixte, 'other');
    expect(r.resolve(press('KeyX'), 'timeline')).toBe('tool.razor');
    expect(r.resolve(press('KeyX'), 'monitor')).toBe('edit.undo');
  });

  it('n applique pas Ctrl comme Mod sur macOS', () => {
    const r = new KeyResolver(DEFAULT_KEYMAP, 'mac');
    expect(r.resolve(press('KeyS', { metaKey: true }))).toBe('file.save');
    expect(r.resolve(press('KeyS', { ctrlKey: true }))).toBeNull();
  });

  it('liste les raccourcis d une action pour les menus', () => {
    const r = new KeyResolver(DEFAULT_KEYMAP, 'other');
    expect(r.chordsFor('edit.redo')).toContain('Ctrl+Maj+Z');
    expect(r.chordsFor('marks.markIn')).toEqual(['I']);
  });

  it('la personnalisation REMPLACE l ancienne touche au lieu de s ajouter', () => {
    const perso = customize(DEFAULT_KEYMAP, { 'marks.markIn': 'F1' });
    const r = new KeyResolver(perso, 'other');
    expect(r.resolve(press('F1'))).toBe('marks.markIn');
    // L ancienne touche ne doit plus rien déclencher pour cette action.
    expect(r.resolve(press('KeyI'))).toBeNull();
    expect(isOk(validateKeymap(perso))).toBe(true);
  });

  it('les presets diffèrent réellement entre eux', () => {
    const parDefaut = new KeyResolver(DEFAULT_KEYMAP, 'other');
    const avid = new KeyResolver(AVID_LIKE_KEYMAP, 'other');
    const fcp = new KeyResolver(FCP_LIKE_KEYMAP, 'other');
    expect(parDefaut.resolve(press('Comma'), 'timeline')).toBe('edit.insert');
    expect(avid.resolve(press('KeyV'), 'timeline')).toBe('edit.insert');
    expect(fcp.resolve(press('KeyW'), 'timeline')).toBe('edit.insert');
    // Mais JKL et Espace sont identiques partout : c est le socle commun.
    for (const r of [parDefaut, avid, fcp]) {
      expect(r.resolve(press('KeyJ'))).toBe('playback.shuttleReverse');
      expect(r.resolve(press('KeyL'))).toBe('playback.shuttleForward');
      expect(r.resolve(press('Space'))).toBe('playback.togglePlay');
    }
  });
});

describe('navigation JKL (§33)', () => {
  it('L monte les paliers d appui en appui', () => {
    const s = new ShuttleController();
    expect(s.rate()).toBe(0);
    s.pressL();
    expect(s.rate()).toBe(1);
    s.pressL();
    expect(s.rate()).toBe(2);
    s.pressL();
    expect(s.rate()).toBe(3);
    s.pressL();
    expect(s.rate()).toBe(4);
  });

  it('J fait de même en arrière', () => {
    const s = new ShuttleController();
    s.pressJ();
    expect(s.rate()).toBe(-1);
    s.pressJ();
    expect(s.rate()).toBe(-2);
    expect(s.state()).toBe('reverse');
  });

  it('la touche opposée RALENTIT au lieu d inverser brutalement', () => {
    const s = new ShuttleController();
    s.pressL();
    s.pressL();
    s.pressL();
    expect(s.rate()).toBe(3);
    s.pressJ();
    expect(s.rate()).toBe(2);
    s.pressJ();
    expect(s.rate()).toBe(1);
    s.pressJ();
    expect(s.rate()).toBe(0); // passage par l arrêt
    s.pressJ();
    expect(s.rate()).toBe(-1); // puis inversion
  });

  it('K arrête immédiatement', () => {
    const s = new ShuttleController();
    s.pressL();
    s.pressL();
    s.pressK();
    expect(s.rate()).toBe(0);
    expect(s.state()).toBe('stopped');
  });

  it('K maintenu transforme J et L en ralenti', () => {
    const s = new ShuttleController();
    s.pressK();
    s.pressL();
    expect(s.rate()).toBe(0.5);
    expect(s.state()).toBe('slowForward');
    s.pressJ();
    expect(s.rate()).toBe(-0.5);
    expect(s.state()).toBe('slowReverse');
    s.releaseK();
    expect(s.rate()).toBe(0);
  });

  it('plafonne au dernier palier', () => {
    const s = new ShuttleController();
    for (let i = 0; i < 50; i += 1) s.pressL();
    expect(s.rate()).toBe(8);
    for (let i = 0; i < 100; i += 1) s.pressJ();
    expect(s.rate()).toBe(-8);
  });

  it('accepte des paliers personnalisés', () => {
    const s = new ShuttleController({ ladder: [1, 2, 4, 16], slowRate: 0.25 });
    s.pressL();
    s.pressL();
    s.pressL();
    expect(s.rate()).toBe(4);
    s.pressK();
    s.pressL();
    expect(s.rate()).toBe(0.25);
  });

  it('Espace bascule lecture et pause indépendamment', () => {
    const s = new ShuttleController();
    s.togglePlay();
    expect(s.rate()).toBe(1);
    s.togglePlay();
    expect(s.rate()).toBe(0);
    expect(s.isPlaying()).toBe(false);
  });
});

describe('son pendant le shuttle (§32)', () => {
  it('laisse entendre le son aux vitesses raisonnables', () => {
    expect(audioDuringShuttle(1)).toMatchObject({ audible: true, rate: 1 });
    expect(audioDuringShuttle(2)).toMatchObject({ audible: true });
    expect(audioDuringShuttle(-1)).toMatchObject({ audible: true, rate: -1 });
  });

  it('coupe le son au-delà du seuil, plutôt que produire un artefact', () => {
    expect(audioDuringShuttle(4).audible).toBe(false);
    expect(audioDuringShuttle(-8).audible).toBe(false);
    expect(audioDuringShuttle(0).audible).toBe(false);
  });

  it('respecte les options', () => {
    expect(audioDuringShuttle(4, { maxAudibleRate: 8 }).audible).toBe(true);
    expect(audioDuringShuttle(-1, { audibleInReverse: false }).audible).toBe(false);
    expect(audioDuringShuttle(1, { preservePitch: true }).preservePitch).toBe(true);
  });
});
