'use client';

import { useEffect } from 'react';
import { useEditorContext } from './context';
import {
  deleteSelection,
  duplicateSelection,
  groupSelection,
  toggleSelectionVisibility,
} from './commands';

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Raccourcis de l'éditeur (Cmd sur macOS, Ctrl ailleurs). Ignorés pendant la saisie dans un champ.
 * W/E/R : outils ; F : cadrer ; H : masquer ; Suppr : supprimer ; ⌘Z / ⇧⌘Z : annuler / rétablir ;
 * ⌘D : dupliquer ; ⌘G : grouper ; ⌘S : enregistrer ; Échap : désélectionner.
 */
export function useShortcuts({
  onSave,
  onToggleBoxSelect,
}: {
  onSave: () => void;
  onToggleBoxSelect: () => void;
}) {
  const { store, canEdit, viewport } = useEditorContext();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const state = store.getState();
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (mod && key === 's') return run(onSave);
      if (key === 'f' && !mod) return run(() => viewport.current?.frameSelection());
      if (key === 'escape') return run(() => state.select([]));
      if (!canEdit) return;
      if (mod && key === 'z') return run(event.shiftKey ? state.redo : state.undo);
      if (mod && key === 'y') return run(state.redo);
      if (mod && key === 'd') return run(() => duplicateSelection(store));
      if (mod && key === 'g') return run(() => groupSelection(store));
      if (mod) return;
      if (key === 'w') return run(() => state.setTool('translate'));
      if (key === 'e') return run(() => state.setTool('rotate'));
      if (key === 'r') return run(() => state.setTool('scale'));
      if (key === 'h') return run(() => toggleSelectionVisibility(store));
      if (key === 'b') return run(onToggleBoxSelect);
      if (key === 'delete' || key === 'backspace') return run(() => deleteSelection(store));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store, canEdit, viewport, onSave, onToggleBoxSelect]);
}
