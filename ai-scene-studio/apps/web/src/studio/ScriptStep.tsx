'use client';

import type { AiProvider, GenerationJob, ScriptSummary } from '@ass/api-client';
import { FileText, History, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, call } from '@/lib/api';
import { toast } from '@/lib/toast';
import { GenerateControl } from './Generate';

/**
 * Étape 1 — brief et script : un éditeur de texte versionné. Chaque enregistrement crée une
 * version immuable ; Claude découpe le film et établit la bible à partir de la dernière.
 */
export function ScriptStep({
  projectId,
  canEdit,
  scripts,
  refreshScripts,
  providers,
  onJob,
}: {
  projectId: string;
  canEdit: boolean;
  scripts: ScriptSummary[];
  refreshScripts: () => void;
  providers: AiProvider[];
  onJob: (job: GenerationJob) => void;
}) {
  const latest = scripts[0] ?? null;
  const [viewing, setViewing] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const [intent, setIntent] = useState('');
  const [saving, setSaving] = useState(false);

  // Charge la version choisie (la plus récente par défaut).
  const target = viewing ?? latest?.id ?? null;
  useEffect(() => {
    if (!target || target === loadedFrom || edited) return;
    call(api.GET('/scripts/{script_id}', { params: { path: { script_id: target } } }))
      .then((script) => {
        setTitle(script.title);
        setContent(script.content);
        setLoadedFrom(script.id);
      })
      .catch((error: Error) => toast(error.message, { kind: 'error' }));
  }, [target, loadedFrom, edited]);

  const loaded = scripts.find((s) => s.id === loadedFrom);
  const save = () => {
    setSaving(true);
    call(
      api.POST('/projects/{project_id}/scripts', {
        params: { path: { project_id: projectId } },
        body: { title, content },
      }),
    )
      .then((script) => {
        setLoadedFrom(script.id);
        setEdited(false);
        setViewing(null);
        refreshScripts();
        toast(`Version ${script.version} enregistrée`, { kind: 'success' });
      })
      .catch((error: Error) => toast(error.message, { kind: 'error' }))
      .finally(() => setSaving(false));
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_20rem] gap-0">
      <section aria-label="Script" className="flex min-h-0 flex-col gap-3 p-6">
        <div className="flex items-center gap-3">
          <input
            aria-label="Titre de la version"
            placeholder="Titre (facultatif) : brief, premier jet, V2…"
            value={title}
            maxLength={200}
            disabled={!canEdit}
            onChange={(event) => {
              setTitle(event.target.value);
              setEdited(true);
            }}
            className="h-9 flex-1 rounded-md border border-border bg-surface px-3 text-sm placeholder:text-faint focus:border-accent focus:outline-none"
          />
          {loaded && (
            <span className="text-xs text-faint">
              Version {loaded.version} · {new Date(loaded.createdAt).toLocaleString('fr-FR')}
            </span>
          )}
          {canEdit && (
            <button
              type="button"
              disabled={saving || content.trim() === '' || !edited}
              onClick={save}
              className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-40"
            >
              <Save size={14} /> Enregistrer une version
            </button>
          )}
        </div>
        <textarea
          aria-label="Brief ou script"
          value={content}
          disabled={!canEdit}
          maxLength={500000}
          placeholder={
            'Collez ici le brief ou le script du film.\n\nEx. : INT. PHARE — NUIT\nLe gardien rallume la lampe…'
          }
          onChange={(event) => {
            setContent(event.target.value);
            setEdited(true);
          }}
          className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-panel p-5 font-mono text-[13px] leading-relaxed text-text/95 placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <p className="text-xs text-faint">
          {content.length.toLocaleString('fr-FR')} caractères
          {edited ? ' · modifications non enregistrées' : ''}
        </p>
      </section>
      <aside className="flex min-h-0 flex-col gap-5 overflow-auto border-l border-border bg-panel p-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-faint">
            Avec Claude
          </h2>
          <textarea
            aria-label="Consigne pour Claude"
            rows={3}
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            placeholder="Consigne facultative : durée visée, rythme, nombre de plans…"
            className="resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs placeholder:text-faint focus:border-ai focus:outline-none"
          />
          {!latest ? (
            <p className="text-xs text-faint">Enregistrez une version pour lancer Claude.</p>
          ) : (
            <>
              <p className="text-[11px] text-muted">
                Découpage selon la méthode réalisateur / chef-op : intention, analyse dramaturgique,
                battements, mise en scène, chef-op, découpage, contrôle qualité.
              </p>
              <GenerateControl
                target={{ kind: 'project', id: projectId }}
                providers={providers}
                mode="script_breakdown"
                defaultModel="claude:opus"
                body={{ prompt: intent, scriptId: latest.id }}
                label="Découper le film"
                disabled={!canEdit || edited}
                onCreated={onJob}
              />
              <GenerateControl
                target={{ kind: 'project', id: projectId }}
                providers={providers}
                mode="bible_from_script"
                defaultModel="claude:sonnet"
                body={{ prompt: intent, scriptId: latest.id }}
                label="Établir la bible"
                disabled={!canEdit || edited}
                onCreated={onJob}
              />
            </>
          )}
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">
            <History size={12} /> Versions
          </h2>
          {scripts.length === 0 ? (
            <EmptyState icon={<FileText size={20} />} title="Aucune version">
              Le brief ou le script enregistré apparaîtra ici, version par version.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="Versions du script">
              {scripts.map((script) => (
                <li key={script.id}>
                  <button
                    type="button"
                    aria-current={script.id === loadedFrom}
                    onClick={() => {
                      setViewing(script.id);
                      setEdited(false);
                      setLoadedFrom(null);
                    }}
                    className={`w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors ${script.id === loadedFrom ? 'bg-accent/20 text-text' : 'text-muted hover:bg-hover hover:text-text'}`}
                  >
                    <span className="font-medium">v{script.version}</span>{' '}
                    {script.title || 'Sans titre'}
                    <span className="block text-[10px] text-faint">
                      {new Date(script.createdAt).toLocaleString('fr-FR')} ·{' '}
                      {script.length.toLocaleString('fr-FR')} car.
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
