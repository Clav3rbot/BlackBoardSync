import React, { useState, useEffect, useLayoutEffect } from 'react';
import Icon, { IconName } from './Icon';
import { getT, TranslationKeys } from '../i18n';

interface Step {
    // The part of the window the step is about; none centres the card.
    target?: string;
    // The target lives in the Settings panel, which the step opens.
    settings?: boolean;
    title: keyof TranslationKeys;
    body: keyof TranslationKeys;
}

const STEPS: Step[] = [
    { title: 'tutorialWelcomeTitle', body: 'tutorialWelcomeBody' },
    { target: '.sync-btn', title: 'tutorialSyncTitle', body: 'tutorialSyncBody' },
    { target: '.sync-dir-box', title: 'tutorialFolderTitle', body: 'tutorialFolderBody' },
    { target: '.course-item .course-row', title: 'tutorialCoursesTitle', body: 'tutorialCoursesBody' },
    { target: '.term-filters', title: 'tutorialFiltersTitle', body: 'tutorialFiltersBody' },
    { target: '.header-actions .btn-header-icon', title: 'tutorialSettingsTitle', body: 'tutorialSettingsBody' },
    { target: '.settings-accounts', settings: true, title: 'tutorialPolimiTitle', body: 'tutorialPolimiBody' },
];

// How long the Settings panel takes to slide in before its rows can be measured.
const PANEL_IN_MS = 340;

// Room the spotlight leaves around its target, and the gap to the card.
const PAD = 6;
// A Settings group already fills the panel's width, so it gets no margin.
const PANEL_PAD = 0;
const GAP = 12;
// Roughly the card's height: below the target when this much fits, else above.
const CARD_ROOM = 200;

// Step text: each line is a paragraph, runs of "- " lines become a list, and
// [icon:name] shows the real glyph the step talks about.
const inline = (text: string) =>
    text.split(/\[icon:(\w+)\]/).map((part, i) =>
        i % 2 ? (
            <span key={i} className="tutorial-glyph">
                <Icon name={part as IconName} size={11} />
            </span>
        ) : (
            part
        )
    );

const Body: React.FC<{ text: string }> = ({ text }) => {
    const blocks: React.ReactNode[] = [];
    let items: string[] = [];
    const flush = () => {
        if (!items.length) return;
        blocks.push(
            <ul key={blocks.length}>
                {items.map((item, i) => (
                    <li key={i}>{inline(item)}</li>
                ))}
            </ul>
        );
        items = [];
    };
    for (const line of text.split('\n')) {
        if (line.startsWith('- ')) {
            items.push(line.slice(2));
        } else {
            flush();
            blocks.push(<p key={blocks.length}>{inline(line)}</p>);
        }
    }
    flush();
    return <div className="tutorial-body">{blocks}</div>;
};

interface TutorialProps {
    lang: 'it' | 'en';
    onDone: () => void;
    onSettings: (open: boolean) => void;
}

