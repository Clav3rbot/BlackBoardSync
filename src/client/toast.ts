import { useSyncExternalStore } from 'react';
import type { IconName } from './components/Icon';

export interface ToastSpec {
    tone: 'success' | 'error' | 'accent';
    icon: IconName;
    message: string;
    description?: string;
    action?: { label: string; run: () => void };
    // Stays until dismissed; otherwise it leaves on its own after a few seconds.
    sticky?: boolean;
    // A new toast replaces the one with the same key, so repeats don't pile up.
    key?: string;
}

export interface Toast extends ToastSpec {
    id: number;
}

const MAX_TOASTS = 3;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const set = (next: Toast[]) => {
    toasts = next;
    listeners.forEach((listener) => listener());
};

export function toast(spec: ToastSpec) {
    const kept = toasts.filter((t) => !spec.key || t.key !== spec.key);
    set([...kept, { ...spec, id: nextId++ }].slice(-MAX_TOASTS));
}

export function dismissToast(idOrKey: number | string) {
    set(toasts.filter((t) => t.id !== idOrKey && t.key !== idOrKey));
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const useToasts = () => useSyncExternalStore(subscribe, () => toasts);
