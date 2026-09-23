import React, { useEffect, useRef } from 'react';

// Thermal-camera trail left by the cursor, drawn behind its parent element's
// content. The canvas is rendered at 1/CELL resolution, stretched by CSS and
// lightly blurred there, so it reads as a smooth glow instead of blocks. The
// loop only runs while something is still warm, so an idle view costs nothing.
const CELL = 4; // CSS px per heat cell
const RADIUS = 10; // brush radius, in cells
const DEPOSIT = 0.06; // heat added at the brush centre per stamp
const HALF_LIFE = 0.9; // seconds for heat to halve
const MAX_ALPHA = 0.55; // caps the hottest spot so text stays legible

// blue -> cyan -> green -> yellow -> red
const STOPS: [number, number, number, number][] = [
    [0.0, 0, 30, 200],
    [0.25, 0, 110, 255],
    [0.45, 0, 230, 230],
    [0.6, 60, 255, 60],
    [0.8, 255, 230, 0],
    [1.0, 255, 40, 0],
];

// 256-entry palette packed as ImageData pixels (little-endian ABGR).
const LUT = (() => {
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        let s = 1;
        while (s < STOPS.length - 1 && STOPS[s][0] < t) s++;
        const [t0, r0, g0, b0] = STOPS[s - 1];
        const [t1, r1, g1, b1] = STOPS[s];
        const f = (t - t0) / (t1 - t0);
        const r = Math.round(r0 + (r1 - r0) * f);
        const g = Math.round(g0 + (g1 - g0) * f);
        const b = Math.round(b0 + (b1 - b0) * f);
        const a = Math.round(255 * MAX_ALPHA * Math.min(1, t * 3));
        lut[i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
    return lut;
})();

// Gaussian brush, zero outside RADIUS.
const KERNEL = (() => {
    const size = RADIUS * 2 + 1;
    const k = new Float32Array(size * size);
    const sigma = RADIUS / 2;
    for (let y = -RADIUS; y <= RADIUS; y++) {
        for (let x = -RADIUS; x <= RADIUS; x++) {
            const d2 = x * x + y * y;
            if (d2 <= RADIUS * RADIUS) {
                k[(y + RADIUS) * size + x + RADIUS] = Math.exp(-d2 / (2 * sigma * sigma));
            }
        }
    }
    return k;
})();

const HeatmapBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const canvas = canvasRef.current;
        const host = canvas?.parentElement;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !host || !ctx) return;

        let w = 0;
        let h = 0;
        let heat = new Float32Array(0);
        let img = ctx.createImageData(1, 1);
        let pixels = new Uint32Array(0);
        let raf = 0;
        let prev = 0;
        let last: { x: number; y: number } | null = null;

        const resize = () => {
            w = Math.ceil(host.clientWidth / CELL);
            h = Math.ceil(host.clientHeight / CELL);
            canvas.width = w;
            canvas.height = h;
            heat = new Float32Array(w * h);
            img = ctx.createImageData(w, h);
            pixels = new Uint32Array(img.data.buffer);
        };

        const stamp = (cx: number, cy: number) => {
            const size = RADIUS * 2 + 1;
            const x0 = Math.round(cx);
            const y0 = Math.round(cy);
            for (let ky = 0; ky < size; ky++) {
                const y = y0 + ky - RADIUS;
                if (y < 0 || y >= h) continue;
                for (let kx = 0; kx < size; kx++) {
                    const x = x0 + kx - RADIUS;
                    if (x < 0 || x >= w) continue;
                    const i = y * w + x;
                    heat[i] = Math.min(1, heat[i] + KERNEL[ky * size + kx] * DEPOSIT);
                }
            }
        };

        const frame = (now: number) => {
            const k = 0.5 ** ((now - prev) / 1000 / HALF_LIFE);
            prev = now;
            let warm = false;
            for (let i = 0; i < heat.length; i++) {
                let v = heat[i] * k;
                if (v < 0.004) v = 0;
                else warm = true;
                heat[i] = v;
                pixels[i] = LUT[(v * 255) | 0];
            }
            ctx.putImageData(img, 0, 0);
            raf = warm ? requestAnimationFrame(frame) : 0;
        };

        // Stamps are spaced evenly along the path, so heat tracks distance
        // travelled rather than how often the OS happens to report the pointer.
        const onMove = (e: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            const p = {
                x: ((e.clientX - rect.left) / rect.width) * w,
                y: ((e.clientY - rect.top) / rect.height) * h,
            };
            const from = last ?? p;
            const dist = Math.hypot(p.x - from.x, p.y - from.y);
            const step = RADIUS / 3;
            const n = Math.max(1, Math.ceil(dist / step));
            for (let s = 1; s <= n; s++) {
                stamp(from.x + ((p.x - from.x) * s) / n, from.y + ((p.y - from.y) * s) / n);
            }
            last = p;
            if (!raf) {
                prev = performance.now();
                raf = requestAnimationFrame(frame);
            }
        };

        // Forget the last point on exit so re-entering elsewhere doesn't
        // paint a streak across the section.
        const onLeave = () => {
            last = null;
        };

        const observer = new ResizeObserver(resize);
        observer.observe(host);
        host.addEventListener('pointermove', onMove);
        host.addEventListener('pointerleave', onLeave);
        return () => {
            cancelAnimationFrame(raf);
            observer.disconnect();
            host.removeEventListener('pointermove', onMove);
            host.removeEventListener('pointerleave', onLeave);
        };
    }, []);

    return <canvas ref={canvasRef} className="heatmap-bg" aria-hidden="true" />;
};

export default HeatmapBackground;
