'use client';

import { copyKeys, pasteKeys, removeKeys } from '@ass/animation-engine';
import type { AxisLock } from '@ass/editor-ui';
import { useEffect, useRef } from 'react';
import {
  clearParentOfSelection,
  clearTransform,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  jumpToKeyframe,
  keySelection,
  parentToActive,
  selectAll,
  setOthersVisibility,
  toggleSelectionVisibility,
  unkeySelection,
} from './commands';
import { useEditorContext } from './context';
import type { Keymap } from './keymap';
import type { ViewDirection } from './Viewport';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** Axes de Blender (Z vers le haut) → axes canoniques (Y vers le haut) pour la contrainte du gizmo. */
const BLENDER_AXIS: Record<string, AxisLock> = { KeyX: 'x', KeyY: 'z', KeyZ: 'y' };
/** Pavé numérique (et chiffres du clavier, comme l'option « émuler le pavé numérique » de Blender). */
const NUMPAD_VIEWS: Record<string, [ViewDirection, ViewDirection]> = {
  '1': ['front', 'back'],
  '3': ['right', 'left'],
  '7': ['top', 'bottom'],
};

export interface ShortcutHandlers {
  keymap: Keymap;
  onSave: () => void;
  onToggleBoxSelect: () => void;
  onView: (direction: ViewDirection) => void;
  onToggleProjection: () => void;
  onAddMenu: () => void;
}

/**
 * Raccourcis de l'éditeur. Deux dispositions : « blender » (par défaut, conventions de Blender) et
 * « standard ». Cmd sur macOS équivaut à Ctrl. Ignorés pendant la saisie dans un champ.
 * Le détail des deux dispositions est affiché dans l'aide de l'éditeur (`keymap.ts`).
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const { store, canEdit, viewport } = useEditorContext();
  const latest = useRef(handlers);
  latest.current = handlers;
  // Après G, R ou S, les touches X, Y, Z contraignent l'axe (sinon X supprime, comme dans Blender).
  const axisMode = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const { keymap, onSave, onToggleBoxSelect, onView, onToggleProjection, onAddMenu } =
        latest.current;
      const blender = keymap === 'blender';
      const mod = event.metaKey || event.ctrlKey;
      const { code, shiftKey: shift, altKey: alt } = event;
      const key = event.key.toLowerCase();
      const state = store.getState();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      const wasAxisMode = axisMode.current;
      axisMode.current = false;

      // Communs aux deux dispositions.
      if (mod && code === 'KeyS') return run(onSave);
      if (key === 'escape') {
        return run(() => {
          state.select([]);
          state.selectKeys([]);
          state.setAxisLock(null);
        });
      }
      if (code === 'Space') return run(() => state.setPlaying(!state.playing));
      if (key === 'arrowleft' || key === 'arrowright') {
        const forward = key === 'arrowright';
        if (blender && shift)
          return run(() => state.setFrame(forward ? state.scene.durationFrames - 1 : 0));
        return run(() => state.setFrame(state.frame + (forward ? 1 : -1) * (shift ? 10 : 1)));
      }
      if (blender && (key === 'arrowup' || key === 'arrowdown')) {
        return run(() => jumpToKeyframe(store, key === 'arrowup' ? 1 : -1));
      }
      if (mod && code === 'KeyC' && state.keySelection.length > 0) {
        return run(() => state.setClipboard(copyKeys(state.scene, state.keySelection)));
      }
      if (blender) {
        const digit = code.replace(/^(Numpad|Digit)/, '');
        const views = NUMPAD_VIEWS[digit];
        if (views && !alt && !shift) return run(() => onView(views[mod ? 1 : 0]));
        if (digit === '5' && !mod) return run(onToggleProjection);
        if (digit === '0' && !mod) {
          return run(() => state.setCameraView(state.cameraView === 'camera' ? 'free' : 'camera'));
        }
        if (code === 'NumpadDecimal' || (code === 'Period' && !mod)) {
          return run(() => viewport.current?.frameSelection());
        }
        if (key === 'home') return run(() => viewport.current?.frameAll());
        if (code === 'KeyA' && !mod && !shift) return run(() => selectAll(store, !alt));
        if (code === 'KeyB' && !mod) return run(onToggleBoxSelect);
      } else {
        if (key === 'f' && !mod) return run(() => viewport.current?.frameSelection());
        if (key === 'home') return run(() => state.setFrame(0));
        if (key === 'end') return run(() => state.setFrame(state.scene.durationFrames - 1));
        if (code === 'KeyB' && !mod) return run(onToggleBoxSelect);
      }

      if (!canEdit) return;
      if (mod && code === 'KeyZ') return run(shift ? state.redo : state.undo);
      if (mod && code === 'KeyY') return run(state.redo);
      if (mod && code === 'KeyD') return run(() => duplicateSelection(store));
      if (mod && code === 'KeyV' && state.clipboard.length > 0) {
        return run(() => state.apply((s) => pasteKeys(s, state.clipboard, state.frame)));
      }
      if ((key === 'delete' || key === 'backspace') && !mod) {
        if (state.keySelection.length > 0) {
          return run(() => {
            state.apply((s) => removeKeys(s, state.keySelection));
            state.selectKeys([]);
          });
        }
        return run(() => deleteSelection(store));
      }
      if (code === 'KeyK' && !mod && !alt) return run(() => keySelection(store));

      if (blender) {
        const tools = { KeyG: 'translate', KeyR: 'rotate', KeyS: 'scale' } as const;
        if (code in tools && !mod && !shift) {
          const field = { KeyG: 'position', KeyR: 'rotation', KeyS: 'scale' } as const;
          if (alt) return run(() => clearTransform(store, field[code as keyof typeof field]));
          return run(() => {
            state.setTool(tools[code as keyof typeof tools]);
            axisMode.current = true;
          });
        }
        if (code in BLENDER_AXIS && !mod && !alt && wasAxisMode) {
          return run(() => {
            const axis = BLENDER_AXIS[code] ?? null;
            state.setAxisLock(state.axisLock === axis ? null : axis);
            axisMode.current = true;
          });
        }
        if (code === 'KeyX' && !mod) return run(() => deleteSelection(store));
        if (shift && code === 'KeyA') return run(onAddMenu);
        if (shift && code === 'KeyD') return run(() => duplicateSelection(store));
        if (code === 'KeyH' && !mod) {
          if (alt) return run(() => setOthersVisibility(store, 'unhide-all'));
          if (shift) return run(() => setOthersVisibility(store, 'hide-unselected'));
          return run(() => toggleSelectionVisibility(store));
        }
        if (code === 'KeyP' && mod) return run(() => parentToActive(store));
        if (code === 'KeyP' && alt) return run(() => clearParentOfSelection(store));
        if (code === 'KeyI' && !mod)
          return run(() => (alt ? unkeySelection(store) : keySelection(store)));
        return;
      }

      if (mod && code === 'KeyG') return run(() => groupSelection(store));
      if (mod) return;
      if (code === 'KeyW') return run(() => state.setTool('translate'));
      if (code === 'KeyE') return run(() => state.setTool('rotate'));
      if (code === 'KeyR') return run(() => state.setTool('scale'));
      if (code === 'KeyH') return run(() => toggleSelectionVisibility(store));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, canEdit, viewport]);
}
