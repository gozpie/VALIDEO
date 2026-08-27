/**
 * Presets de raccourcis (section 34).
 *
 * Le preset par defaut suit les conventions des NLE professionnels, celles
 * qu un monteur a dans les doigts : JKL pour la navigation, I et O pour les
 * points d entree et de sortie, virgule et point pour Insert et Overwrite,
 * Q et W pour le ripple trim, et la rangee de gauche pour les outils.
 *
 * Aucun asset, aucune marque, aucun fichier tiers n est repris : seules les
 * CONVENTIONS ergonomiques le sont, ce qu autorise explicitement le cahier des
 * charges.
 */
import { keymap } from './keymap.js';
import type { KeyMap } from './keymap.js';

const COMMON = {
  'playback.togglePlay': 'Space',
  'playback.shuttleReverse': 'j',
  'playback.stop': 'k',
  'playback.shuttleForward': 'l',
  'playback.loop': 'Mod+l',
  'playback.playAroundEdit': 'Shift+k',

  'nav.nextFrame': 'ArrowRight',
  'nav.previousFrame': 'ArrowLeft',
  'nav.nextFrame5': 'Shift+ArrowRight',
  'nav.previousFrame5': 'Shift+ArrowLeft',
  'nav.nextEdit': 'ArrowDown',
  'nav.previousEdit': 'ArrowUp',
  'nav.start': 'Home',
  'nav.end': 'End',
  'nav.nextMarker': 'Shift+m',
  'nav.previousMarker': 'Mod+Shift+m',

  'marks.markIn': 'i',
  'marks.markOut': 'o',
  'marks.clearIn': 'Mod+Shift+i',
  'marks.clearOut': 'Mod+Shift+o',
  'marks.goToIn': 'Shift+i',
  'marks.goToOut': 'Shift+o',
  'marks.addMarker': 'm',

  'edit.undo': 'Mod+z',
  'edit.redo': ['Mod+Shift+z', 'Mod+y'],
  'edit.cut': 'Mod+x',
  'edit.copy': 'Mod+c',
  'edit.paste': 'Mod+v',
  'edit.pasteInsert': 'Mod+Shift+v',
  'edit.selectAll': 'Mod+a',
  'edit.nest': 'Mod+Shift+n',
  'edit.group': 'Mod+g',
  'edit.linkToggle': 'Mod+Shift+l',
  'edit.speedDuration': 'Mod+r',

  'timeline.zoomIn': 'Equal',
  'timeline.zoomOut': 'Minus',
  'timeline.zoomToFit': 'Backslash',
  'timeline.toggleSnap': 's',
  'timeline.maximizePanel': 'Backquote',
  'timeline.toggleFullscreen': 'Mod+Backquote',

  'file.save': 'Mod+s',
  'file.saveAs': 'Mod+Shift+s',
  'file.import': 'Mod+i',
  'file.export': 'Mod+m',
  'file.commandPalette': 'Mod+k',
} as const;

/** Preset par defaut : conventions communes aux NLE professionnels. */
export const DEFAULT_KEYMAP: KeyMap = keymap('default', 'Par défaut', {
  ...COMMON,
  'edit.insert': 'Comma',
  'edit.overwrite': 'Period',
  'edit.lift': 'Semicolon',
  'edit.extract': 'Quote',
  'edit.delete': 'Delete',
  'edit.rippleDelete': 'Shift+Delete',
  'edit.addEdit': 'Mod+k',
  'edit.rippleTrimPrevious': 'q',
  'edit.rippleTrimNext': 'w',

  'tool.selection': 'v',
  'tool.trackSelectForward': 'a',
  'tool.ripple': 'b',
  'tool.rolling': 'n',
  'tool.rateStretch': 'r',
  'tool.razor': 'c',
  'tool.slip': 'y',
  'tool.slide': 'u',
  'tool.pen': 'p',
  'tool.hand': 'h',
  'tool.zoom': 'z',

  'track.toggleTargetV1': 'Mod+Digit1',
  'track.toggleTargetA1': 'Mod+Digit2',
});

/**
 * Variante « à la Avid » : le montage se fait sur la rangee du milieu, avec les
 * touches de raccord sous les doigts au repos.
 */
export const AVID_LIKE_KEYMAP: KeyMap = keymap('avid-like', 'Style Avid', {
  ...COMMON,
  'edit.insert': 'v',
  'edit.overwrite': 'b',
  'edit.lift': 'z',
  'edit.extract': 'x',
  'edit.delete': 'Delete',
  'edit.rippleDelete': 'Shift+Delete',
  'edit.addEdit': 'h',
  'edit.rippleTrimPrevious': 'Comma',
  'edit.rippleTrimNext': 'Period',

  'tool.selection': 'Digit1',
  'tool.trackSelectForward': 'Digit2',
  'tool.ripple': 'Digit3',
  'tool.rolling': 'Digit4',
  'tool.razor': 'Digit5',
  'tool.slip': 'Digit6',
  'tool.slide': 'Digit7',
  'tool.rateStretch': 'Digit8',
  'tool.pen': 'Digit9',
  'tool.hand': 'Digit0',
  'tool.zoom': 'Mod+Digit0',

  'track.toggleTargetV1': 'Mod+Digit1',
  'track.toggleTargetA1': 'Mod+Digit2',
});

/** Variante « à la Final Cut » : montage par les touches de la main gauche. */
export const FCP_LIKE_KEYMAP: KeyMap = keymap('fcp-like', 'Style Final Cut', {
  ...COMMON,
  'edit.insert': 'w',
  'edit.overwrite': 'd',
  // Dans ce style, Suppr EST l extract et Maj+Suppr EST le lift : ce sont les
  // memes commandes, pas quatre. On ne lie donc pas edit.delete ni
  // edit.rippleDelete, qui feraient double emploi sur les memes touches.
  'edit.lift': 'Shift+Delete',
  'edit.extract': 'Delete',
  'edit.addEdit': 'Mod+b',
  'edit.rippleTrimPrevious': 'q',
  'edit.rippleTrimNext': 'Shift+w',

  'tool.selection': 'a',
  'tool.trackSelectForward': 'Mod+a',
  'tool.ripple': 't',
  'tool.rolling': 'Shift+t',
  'tool.razor': 'b',
  'tool.slip': 'Shift+s',
  'tool.slide': 'Shift+d',
  'tool.rateStretch': 'Shift+r',
  'tool.pen': 'p',
  'tool.hand': 'h',
  'tool.zoom': 'z',

  'track.toggleTargetV1': 'Mod+Digit1',
  'track.toggleTargetA1': 'Mod+Digit2',
});

export const PRESETS: readonly KeyMap[] = [DEFAULT_KEYMAP, AVID_LIKE_KEYMAP, FCP_LIKE_KEYMAP];

export function presetById(id: string): KeyMap | undefined {
  return PRESETS.find((p) => p.id === id);
}
