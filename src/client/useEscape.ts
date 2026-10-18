import { useEffect, useRef } from 'react';

// Keeps the latest callback, so callers can pass an inline function without re-subscribing.
export function useEscape(onEscape: () => void, active = true) {
    const callback = useRef(onEscape);
    callback.current = onEscape;
    useEffect(() => {
        if (!active) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') callback.current();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [active]);
}
