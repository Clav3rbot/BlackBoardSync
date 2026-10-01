import React from 'react';

// Truncated text that scrolls on hover so the whole of it can be read. The
// distance is measured on enter because the width depends on the window size.
const Marquee: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
    const onEnter = (e: React.MouseEvent<HTMLSpanElement>) => {
        const el = e.currentTarget;
        const shift = el.scrollWidth - el.clientWidth;
        if (shift <= 0) return;
        el.style.setProperty('--marquee-shift', `${shift}px`);
        el.style.setProperty('--marquee-duration', `${Math.max(2, shift / 30)}s`);
        el.classList.add('scrolling');
    };
    const onLeave = (e: React.MouseEvent<HTMLSpanElement>) =>
        e.currentTarget.classList.remove('scrolling');

    return (
        <span className={`marquee${className ? ` ${className}` : ''}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
            <span>{text}</span>
        </span>
    );
};

export default Marquee;
