'use client';

import type { EditorState } from '@ass/editor-ui';
import { createContext, useContext } from 'react';
import type { Object3D } from 'three';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';

/** Commandes de vue exécutées par le viewport (cadrage, vues prédéfinies). */
export interface ViewportApi {
  frameSelection: () => void;
  frameAll: () => void;
}

export interface EditorContextValue {
  store: StoreApi<EditorState>;
  canEdit: boolean;
  assetUrl: (assetId: string) => string;
  /** Objets Three.js de chaque entité affichée, pour le gizmo, le cadrage et la sélection rectangle. */
  objects: Map<string, Object3D>;
  viewport: { current: ViewportApi | null };
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext);
  if (!context) throw new Error('Composant de l’éditeur hors de <EditorContext>');
  return context;
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorContext().store, selector);
}
