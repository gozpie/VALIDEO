import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Notifications éphémères, avec action facultative (« Annuler » après une suppression…). */
export type ToastKind = 'info' | 'success' | 'error' | 'ai';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; run: () => void };
  /** Durée d'affichage en ms ; 0 = reste jusqu'à fermeture. */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => number;
  dismiss: (id: number) => void;
}

const MAX_VISIBLE = 4;
let nextId = 1;

export const toastStore = createStore<ToastState>()((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    const duration = toast.duration ?? (toast.kind === 'error' ? 8000 : 5000);
    set((state) => ({ toasts: [...state.toasts, { ...toast, id, duration }].slice(-MAX_VISIBLE) }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (
  message: string,
  options: { kind?: ToastKind; action?: Toast['action']; duration?: number } = {},
): number =>
  toastStore.getState().push({
    message,
    kind: options.kind ?? 'info',
    ...(options.action ? { action: options.action } : {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
  });

export const useToasts = () => useStore(toastStore, (state) => state.toasts);
