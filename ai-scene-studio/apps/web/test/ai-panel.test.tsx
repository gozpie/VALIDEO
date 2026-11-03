import { createEditorStore } from '@ass/editor-ui';
import { createEmptyScene } from '@ass/scene-schema';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiPanel } from '@/editor/AiPanel';
import type * as ApiModule from '@/lib/api';
import { EditorContext } from '@/editor/context';

const calls: { method: string; path: string; body?: unknown }[] = [];
const ok = (data: unknown) => Promise.resolve({ data, response: { ok: true } as Response });

const PROVIDERS = [
  {
    id: 'higgsfield',
    label: 'Higgsfield',
    kind: 'bridge',
    available: true,
    reason: '',
    models: [
      {
        model: 'gpt_image_2_5',
        label: 'GPT Image 2.5',
        modes: ['text_to_image'],
        controls: [],
        maxReferenceImages: 4,
        durationsSeconds: [],
        aspectRatios: ['16:9'],
        notes: '',
      },
    ],
  },
];
const ESTIMATE = {
  amount: 3,
  unit: 'crédits Higgsfield',
  basis: '3 crédits par image',
  paid: true,
  mismatches: [],
  available: true,
  reason: '',
};

vi.mock('@/lib/api', async (original) => {
  const actual = await original<typeof ApiModule>();
  return {
    ...actual,
    api: {
      GET: (path: string) => {
        calls.push({ method: 'GET', path });
        return ok(path === '/ai/providers' ? PROVIDERS : []);
      },
      POST: (path: string, init: { body?: unknown }) => {
        calls.push({ method: 'POST', path, body: init.body });
        if (path.endsWith('/estimate')) return ok(ESTIMATE);
        return ok({
          id: 'job-1',
          status: 'queued',
          mode: 'text_to_image',
          provider: 'higgsfield',
          modelId: 'gpt_image_2_5',
          request: {},
          outputs: {},
          progress: 0,
          message: 'En attente',
          actualCost: null,
          costUnit: 'crédits Higgsfield',
          errorDetails: null,
        });
      },
    },
  };
});

function setup() {
  const store = createEditorStore(
    createEmptyScene({ sceneId: '00000000-0000-4000-8000-0000000000ee' }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EditorContext.Provider
      value={{
        store,
        canEdit: true,
        objects: new Map(),
        viewport: { current: null },
        assetUrl: (id) => id,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
  const onSave = vi.fn(() => Promise.resolve(true));
  render(<AiPanel shotId="shot-1" onSave={onSave} />, { wrapper });
  return { onSave };
}

const created = () =>
  calls.filter((c) => c.method === 'POST' && c.path === '/shots/{shot_id}/generations');

describe('panneau IA', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('exige la confirmation du montant exact avant une génération payante', async () => {
    setup();
    const promptField = await screen.findByPlaceholderText(/Décrivez le plan/);
    fireEvent.change(promptField, { target: { value: 'un phare dans la tempête' } });
    await screen.findByText('3 crédits Higgsfield — 3 crédits par image');
    fireEvent.click(screen.getByRole('button', { name: 'Générer' }));

    const dialog = screen.getByRole('alertdialog', { name: 'Confirmer la dépense' });
    expect(created()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(created()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Générer' }));
    expect(dialog).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer 3 crédits Higgsfield' }));
    });
    await waitFor(() => expect(created()).toHaveLength(1));
    expect(created()[0]?.body).toMatchObject({
      provider: 'higgsfield',
      model: 'gpt_image_2_5',
      prompt: 'un phare dans la tempête',
      confirmedCost: 3,
    });
  });

  it('ne lance rien sans prompt', async () => {
    setup();
    await screen.findByText('3 crédits Higgsfield — 3 crédits par image');
    expect(screen.getByRole('button', { name: 'Générer' })).toBeDisabled();
  });
});
