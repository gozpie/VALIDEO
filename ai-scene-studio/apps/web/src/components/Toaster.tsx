'use client';

import { CheckCircle2, Info, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';
import { toastStore, useToasts, type Toast } from '@/lib/toast';

const ICONS = {
  info: <Info size={16} className="text-accent-strong" />,
  success: <CheckCircle2 size={16} className="text-ok" />,
  error: <TriangleAlert size={16} className="text-error" />,
  ai: <Sparkles size={16} className="text-ai" />,
};

function ToastItem({ toast }: { toast: Toast }) {
  const { id, duration } = toast;
  const dismiss = () => toastStore.getState().dismiss(id);
  useEffect(() => {
    if (duration === 0) return;
    const timer = window.setTimeout(() => toastStore.getState().dismiss(id), duration);
    return () => window.clearTimeout(timer);
  }, [id, duration]);
  return (
    <li
      data-testid="toast"
      className="pointer-events-auto flex min-w-72 max-w-md animate-slide-up items-center gap-3 rounded-lg border border-border bg-elevated px-3 py-2 text-sm shadow-pop"
    >
      {ICONS[toast.kind]}
      <span className="min-w-0 flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="rounded px-2 py-0.5 text-xs font-semibold text-accent-strong hover:bg-hover"
          onClick={() => {
            toast.action?.run();
            dismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Fermer la notification"
        className="text-faint hover:text-text"
        onClick={dismiss}
      >
        <X size={14} />
      </button>
    </li>
  );
}

/** Pile de notifications en bas à droite (annoncées aux lecteurs d'écran). */
export function Toaster() {
  const toasts = useToasts();
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </ol>
  );
}
