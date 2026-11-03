'use client';

import {
  childrenOf,
  renameEntity,
  setActiveCamera,
  setLocked,
  setVisible,
  type Entity,
} from '@ass/scene-engine';
import {
  Box,
  Camera,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Folder,
  Group,
  Image as ImageIcon,
  Lightbulb,
  Lock,
  LockOpen,
  Package,
  Pencil,
  Scan,
  Trash2,
  Video,
} from 'lucide-react';
import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { useContextMenu, type MenuItem } from '@/components/ContextMenu';
import { deleteSelection, duplicateSelection, groupSelection } from './commands';
import { useEditor, useEditorContext } from './context';

const KIND_LABEL: Record<string, string> = {
  group: 'Groupe',
  empty: 'Empty',
  primitive: 'Primitive',
  model: 'Modèle',
  image_plane: 'Image',
  camera: 'Caméra',
  light: 'Lumière',
};

const KIND_ICON: Record<string, ReactNode> = {
  group: <Folder size={13} />,
  empty: <Crosshair size={13} />,
  primitive: <Box size={13} />,
  model: <Package size={13} />,
  image_plane: <ImageIcon size={13} />,
  camera: <Camera size={13} />,
  light: <Lightbulb size={13} />,
};

const kindKey = (entity: Entity) => (entity.kind === 'node' ? entity.value.type : entity.kind);

type OpenMenu = (event: MouseEvent, entity: Entity, rename: () => void) => void;

function kindOf(entity: Entity): string {
  return entity.kind === 'node'
    ? (KIND_LABEL[entity.value.type] ?? entity.value.type)
    : (KIND_LABEL[entity.kind] ?? '');
}

