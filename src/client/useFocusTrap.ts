import { RefObject, useEffect } from 'react';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]';

// Modal focus for a role="dialog" element: takes focus on open, keeps Tab inside, gives focus back on close.
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const previous = document.activeElement as HTMLElement | null;
        el.focus({ preventScroll: true });

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Tab') return;
            // Only the topmost dialog traps: the tour sits over Settings.
            const dialogs = document.querySelectorAll('[role="dialog"]');
            if (dialogs[dialogs.length - 1] !== el) return;
            const items = el.querySelectorAll<HTMLElement>(FOCUSABLE);
            if (!items.length) return;
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (!el.contains(active) || active === el) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
            } else if (e.shiftKey && active === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            previous?.focus({ preventScroll: true });
        };
    }, []);
}
