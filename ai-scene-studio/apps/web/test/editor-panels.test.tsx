import { createEditorStore } from '@ass/editor-ui';
import { addEntity, createGroupNode, createPrimitiveNode } from '@ass/scene-engine';
import { createEmptyScene } from '@ass/scene-schema';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { EditorContext } from '@/editor/context';
import { Hierarchy } from '@/editor/Hierarchy';
import { Inspector } from '@/editor/Inspector';

function setup(canEdit = true) {
  const group = createGroupNode('Décor');
  const cube = { ...createPrimitiveNode('cube'), parentId: group.id };
  const scene = addEntity(
    addEntity(createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000dd' }), {
      kind: 'node',
      value: group,
    }),
    { kind: 'node', value: cube },
  );
  const store = createEditorStore(scene);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EditorContext.Provider
      value={{
        store,
        canEdit,
        objects: new Map(),
        viewport: { current: null },
        assetUrl: (id) => id,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
  return { store, cube, group, wrapper };
}

describe('panneaux de l’éditeur', () => {
  it('affiche la hiérarchie et sélectionne au clic', () => {
    const { store, cube, wrapper } = setup();
    render(
      <>
        <Hierarchy />
        <Inspector />
      </>,
      { wrapper },
    );
    expect(screen.getByRole('treeitem', { name: 'Décor' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('treeitem', { name: 'Cube' }));
    expect(store.getState().selection).toEqual([cube.id]);
    expect(screen.getByLabelText('Position Y')).toHaveValue(0.5);
  });

  it('modifie la position depuis l’inspecteur et l’inscrit dans l’historique', () => {
    const { store, cube, wrapper } = setup();
    store.getState().select([cube.id]);
    render(<Inspector />, { wrapper });
    const x = screen.getByLabelText('Position X');
    fireEvent.change(x, { target: { value: '3.5' } });
    fireEvent.blur(x);
    expect(store.getState().scene.nodes[1]!.transform.position).toEqual([3.5, 0.5, 0]);
    expect(store.getState().past).toHaveLength(1);
  });

  it('masque et verrouille depuis la hiérarchie ; un objet verrouillé est en lecture seule', () => {
    const { store, cube, wrapper } = setup();
    render(
      <>
        <Hierarchy />
        <Inspector />
      </>,
      { wrapper },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Masquer Cube' }));
    expect(store.getState().scene.nodes[1]!.visible).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Verrouiller Cube' }));
    act(() => store.getState().select([cube.id]));
    expect(screen.getByLabelText('Position X')).toBeDisabled();
  });

  it('n’offre aucune modification en lecture seule', () => {
    const { store, cube, wrapper } = setup(false);
    store.getState().select([cube.id]);
    render(
      <>
        <Hierarchy />
        <Inspector />
      </>,
      { wrapper },
    );
    expect(screen.queryByRole('button', { name: 'Masquer Cube' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull();
    expect(screen.getByLabelText('Position X')).toBeDisabled();
  });
});
