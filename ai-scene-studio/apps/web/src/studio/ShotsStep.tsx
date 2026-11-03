'use client';

import type { AiProvider, BibleEntry, StoryboardSequence, StoryboardShot } from '@ass/api-client';
import { Box, Clapperboard, Film, ImageOff, Layers } from 'lucide-react';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { APPROACH_LABELS, assetUrl, STATUS_LABELS, STATUS_TONES } from './data';
import { ShotDrawer } from './ShotDrawer';

/**
 * Étape 4 — les plans : le storyboard du film, séquence par séquence. Chaque carte montre la
 * version retenue ; un clic ouvre le plan (découpage, prompts, générations, versions, A/B).
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
  const shots = board.flatMap((s) => s.shots);
  const open = shots.find((s) => s.id === openId) ?? null;
  const approved = shots.filter((s) => s.status === 'approved').length;
  const seconds = shots.reduce((n, s) => n + s.durationFrames / fps, 0);

  if (shots.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <EmptyState icon={<Clapperboard size={24} />} title="Storyboard vide">
          Appliquez un découpage de Claude (étape Propositions) ou créez des séquences et des plans
          depuis la page du projet.
        </EmptyState>
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <p className="mb-5 text-xs text-muted">
          {shots.length} plan(s) · {approved} validé(s) · {Math.round(seconds)} s au total
        </p>
        <div className="flex flex-col gap-8">
          {board.map((sequence, s) => (
            <section key={sequence.id} aria-label={sequence.name} className="flex flex-col gap-3">
              <h2 className="flex items-baseline gap-2 text-sm font-semibold">
                <span className="font-mono text-xs text-faint">{s + 1}</span>
                {sequence.name}
                <span className="text-xs font-normal text-faint">
                  {sequence.shots.length} plan(s)
                </span>
              </h2>
              <ol className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
                {sequence.shots.map((shot, index) => (
                  <li key={shot.id}>
                    <ShotCard
                      shot={shot}
                      label={`${s + 1}.${index + 1}`}
                      fps={fps}
                      active={shot.id === openId}
                      onOpen={() => setOpenId(shot.id)}
                    />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
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

/** Texte sans balises Markdown légères (gras, italique, titres) pour les aperçus. */
export const plainText = (value: string) =>
  value
    .replace(/[*_#`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const APPROACH_ICON = {
  image_to_video: <Film size={11} />,
  multishot: <Layers size={11} />,
  text_to_video: <Film size={11} />,
  still: <ImageOff size={11} />,
  scene_3d: <Box size={11} />,
};

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
  const version = shot.selectedVersion;
  return (
    <button
      type="button"
      aria-label={`Plan ${label} — ${shot.name}`}
      onClick={onOpen}
      className={`group flex w-full flex-col overflow-hidden rounded-xl border bg-panel text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-border-strong ${active ? 'border-accent ring-1 ring-accent' : 'border-border'}`}
    >
      <div className="relative aspect-video bg-surface">
        {version ? (
          version.kind === 'video' ? (
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
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center text-[11px] text-faint">
            <ImageOff size={18} />
            <span className="line-clamp-3">
              {plainText(shot.description) || 'Pas encore d’image'}
            </span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-px font-mono text-[10px] text-white">
          {label}
        </span>
        <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
          {(shot.durationFrames / fps).toFixed(1)} s
        </span>
        {shot.versionCount > 0 && (
          <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
            v{version?.number ?? '–'} / {shot.versionCount}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 p-2.5">
        <p className="truncate text-sm font-medium">{shot.name}</p>
        <p className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted">
          <span
            className={`shrink-0 rounded px-1.5 py-px text-[10px] ${STATUS_TONES[shot.status]}`}
          >
            {STATUS_LABELS[shot.status]}
          </span>
          <span className="min-w-0 truncate">{shot.shotSize.replace(/\s*\(.*$/, '')}</span>
          <span
            className="ml-auto flex shrink-0 items-center gap-1 text-faint"
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
