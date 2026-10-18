// With `reveal`, the new colours open from a slanted band (view-transition rules in main.scss).
// The localStorage copy lets the next launch paint the right theme before the config arrives.
export function applyTheme(theme: string | undefined, reveal = false) {
    const root = document.documentElement;
    const next = theme === 'light' ? 'light' : 'dark';
    try {
        localStorage.setItem('theme', next);
    } catch { /* storage unavailable: the config still has it */ }
    if (root.dataset.theme === next) return;
    const swap = () => {
        root.dataset.theme = next;
    };
    if (
        !reveal ||
        !document.startViewTransition ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
        swap();
        return;
    }
    document.startViewTransition(swap);
}

export function cachedTheme(): string | undefined {
    try {
        return localStorage.getItem('theme') ?? undefined;
    } catch {
        return undefined;
    }
}