function Row({
  entity,
  depth,
  filter,
  onMenu,
}: {
  entity: Entity;
  depth: number;
  filter: string;
  onMenu: OpenMenu;
}) {
  const { store, canEdit } = useEditorContext();
  const scene = useEditor((state) => state.scene);
  const selected = useEditor((state) => state.selection.includes(entity.value.id));
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(entity.value.name);
  const children = entity.kind === 'node' ? childrenOf(scene, entity.value.id) : [];
  const id = entity.value.id;
  const matches = filter === '' || entity.value.name.toLowerCase().includes(filter);
  const hasVisibility = entity.kind !== 'camera';
  const visible = entity.kind === 'camera' ? true : entity.value.visible;
  const locked = entity.kind !== 'light' && entity.value.locked;
  const startRename = () => {
    if (!canEdit) return;
    setDraft(entity.value.name);
    setRenaming(true);
  };

  return (
    <li>
      {matches && (
        <div
          role="treeitem"
          aria-selected={selected}
          aria-label={entity.value.name}
          tabIndex={0}
          className={`group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${selected ? 'bg-accent/25 text-text' : 'text-text/90 hover:bg-hover'}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={(event) =>
            store
              .getState()
              .select([id], event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace')
          }
          onDoubleClick={startRename}
          onKeyDown={(event) => {
            if (event.key === 'F2') {
              event.preventDefault();
              startRename();
            }
          }}
          onContextMenu={(event) => onMenu(event, entity, startRename)}
        >
          <span className={selected ? 'text-accent-strong' : 'text-faint'} title={kindOf(entity)}>
            {KIND_ICON[kindKey(entity)]}
          </span>
          {renaming ? (
            <input
              autoFocus
              aria-label="Nouveau nom"
              value={draft}
              maxLength={200}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                store.getState().apply((current) => renameEntity(current, id, draft));
                setRenaming(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setRenaming(false);
              }}
              className="min-w-0 flex-1 rounded border border-accent bg-surface px-1"
            />
          ) : (
            <span className={`min-w-0 flex-1 truncate ${visible ? '' : 'text-muted line-through'}`}>
              {entity.value.name}
            </span>
          )}
          {canEdit && hasVisibility && (
            <button
              type="button"
              aria-label={`${visible ? 'Masquer' : 'Afficher'} ${entity.value.name}`}
              title={visible ? 'Masquer (H)' : 'Afficher (H)'}
              className={`text-faint hover:text-text ${visible ? 'opacity-0 group-hover:opacity-100 focus:opacity-100' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                store.getState().apply((current) => setVisible(current, id, !visible));
              }}
            >
              {visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
          )}
          {canEdit && entity.kind !== 'light' && (
            <button
              type="button"
              aria-label={`${locked ? 'Déverrouiller' : 'Verrouiller'} ${entity.value.name}`}
              title={locked ? 'Déverrouiller' : 'Verrouiller'}
              className={
                locked
                  ? 'text-warn'
                  : 'text-faint opacity-0 hover:text-text focus:opacity-100 group-hover:opacity-100'
              }
              onClick={(event) => {
                event.stopPropagation();
                store.getState().apply((current) => setLocked(current, id, !locked));
              }}
            >
              {locked ? <Lock size={13} /> : <LockOpen size={13} />}
            </button>
          )}
        </div>
      )}
      {children.length > 0 && (
        <ul role="group">
          {children.map((child) => (
            <Row
              key={child.value.id}
              entity={child}
              depth={depth + 1}
              filter={filter}
              onMenu={onMenu}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Hierarchy() {
  const { store, canEdit, viewport } = useEditorContext();
  const scene = useEditor((state) => state.scene);
  const roots = useMemo(() => childrenOf(scene, null), [scene]);
  const [search, setSearch] = useState('');
  const filter = search.trim().toLowerCase();
  const { open, menu } = useContextMenu();

  const onMenu: OpenMenu = (event, entity, rename) => {
    const id = entity.value.id;
    const state = store.getState();
    if (!state.selection.includes(id)) state.select([id]);
    const visible = entity.kind === 'camera' ? true : entity.value.visible;
    const locked = entity.kind !== 'light' && entity.value.locked;
    const items: MenuItem[] = [
      {
        label: 'Renommer',
        shortcut: 'F2',
        icon: <Pencil size={13} />,
        disabled: !canEdit,
        run: rename,
      },
      {
        label: 'Cadrer dans la vue',
        shortcut: '.',
        icon: <Scan size={13} />,
        run: () => viewport.current?.frameSelection(),
      },
      'separator',
      {
        label: 'Dupliquer',
        shortcut: '⇧D',
        icon: <Copy size={13} />,
        disabled: !canEdit,
        run: () => duplicateSelection(store),
      },
      {
        label: 'Grouper',
        shortcut: '⌘G',
        icon: <Group size={13} />,
        disabled: !canEdit,
        run: () => groupSelection(store),
      },
    ];
    if (entity.kind !== 'camera')
      items.push({
        label: visible ? 'Masquer' : 'Afficher',
        shortcut: 'H',
        icon: visible ? <EyeOff size={13} /> : <Eye size={13} />,
        disabled: !canEdit,
        run: () => store.getState().apply((current) => setVisible(current, id, !visible)),
      });
    if (entity.kind !== 'light')
      items.push({
        label: locked ? 'Déverrouiller' : 'Verrouiller',
        icon: locked ? <LockOpen size={13} /> : <Lock size={13} />,
        disabled: !canEdit,
        run: () => store.getState().apply((current) => setLocked(current, id, !locked)),
      });
    if (entity.kind === 'camera')
      items.push({
        label: 'Caméra active du plan',
        icon: <Video size={13} />,
        disabled: !canEdit || scene.activeCameraId === id,
        run: () => store.getState().apply((current) => setActiveCamera(current, id)),
      });
    items.push('separator', {
      label: 'Supprimer',
      shortcut: 'X',
      icon: <Trash2 size={13} />,
      danger: true,
      disabled: !canEdit || locked,
      run: () => deleteSelection(store),
    });
    open(event, items);
  };

  return (
    <section aria-label="Hiérarchie de la scène" className="flex min-h-0 flex-1 flex-col gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Hiérarchie</h2>
      <input
        type="search"
        aria-label="Rechercher un objet"
        placeholder="Rechercher…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
      />
      {roots.length === 0 ? (
        <EmptyState icon={<Box size={22} />} title="Scène vide">
          Ajoutez un objet avec le panneau « Ajouter »{canEdit ? ' ou Maj+A.' : '.'}
        </EmptyState>
      ) : (
        <ul role="tree" aria-label="Objets" className="min-h-0 flex-1 overflow-auto">
          {roots.map((entity) => (
            <Row key={entity.value.id} entity={entity} depth={0} filter={filter} onMenu={onMenu} />
          ))}
        </ul>
      )}
      {menu}
    </section>
  );
}
