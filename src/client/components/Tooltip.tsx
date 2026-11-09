import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const HOVER_DELAY_MS = 450;
const EDGE = 8;
// Under this much room above the target (the titlebar), the tooltip goes below it.
const ROOM_ABOVE = 72;

interface Tip {
    text: string;
    x: number;
    y: number;
    below: boolean;
}

// One tooltip for the whole app: any element with data-tip gets it on hover or keyboard focus.
// It replaces the native title, which ignores the theme and cannot be placed.
const Tooltip: React.FC = () => {
    const [tip, setTip] = useState<Tip | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let timer = 0;
        let current: Element | null = null;

        const hide = () => {
            window.clearTimeout(timer);
            current = null;
            setTip(null);
        };

        const show = (el: Element, delay: number) => {
            if (el === current) return;
            hide();
            current = el;
            timer = window.setTimeout(() => {
                const text = el.getAttribute('data-tip');
                if (!text || !el.isConnected) return;
                const r = el.getBoundingClientRect();
                const below = r.top < ROOM_ABOVE;
                setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + EDGE : r.top - EDGE, below });
            }, delay);
        };

        const target = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-tip]') : null);

        const onOver = (e: MouseEvent) => {
            const el = target(e);
            if (el) show(el, HOVER_DELAY_MS);
            else hide();
        };
        // Keyboard focus only: a click also focuses, and would pop the tooltip under the pointer.
        const onFocus = (e: FocusEvent) => {
            const el = target(e);
            if (el && (e.target as Element).matches(':focus-visible')) show(el, 0);
        };

        document.addEventListener('mouseover', onOver);
        document.addEventListener('focusin', onFocus);
        document.addEventListener('focusout', hide);
        document.addEventListener('mousedown', hide);
        document.addEventListener('keydown', hide);
        document.addEventListener('scroll', hide, true);
        document.documentElement.addEventListener('mouseleave', hide);
        window.addEventListener('blur', hide);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('mouseover', onOver);
            document.removeEventListener('focusin', onFocus);
            document.removeEventListener('focusout', hide);
            document.removeEventListener('mousedown', hide);
            document.removeEventListener('keydown', hide);
            document.removeEventListener('scroll', hide, true);
            document.documentElement.removeEventListener('mouseleave', hide);
            window.removeEventListener('blur', hide);
        };
    }, []);

    // Centred on the target, then pushed back inside the window: its width is only known once rendered.
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || !tip) return;
        const w = el.offsetWidth;
        const left = Math.min(Math.max(tip.x - w / 2, EDGE), window.innerWidth - w - EDGE);
        el.style.left = `${left}px`;
    }, [tip]);

    if (!tip) return null;
    return (
        <div ref={ref} className={`tooltip${tip.below ? ' below' : ''}`} style={{ top: tip.y }} role="tooltip">
            {tip.text}
        </div>
    );
};

export default Tooltip;