// A spotlight that moves from one part of the window to the next, with a card
// explaining each. Clicks outside the card do nothing, so a stray click can't
// skip it; Esc does.
const Tutorial: React.FC<TutorialProps> = ({ lang, onDone, onSettings }) => {
    const t = getT(lang);
    // Steps whose part isn't on screen (no courses yet, a single semester)
    // are left out rather than pointing at nothing.
    const [steps] = useState(() =>
        STEPS.filter((s) => !s.target || s.settings || document.querySelector(s.target))
    );
    const [index, setIndex] = useState(0);
    // Measured per step. Until a step's target exists the spotlight stays where
    // it was; `card` holds the card back while the Settings panel slides in, so
    // the spotlight rides in with the row and the card lands once it settles.
    const [measured, setMeasured] = useState<{ index: number; rect: DOMRect | null; card: boolean }>({
        index: -1,
        rect: null,
        card: false,
    });
    const rect = measured.rect;
    const step = steps[index];
    const last = index === steps.length - 1;

    // The target is followed every frame, not measured once: a sync can start
    // underneath and push the list down with its progress bar, a panel can
    // slide, and the window can be resized. State only changes when the box
    // actually moves.
    useLayoutEffect(() => {
        onSettings(!!step.settings);
        const find = () => (step.target ? document.querySelector(step.target) : null);
        const start = performance.now();
        let scrolled = false;
        let card = !step.settings;
        let stillFrames = 0;
        let lastBox = '';
        let lastKey = '';
        let frame = 0;
        const track = () => {
            frame = requestAnimationFrame(track);
            const el = find();
            if (step.target && !el) return;
            if (el && !scrolled) {
                scrolled = true;
                // Inside Settings the row sits far down the panel: glide it to
                // the middle while the panel slides in. Elsewhere, only as far
                // as needed.
                const scroller = el.closest('.settings-body');
                if (scroller) {
                    const r = el.getBoundingClientRect();
                    const s = scroller.getBoundingClientRect();
                    scroller.scrollTo({
                        top: scroller.scrollTop + r.top - s.top - (scroller.clientHeight - r.height) / 2,
                        behavior: 'smooth',
                    });
                } else {
                    el.scrollIntoView({ block: 'nearest' });
                }
            }
            const r = el?.getBoundingClientRect() ?? null;
            const box = r ? `${r.top}|${r.left}|${r.width}|${r.height}` : 'none';
            stillFrames = box === lastBox ? stillFrames + 1 : 0;
            lastBox = box;
            // The card waits until the panel has slid in and the scroll has
            // stopped, so it lands next to the row instead of chasing it.
            if (!card && performance.now() - start > PANEL_IN_MS && stillFrames >= 6) card = true;
            const key = `${card}|${box}`;
            if (key !== lastKey) {
                lastKey = key;
                setMeasured({ index, rect: r, card });
            }
        };
        track();
        return () => cancelAnimationFrame(frame);
    }, [index]);

    const next = () => (last ? onDone() : setIndex(index + 1));
    const back = () => index > 0 && setIndex(index - 1);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onDone();
            else if (e.key === 'ArrowRight') next();
            else if (e.key === 'ArrowLeft') back();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [index]);

    // With no target the spotlight shrinks to a point in the middle, so the
    // whole window dims and the next step grows out of it. While a Settings
    // step settles (panel sliding, list scrolling) it stays closed on the
    // target's centre too, so it never lights up the rows passing by, and
    // opens once the target stops.
    const pad = step.settings ? PANEL_PAD : PAD;
    const settling = !!rect && !!step.settings && !(measured.index === index && measured.card);
    const spot =
        rect && !settling
            ? {
                  top: rect.top - pad,
                  left: rect.left - pad,
                  width: rect.width + pad * 2,
                  height: rect.height + pad * 2,
              }
            : rect
            ? { top: rect.top + rect.height / 2, left: rect.left + rect.width / 2, width: 0, height: 0 }
            : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };

    let cardPlace: React.CSSProperties | undefined;
    if (rect) {
        cardPlace =
            window.innerHeight - rect.bottom > CARD_ROOM
                ? { top: rect.bottom + pad + GAP }
                : { bottom: window.innerHeight - rect.top + pad + GAP };
    }

    return (
        <div className="tutorial" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
            <div className={`tutorial-spot ${rect && !settling ? '' : 'empty'}`} style={spot} />
            {measured.index === index && measured.card && (
                <div key={index} className={`tutorial-card ${rect ? '' : 'centered'}`} style={cardPlace}>
                    <span className="tutorial-count">
                        {index + 1} / {steps.length}
                    </span>
                    <h3 id="tutorial-title" className="tutorial-title">
                        {t(step.title)}
                    </h3>
                    <Body text={t(step.body)} />
                    <div className="tutorial-actions">
                        {!last && (
                            <button className="tutorial-skip" onClick={onDone}>
                                {t('tutorialSkip')}
                            </button>
                        )}
                        {index > 0 && (
                            <button className="tutorial-back" onClick={back}>
                                {t('tutorialBack')}
                            </button>
                        )}
                        <button className="tutorial-next" onClick={next} autoFocus>
                            {last ? t('tutorialStart') : t('tutorialNext')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Tutorial;
