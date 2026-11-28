// Regole sul codice dell'interfaccia, controllate sui sorgenti.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const sources = readdirSync(root, { recursive: true })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: f.replaceAll('\\', '/'), text: readFileSync(join(root, f), 'utf8') }));
const i18n = sources.find((s) => s.file === 'client/i18n.ts').text;
const others = sources.filter((s) => s.file !== 'client/i18n.ts');

test('ogni testo di i18n.ts ha un chiamante', () => {
    const block = i18n.slice(i18n.indexOf('const it = {'), i18n.indexOf('};'));
    const keys = [...block.matchAll(/^ {4}([a-zA-Z0-9]+):/gm)].map((m) => m[1]);
    assert.ok(keys.length > 100);
    const unused = keys.filter((k) => !others.some((s) => new RegExp(`['"\`]${k}['"\`]`).test(s.text)));
    assert.deepEqual(unused, []);
});

test('i testi per lingua stanno solo in i18n.ts', () => {
    const offenders = others
        .filter((s) => /lang(uage)? === 'en' \? (?!'active')|'it' \| 'en'|'en-US'|'it-IT'/.test(s.text))
        .map((s) => s.file);
    assert.deepEqual(offenders, []);
});

test('la piattaforma si legge solo in platform.ts', () => {
    const offenders = sources.filter((s) => s.text.includes('navigator.userAgent') && s.file !== 'client/platform.ts').map((s) => s.file);
    assert.deepEqual(offenders, []);
});

test("l'etichetta dell'università si disegna solo in SourceBadge.tsx", () => {
    const offenders = sources
        .filter((s) => s.text.includes('course-source') && s.file !== 'client/components/SourceBadge.tsx')
        .map((s) => s.file);
    assert.deepEqual(offenders, []);
});
