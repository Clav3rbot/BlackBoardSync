import React from 'react';

// Glyphs that change shape. Drawn by hand on Phosphor's 256 grid with its stroke
// weights, so they sit next to the Phosphor ones. The motion is CSS (main.scss):
// transforms and dash offsets only, which every webview animates.
const frame = (size: number, className: string, children: React.ReactNode) => (
    <svg
        className={`icon morph ${className}`}
        width={size}
        height={size}
        viewBox="0 0 256 256"
        fill="none"
        stroke="currentColor"
        strokeWidth={size <= 12 ? 24 : 16}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
    >
        {children}
    </svg>
);

interface MorphProps {
    size?: number;
}

// An eye that shuts: the upper lid folds onto the lower one and the lashes grow.
export const EyeMorph: React.FC<MorphProps & { closed?: boolean }> = ({ closed = false, size = 16 }) =>
    frame(
        size,
        `eye-morph${closed ? ' closed' : ''}`,
        <g className="eye-body">
            <path d="M16,128s32,72,112,72,112-72,112-72" />
            <path className="eye-lid" d="M16,128s32-72,112-72,112,72,112,72" />
            <circle className="eye-pupil" cx="128" cy="128" r="40" />
            <path className="eye-lash" pathLength={1} d="M42,164 22,196" />
            <path className="eye-lash" pathLength={1} d="M86,192 76,228" />
            <path className="eye-lash" pathLength={1} d="M170,192 180,228" />
            <path className="eye-lash" pathLength={1} d="M214,164 234,196" />
        </g>
    );

// Two arrows chasing each other; `active` drops the heads, spins the ring and shows a stop square.
export const SyncMorph: React.FC<MorphProps & { active?: boolean }> = ({ active = false, size = 16 }) =>
    frame(
        size,
        `sync-morph${active ? ' active' : ''}`,
        <>
            <g className="sync-ring">
                <path d="M52.8,100.6A80,80,0,0,1,203.2,100.6" />
                <path d="M203.2,155.4A80,80,0,0,1,52.8,155.4" />
                <path className="sync-head" d="M166.9,83.7 203.2,100.6 220.1,64.3" />
                <path className="sync-head" d="M89.1,172.3 52.8,155.4 35.9,191.7" />
            </g>
            <rect className="sync-stop" x="96" y="96" width="64" height="64" rx="12" fill="currentColor" stroke="none" />
        </>
    );

// Plays once: the arrow drops into the tray and a tick is drawn in its place.
export const DownloadDoneMorph: React.FC<MorphProps> = ({ size = 16 }) =>
    frame(
        size,
        'download-morph',
        <>
            <path d="M216,144v64H40V144" />
            <g className="download-arrow">
                <path d="M128,32V144" />
                <path d="M88,104l40,40,40-40" />
            </g>
            <path className="download-check" pathLength={1} d="M84,100l32,32,56-64" />
        </>
    );
