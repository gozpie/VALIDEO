'use client';

import type {
  AiProvider,
  BibleEntry,
  ShotStatus,
  StoryboardSequence,
  StoryboardShot,
} from '@ass/api-client';
import {
  Box,
  Clapperboard,
  Film,
  Image as ImageIcon,
  ImageOff,
  LayoutGrid,
  Layers,
  Rows3,
  Type,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { APPROACH_LABELS, assetUrl, STATUS_LABELS, STATUS_TONES } from './data';
import { ShotDrawer } from './ShotDrawer';

/** Texte sans balises Markdown légères (gras, italique, titres) pour les aperçus. */
export const plainText = (value: string) =>
  value
    .replace(/[*_#`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const APPROACH_ICON = {
  image_to_video: <Film size={12} />,
  multishot: <Layers size={12} />,
  text_to_video: <Type size={12} />,
  still: <ImageIcon size={12} />,
  scene_3d: <Box size={12} />,
};

/** Couleur d'un plan dans la timeline : le statut se lit d'un coup d'œil. */
const STATUS_BAR: Record<ShotStatus, string> = {
  todo: 'bg-border-strong',
  in_progress: 'bg-ai',
  review: 'bg-warn',
  approved: 'bg-ok',
};

const formatTime = (seconds: number) => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

type View = 'grid' | 'table';

/**
 * Étape « Plans » : le film plan par plan. Grille dense ou tableau de suivi, timeline des plans en
 * bas (largeur = durée, couleur = statut), lecteur et fabrication du plan choisi à droite.
 */
export function ShotsStep({
  canEdit,
  board,
  refresh,
  bible,
  providers,
  fps,
}: {
  canEdit: boolean;
  board: StoryboardSequence[];
  refresh: () => void;
  bible: BibleEntry[];
  providers: AiProvider[];
  fps: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<View>('grid');
  const [filter, setFilter] = useState<ShotStatus | 'all'>('all');
  const shots = useMemo(() => board.flatMap((s) => s.shots), [board]);
  const open = shots.find((s) => s.id === openId) ?? null;
  const seconds = shots.reduce((n, s) => n + s.durationFrames / fps, 0);
  const counts = useMemo(() => {
    const result: Record<ShotStatus, number> = { todo: 0, in_progress: 0, review: 0, approved: 0 };
    for (const shot of shots) result[shot.status] += 1;
    return result;
  }, [shots]);

  if (shots.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <EmptyState icon={<Clapperboard size={24} />} title="Storyboard vide">
          Appliquez un découpage de Claude (étape Propositions) ou créez des séquences et des plans
          depuis la page du projet.
        </EmptyState>
      </div>
    );

  const visible = (shot: StoryboardShot) => filter === 'all' || shot.status === filter;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2.5">
          <div role="group" aria-label="Affichage" className="flex rounded-lg bg-panel p-0.5">
            {(
              [
                ['grid', <LayoutGrid key="g" size={14} />, 'Grille'],
                ['table', <Rows3 key="t" size={14} />, 'Tableau'],
              ] as const
            ).map(([value, icon, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${view === value ? 'bg-elevated text-text shadow-card' : 'text-muted hover:text-text'}`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Filtrer par statut" className="flex flex-wrap gap-1">
            <FilterChip
              label={`Tous ${shots.length}`}
              on={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            {(Object.keys(STATUS_LABELS) as ShotStatus[]).map((status) => (
              <FilterChip
                key={status}
                label={`${STATUS_LABELS[status]} ${counts[status]}`}
                dot={STATUS_BAR[status]}
                on={filter === status}
                onClick={() => setFilter(filter === status ? 'all' : status)}
              />
            ))}
          </div>
          <span className="ml-auto text-xs tabular-nums text-muted">
            {shots.length} plans · {formatTime(seconds)}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {view === 'grid' ? (
            <div className="flex flex-col gap-7">
              {board.map((sequence, s) => {
                const items = sequence.shots
                  .map((shot, index) => ({ shot, label: `${s + 1}.${index + 1}` }))
                  .filter(({ shot }) => visible(shot));
                if (items.length === 0) return null;
                const duration = sequence.shots.reduce((n, x) => n + x.durationFrames / fps, 0);
                return (
                  <section
                    key={sequence.id}
                    aria-label={sequence.name}
                    className="flex flex-col gap-3"
                  >
                    <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                      {sequence.name}
                      <span className="text-xs font-normal tabular-nums text-faint">
                        {sequence.shots.length} plan(s) · {formatTime(duration)}
                      </span>
                    </h2>
                    <ol className="grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-3">
                      {items.map(({ shot, label }) => (
                        <li key={shot.id}>
                          <ShotCard
                            shot={shot}
                            label={label}
                            fps={fps}
                            active={shot.id === openId}
                            onOpen={() => setOpenId(shot.id)}
                          />
                        </li>
                      ))}
                    </ol>
                  </section>
                );
              })}
            </div>
          ) : (
            <ShotTable
              board={board}
              fps={fps}
              bible={bible}
              openId={openId}
              visible={visible}
              onOpen={setOpenId}
            />
          )}
        </div>

        <Timeline board={board} fps={fps} openId={openId} onOpen={setOpenId} seconds={seconds} />
      </div>
      {open && (
        <ShotDrawer
          key={open.id}
          shot={open}
          canEdit={canEdit}
          bible={bible}
          providers={providers}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

function FilterChip({
  label,
  on,
  dot,
  onClick,
}: {
  label: string;
  on: boolean;
  dot?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs tabular-nums transition-colors ${on ? 'border-accent bg-accent/15 text-text' : 'border-transparent text-muted hover:bg-hover hover:text-text'}`}
    >
      {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      {label}
    </button>
  );
}

function Thumbnail({ shot, compact = false }: { shot: StoryboardShot; compact?: boolean }) {
  const version = shot.selectedVersion;
  if (!version)
    return (
      <div
        className={`flex h-full w-full flex-col items-center justify-center gap-1 bg-surface text-faint ${compact ? '' : 'px-3'}`}
      >
        <ImageOff size={compact ? 13 : 16} />
        {!compact && (
          <span className="line-clamp-3 text-center text-[10.5px] leading-snug">
            {plainText(shot.description) || 'Pas encore d’image'}
          </span>
        )}
      </div>
    );
  return version.kind === 'video' ? (
    <video
      src={assetUrl(version.assetId)}
      muted
      loop
      playsInline
      onMouseEnter={(event) => void event.currentTarget.play()}
      onMouseLeave={(event) => event.currentTarget.pause()}
      className="h-full w-full object-cover"
    />
  ) : (
    <img
      src={assetUrl(version.assetId)}
      alt={`Version retenue — ${shot.name}`}
      className="h-full w-full object-cover"
    />
  );
}

function ShotCard({
  shot,
  label,
  fps,
  active,
  onOpen,
}: {
  shot: StoryboardShot;
  label: string;
  fps: number;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Plan ${label} — ${shot.name}`}
      onClick={onOpen}
      className={`group flex w-full flex-col overflow-hidden rounded-xl bg-panel text-left outline outline-1 transition-all hover:-translate-y-0.5 hover:outline-border-strong ${active ? 'outline-2 outline-accent' : 'outline-border'}`}
    >
      <div className="relative aspect-video">
        <Thumbnail shot={shot} />
        <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-px font-mono text-[10px] text-white">
          {label}
        </span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/65 px-1.5 py-px font-mono text-[10px] text-white">
          {(shot.durationFrames / fps).toFixed(1)} s
        </span>
        {shot.versionCount > 0 && (
          <span className="absolute right-1.5 top-1.5 rounded bg-black/65 px-1.5 py-px text-[10px] text-white">
            v{shot.selectedVersion?.number ?? '–'} / {shot.versionCount}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 px-2.5 py-2">
        <p className="truncate text-[13px] font-semibold">{shot.name}</p>
        <p className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_BAR[shot.status]}`} />
          <span className="min-w-0 truncate">
            {STATUS_LABELS[shot.status]} · {shot.shotSize.replace(/\s*\(.*$/, '')}
          </span>
          <span
            className="ml-auto shrink-0 text-faint"
            title={`Mode de fabrication : ${APPROACH_LABELS[shot.approach]}`}
            aria-label={APPROACH_LABELS[shot.approach]}
          >
            {APPROACH_ICON[shot.approach]}
          </span>
        </p>
      </div>
    </button>
  );
}

function ShotTable({
  board,
  fps,
  bible,
  openId,
  visible,
  onOpen,
}: {
  board: StoryboardSequence[];
  fps: number;
  bible: BibleEntry[];
  openId: string | null;
  visible: (shot: StoryboardShot) => boolean;
  onOpen: (id: string) => void;
}) {
  const entries = useMemo(() => new Map(bible.map((e) => [e.id, e])), [bible]);
  const th = 'px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-faint';
  return (
    <table aria-label="Suivi des plans" className="w-full border-collapse text-[13px]">
      <thead className="sticky top-0 z-10 bg-surface">
        <tr className="border-b border-border">
          <th className={th}>Plan</th>
          <th className={th}>Nom</th>
          <th className={th}>Valeur</th>
          <th className={th}>Durée</th>
          <th className={th}>Fabrication</th>
          <th className={th}>Dans le plan</th>
          <th className={th}>Versions</th>
          <th className={th}>Statut</th>
        </tr>
      </thead>
      {board.map((sequence, s) => (
        <tbody key={sequence.id}>
          <tr>
            <td colSpan={8} className="px-2.5 pb-1 pt-4 text-xs font-semibold text-muted">
              {sequence.name}
            </td>
          </tr>
          {sequence.shots.map((shot, index) =>
            visible(shot) ? (
              <tr
                key={shot.id}
                onClick={() => onOpen(shot.id)}
                className={`cursor-pointer border-b border-border/60 transition-colors hover:bg-hover ${shot.id === openId ? 'bg-accent/10' : ''}`}
              >
                <td className="px-2.5 py-1.5">
                  <div className="flex items-center gap-2.5">
                    <span className="h-9 w-16 shrink-0 overflow-hidden rounded-md">
                      <Thumbnail shot={shot} compact />
                    </span>
                    <span className="font-mono text-[11px] text-faint">
                      {s + 1}.{index + 1}
                    </span>
                  </div>
                </td>
                <td className="px-2.5 py-1.5 font-medium">
                  <button type="button" className="text-left hover:underline">
                    {shot.name}
                  </button>
                </td>
                <td className="px-2.5 py-1.5 text-muted">
                  {shot.shotSize.replace(/\s*\(.*$/, '') || '—'}
                </td>
                <td className="px-2.5 py-1.5 font-mono text-xs tabular-nums text-muted">
                  {(shot.durationFrames / fps).toFixed(1)} s
                </td>
                <td className="px-2.5 py-1.5 text-xs text-muted">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {APPROACH_ICON[shot.approach]}
                    {APPROACH_LABELS[shot.approach]}
                  </span>
                </td>
                <td className="px-2.5 py-1.5">
                  <div className="flex -space-x-1.5">
                    {shot.bibleEntryIds.slice(0, 5).map((id) => {
                      const entry = entries.get(id);
                      return entry ? (
                        <span
                          key={id}
                          title={entry.name}
                          className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-elevated text-[9px] font-semibold text-muted ring-2 ring-surface"
                        >
                          {entry.keyAssetId ? (
                            <img
                              src={assetUrl(entry.keyAssetId)}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            entry.name.slice(0, 2).toUpperCase()
                          )}
                        </span>
                      ) : null;
                    })}
                  </div>
                </td>
                <td className="px-2.5 py-1.5 text-xs tabular-nums text-muted">
                  {shot.versionCount || '—'}
                </td>
                <td className="px-2.5 py-1.5">
                  <span
                    className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-medium ${STATUS_TONES[shot.status]}`}
                  >
                    {STATUS_LABELS[shot.status]}
                  </span>
                </td>
              </tr>
            ) : null,
          )}
        </tbody>
      ))}
    </table>
  );
}

/**
 * Timeline du film : chaque plan occupe une largeur proportionnelle à sa durée, avec sa vignette et
 * une barre de la couleur de son statut. Les séquences sont séparées ; un clic ouvre le plan.
 */
function Timeline({
  board,
  fps,
  openId,
  onOpen,
  seconds,
}: {
  board: StoryboardSequence[];
  fps: number;
  openId: string | null;
  onOpen: (id: string) => void;
  seconds: number;
}) {
  const PX_PER_SECOND = 22;
  const ticks = Math.ceil(seconds / 5);
  return (
    <section
      aria-label="Timeline du film"
      className="shrink-0 overflow-x-auto border-t border-border bg-panel px-5 pb-3 pt-2"
    >
      <div style={{ width: seconds * PX_PER_SECOND + board.length * 6 }} className="min-w-full">
        <div className="relative mb-1 h-4 text-[10px] tabular-nums text-faint">
          {Array.from({ length: ticks + 1 }, (_, index) => (
            <span
              key={index}
              className="absolute top-0 border-l border-border-strong pl-1"
              style={{ left: index * 5 * PX_PER_SECOND }}
            >
              {formatTime(index * 5)}
            </span>
          ))}
        </div>
        <ol className="flex gap-1.5">
          {board.map((sequence, s) => (
            <li key={sequence.id} className="shrink-0">
              <ol className="flex gap-px">
                {sequence.shots.map((shot, index) => (
                  <li key={shot.id}>
                    <button
                      type="button"
                      aria-label={`Timeline — plan ${s + 1}.${index + 1} — ${shot.name}`}
                      title={`${s + 1}.${index + 1} — ${shot.name}`}
                      onClick={() => onOpen(shot.id)}
                      style={{ width: (shot.durationFrames / fps) * PX_PER_SECOND }}
                      className={`relative block h-14 overflow-hidden rounded bg-surface outline outline-1 -outline-offset-1 transition-[filter] hover:brightness-125 ${shot.id === openId ? 'outline-2 outline-accent-strong' : 'outline-transparent'}`}
                    >
                      <Thumbnail shot={shot} compact />
                      <span className="absolute left-1 top-0.5 font-mono text-[9px] text-white/80 [text-shadow:0_1px_2px_black]">
                        {s + 1}.{index + 1}
                      </span>
                      <span
                        className={`absolute inset-x-0 bottom-0 h-1 ${STATUS_BAR[shot.status]}`}
                      />
                    </button>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
