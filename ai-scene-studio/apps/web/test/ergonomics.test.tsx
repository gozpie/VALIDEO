import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '@/components/CommandPalette';
import { useContextMenu, type MenuItem } from '@/components/ContextMenu';
import { Toaster } from '@/components/Toaster';
import { commandStore, fuzzyScore, searchCommands, type Command } from '@/lib/commands';
import { evaluateExpression, tidy } from '@/lib/expression';
import { toast, toastStore } from '@/lib/toast';

describe('expressions des champs numériques', () => {
  it.each([
    ['2', 2],
    ['1,5', 1.5],
    ['1.5*2', 3],
    [' 2 + 3 * 4 ', 14],
    ['(2+3)*4', 20],
    ['-(3+1)/4', -1],
    ['90/4', 22.5],
    ['2^3^2', 512],
    ['-2^2', -4],
    ['10%4', 2],
    ['.5', 0.5],
    ['1e3', 1000],
  ])('%s = %s', (source, expected) => {
    expect(evaluateExpression(source)).toBe(expected);
  });

  it.each(['', 'abc', '2+', '(1', '1)', '1/0', 'alert(1)', '2**3', 'Math.PI'])(
    'refuse « %s »',
    (source) => {
      expect(evaluateExpression(source)).toBeNull();
    },
  );

  it('supprime le bruit flottant', () => {
    expect(tidy(0.1 + 0.2)).toBe(0.3);
    expect(Object.is(tidy(-0.0000001), 0)).toBe(true);
  });
});

const command = (id: string, label: string, group = 'Édition', extra: Partial<Command> = {}) => ({
  id,
  label,
  group,
  run: vi.fn(),
  ...extra,
});

describe('recherche floue', () => {
  it('trouve les lettres dans l’ordre, sans accents', () => {
    expect(fuzzyScore('dupl', 'Dupliquer la sélection')).not.toBeNull();
    expect(fuzzyScore('selection', 'Dupliquer la sélection')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Dupliquer')).toBeNull();
  });

  it('classe les débuts de mots avant les correspondances éparses', () => {
    const results = searchCommands(
      [command('a', 'Masquer le reste'), command('b', 'Rétablir'), command('c', 'Renommer')],
      're',
    );
    expect(results[0]!.id).toBe('b');
    expect(results.map((c) => c.id)).toContain('a');
  });
});

describe('palette de commandes', () => {
  afterEach(() => {
    act(() => {
      commandStore.getState().setOpen(false);
      commandStore.getState().setSource('test', null);
    });
  });

  it('s’ouvre avec ⌘K, filtre et exécute au clavier', () => {
    const duplicate = command('dup', 'Dupliquer la sélection');
    const save = command('save', 'Enregistrer la scène', 'Édition', { shortcut: '⌘S' });
    act(() => commandStore.getState().setSource('test', [duplicate, save]));
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = screen.getByRole('combobox', { name: 'Rechercher une commande' });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    fireEvent.change(input, { target: { value: 'enreg' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(save.run).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('n’exécute pas une commande désactivée', () => {
    const disabled = command('undo', 'Annuler', 'Édition', { disabled: true });
    act(() => commandStore.getState().setSource('test', [disabled]));
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'F3' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(disabled.run).not.toHaveBeenCalled();
    expect(screen.getByRole('option')).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('notifications', () => {
  it('affiche l’action et la déclenche une seule fois', () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      toast('« Cube » supprimé', { action: { label: 'Annuler', run: undo } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText('« Cube » supprimé')).toBeNull();
  });

  it('disparaît après sa durée', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast('Enregistré', { kind: 'success', duration: 1000 });
    });
    expect(screen.getByText('Enregistré')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.queryByText('Enregistré')).toBeNull();
    vi.useRealTimers();
  });

  it('garde au plus quatre notifications', () => {
    act(() => {
      for (let i = 0; i < 6; i++) toast(`n${i}`);
    });
    expect(toastStore.getState().toasts.map((t) => t.message)).toEqual(['n2', 'n3', 'n4', 'n5']);
    act(() => toastStore.setState({ toasts: [] }));
  });
});

function MenuHost({ items }: { items: MenuItem[] }) {
  const { open, menu } = useContextMenu();
  return (
    <div>
      <div data-testid="zone" onContextMenu={(event) => open(event, items)} />
      {menu}
    </div>
  );
}

describe('menu contextuel', () => {
  it('s’ouvre au clic droit, saute les éléments désactivés et se ferme avec Échap', () => {
    const rename = vi.fn();
    const remove = vi.fn();
    render(
      <MenuHost
        items={[
          { label: 'Renommer', disabled: true, run: rename },
          'separator',
          { label: 'Supprimer', danger: true, run: remove },
        ]}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId('zone'), { clientX: 10, clientY: 10 });
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(remove).toHaveBeenCalledOnce();
    expect(rename).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.contextMenu(screen.getByTestId('zone'), { clientX: 10, clientY: 10 });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
