import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

// Interfaccia servita da webpack con src/dev/api-stub.ts al posto del backend Rust: nessuna rete.
// Il testo delle schermate è fissato in schermate.json: dopo un cambio voluto AGGIORNA=1 npm run test:e2e.
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SNAPSHOT = new URL('./schermate.json', import.meta.url)
const PORT = 3100
const BASE = `http://localhost:${PORT}`
const ADESSO = new Date('2026-11-25T10:00:00+01:00')

let server, browser
const visto = {}

before(async () => {
  server = spawn(process.execPath, [`${ROOT}/node_modules/webpack/bin/webpack.js`, 'serve', '--config', 'webpack.dev.config.js', '--port', String(PORT), '--no-open'], { cwd: ROOT, stdio: 'ignore' })
  for (let i = 0; ; i++) {
    try { if ((await fetch(BASE)).ok) break } catch { /* non ancora pronto */ }
    if (i > 180) throw new Error('webpack dev server non risponde')
    await new Promise((r) => setTimeout(r, 1000))
  }
  browser = await chromium.launch({
    channel: 'chrome',
    chromiumSandbox: true,
    args: ['--host-resolver-rules=MAP *.kaspersky-labs.com ~NOTFOUND'],
  })
})

after(async () => {
  await browser?.close()
  server?.kill()
  if (!Object.keys(visto).length) return
  if (process.env.AGGIORNA || !existsSync(SNAPSHOT)) writeFileSync(SNAPSHOT, JSON.stringify(visto, null, 2) + '\n')
})

async function apri({ disconnesso = false, tutorial = false, polimi = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 720 }, locale: 'it-IT', timezoneId: 'Europe/Rome', reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(ADESSO)
  const errori = []
  page.on('console', (m) => m.type() === 'error' && !/ERR_NAME_NOT_RESOLVED|status of 404/.test(m.text()) && errori.push(m.text().slice(0, 200)))
  page.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errori.push(`${r.status()} ${r.url()}`))
  page.on('pageerror', (e) => errori.push(e.message))
  await page.addInitScript(({ disconnesso, tutorial, polimi }) => {
    window.__chiamate = []
    let api
    Object.defineProperty(window, 'api', {
      configurable: true,
      get: () => api,
      set: (v) => {
        if (!tutorial) v.updateConfig({ tutorialDone: true })
        v.onSyncComplete = (cb) => { window.__syncComplete = cb; return () => {} }
        if (disconnesso) v.autoLogin = async () => ({ bocconi: null, webeep: null })
        if (polimi) {
          const corsi = v.getCourses
          const iot = { id: 'webeep:9', courseId: '054323', name: 'INTERNET OF THINGS', instructor: 'Matteo Cesana', term: { id: '_term1', name: '2025/2026 FIRST SEMESTER' } }
          v.getCourses = async () => { const r = await corsi(); return { ...r, courses: [...r.courses, iot] } }
        }
        api = Object.fromEntries(Object.entries(v).map(([nome, f]) => [nome,
          typeof f === 'function' && !nome.startsWith('on')
            ? (...args) => { window.__chiamate.push([nome, JSON.parse(JSON.stringify(args))]); return f(...args) }
            : f]))
      },
    })
  }, { disconnesso, tutorial, polimi })
  await page.goto(BASE, { waitUntil: 'networkidle' })
  const chiamate = (nome) => page.evaluate((n) => window.__chiamate.filter(([c]) => c === n).map(([, a]) => a), nome)
  const testo = async (sel = 'body') => (await page.locator(sel).first().innerText()).split('\n').map((r) => r.trim()).filter(Boolean)
  return { page, errori, chiamate, testo, chiudi: () => ctx.close() }
}

function fissa(nome, valore) {
  visto[nome] = valore
  if (process.env.AGGIORNA || !existsSync(SNAPSHOT)) return
  assert.deepEqual(valore, JSON.parse(readFileSync(SNAPSHOT, 'utf-8'))[nome], `schermata "${nome}" cambiata`)
}

test('avvio con sessione: corsi per categoria, alias, corsi e categorie nascosti', async () => {
  const { page, errori, testo, chiudi } = await apri()
  try {
    await page.getByText('CORSI (6)').waitFor()
    const righe = await testo()
    assert.ok(righe.includes('Corporate Finance (Rinominato)'))
    assert.ok(!righe.some((r) => r.includes('Mathematics')))
    assert.ok(!righe.some((r) => r.includes('EXTRACURRICULAR')))
    fissa('principale', righe)
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('tutorial al primo avvio: sette passi, Salta lo segna come visto', async () => {
  const { page, errori, chiamate, testo, chiudi } = await apri({ tutorial: true })
  try {
    await page.getByText('1 / 7').waitFor()
    const passi = []
    for (let i = 1; i <= 7; i++) {
      await page.getByText(`${i} / 7`).waitFor()
      passi.push((await testo()).slice(-8))
      if (i < 7) await page.getByRole('button', { name: 'Avanti' }).click()
    }
    fissa('tutorial', passi)
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Salta' }).click()
    await page.getByText('1 / 7').waitFor({ state: 'detached' })
    assert.deepEqual((await chiamate('updateConfig')).at(-1), [{ tutorialDone: true }])
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('impostazioni: testi e salvataggio delle scelte', async () => {
  const { page, errori, chiamate, testo, chiudi } = await apri()
  try {
    await page.getByRole('button', { name: 'Impostazioni' }).click()
    await page.getByText('CARTELLA DI SINCRONIZZAZIONE').waitFor()
    const righe = await testo()
    fissa('impostazioni', righe.slice(righe.indexOf('Impostazioni')))
    for (const [ruolo, nome] of [['button', '2h'], ['switch', 'Notifiche'], ['switch', 'Avvia con Windows'], ['button', 'Chiaro'], ['button', 'EN']]) {
      await page.getByRole(ruolo, { name: nome, exact: true }).click()
    }
    fissa('impostazioni-salvate', await chiamate('updateConfig'))
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('ultimi download: elenco per corso e apertura del file', async () => {
  const { page, errori, chiamate, testo, chiudi } = await apri()
  try {
    await page.getByRole('button', { name: 'Ultimi download' }).click()
    await page.getByText('Clicca un file per aprirlo').waitFor()
    fissa('ultimi-download', await testo('[role="dialog"]'))
    const dialogo = page.getByRole('dialog')
    await dialogo.getByText('Macroeconomics').click()
    await dialogo.getByText('Lecture 12 - IS-LM.pdf').click()
    assert.deepEqual(await chiamate('openRecentDownload'), [['Macroeconomics/Lecture 12 - IS-LM.pdf', false]])
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('sincronizza ora avvia la sincronizzazione', async () => {
  const { page, errori, chiamate, chiudi } = await apri()
  try {
    await page.getByRole('button', { name: 'Sincronizza ora' }).click()
    await page.waitForFunction(() => window.__chiamate.some(([c]) => c === 'sync'))
    assert.equal((await chiamate('sync')).length, 1)
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('login: modulo, credenziali passate al backend, poi i corsi', async () => {
  const { page, errori, chiamate, testo, chiudi } = await apri({ disconnesso: true })
  try {
    await page.getByRole('button', { name: 'Accedi', exact: true }).waitFor()
    fissa('login', await testo())
    await page.fill('#username', 'studente.prova')
    await page.fill('#password', 'password-di-prova')
    await page.getByRole('button', { name: 'Accedi', exact: true }).click()
    await page.getByText('CORSI (6)').waitFor()
    assert.deepEqual((await chiamate('login'))[0].slice(0, 2), ['studente.prova', 'password-di-prova'])
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('elenco corsi: selezione, rinomina, nascondi e mostra salvano la config', async () => {
  const { page, errori, chiamate, chiudi } = await apri()
  try {
    await page.getByRole('checkbox', { name: 'Macroeconomics', exact: true }).click()
    await page.getByRole('checkbox', { name: 'Seleziona tutti i corsi: 2025/2026 SECOND SEMESTER' }).click()
    await page.getByRole('button', { name: 'Azioni', exact: true }).first().click()
    await page.locator('.course-actions-popup-item', { hasText: 'Rinomina' }).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.type('Macro')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Azioni', exact: true }).first().click()
    await page.locator('.course-actions-popup-item', { hasText: 'Nascondi' }).click()
    await page.getByRole('button', { name: /^[0-9]+ nascosti$/ }).first().click()
    await page.getByRole('button', { name: 'Mostra', exact: true }).first().click()
    await page.getByRole('button', { name: 'Nascondi categoria' }).first().dispatchEvent('click')
    await page.getByRole('button', { name: 'Cambia cartella' }).click()
    await page.waitForFunction(() => window.__chiamate.filter(([c]) => c === 'updateConfig').length >= 7)
    assert.deepEqual(await chiamate('updateConfig'), [
      [{ syncAllCourses: false, enabledCourses: ['_course2', '_course3', '_course4', '_course6', '_course7', '_course8', '_course9'] }],
      [{ syncAllCourses: false, enabledCourses: ['_course2', '_course3', '_course7', '_course8', '_course9'] }],
      [{ courseAliases: { _course3: 'Corporate Finance (Rinominato)', _course4: 'Macro' } }],
      [{ hiddenCourses: ['_course5', '_course4'] }],
      [{ hiddenCourses: ['_course5'] }],
      [{ hiddenTerms: ['_term3', '_term2'] }],
      [{ syncDir: 'C:\\Utenti\\Studente\\Documenti\\Blackboard' }],
    ])
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('due università: etichetta su ogni corso, corso nascosto mostrato con il docente', async () => {
  const { page, errori, testo, chiudi } = await apri({ polimi: true })
  try {
    await page.getByText('CORSI (7)').waitFor()
    await page.getByRole('button', { name: /^[0-9]+ nascosti$/ }).first().click()
    await page.getByText('Mathematics (nascosto)').waitFor()
    assert.deepEqual(await testo('.course-list'), [
      '2025/2026 SECOND SEMESTER', '2',
      'Microeconomics', 'BOCCONI', 'Prof. Neri',
      'Statistics', 'BOCCONI', 'Prof. Gialli',
      'Mathematics (nascosto)', 'BOCCONI', 'Prof. Blu',
      '2025/2026 FIRST SEMESTER', '4',
      'Macroeconomics', 'BOCCONI', 'Prof. Rossi',
      'Financial Accounting', 'BOCCONI', 'Prof. Bianchi',
      'Corporate Finance (Rinominato)', 'BOCCONI', 'Prof. Verdi',
      'INTERNET OF THINGS', 'POLIMI', 'Matteo Cesana',
      'ONLINE EXAMS', '1',
      'Online Exam Resources', 'BOCCONI',
    ])
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('riepilogo del sync: file per corso con università, forme al singolare', async () => {
  const { page, errori, testo, chiudi } = await apri()
  try {
    await page.getByText('CORSI (6)').waitFor()
    const fine = (risultato) => page.evaluate((r) => window.__syncComplete(r), risultato)
    await fine({ totalDownloaded: 1, totalScanned: 5, duration: 3, warnings: [], courses: [{ courseName: 'INTERNET OF THINGS', files: ['slides.pdf'], webeep: true }] })
    const primo = await testo('[role="dialog"]')
    await page.getByRole('dialog').getByRole('button', { name: 'Chiudi' }).click()
    await fine({ totalDownloaded: 0, totalScanned: 1, duration: 1, warnings: ['PoliMi: Sessione WeBeep scaduta'], courses: [] })
    assert.deepEqual([primo, await testo('[role="dialog"]')], [
      ['Sincronizzazione completata', '1 nuovo file scaricato in 3s', 'INTERNET OF THINGS', 'POLIMI', '1', 'slides.pdf', 'NUOVO', 'Chiudi'],
      ['Tutto aggiornato', 'Nessun nuovo file trovato · 1 file verificato', 'PoliMi: Sessione WeBeep scaduta', 'Chiudi'],
    ])
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})

test('finestre modali: Esc e clic fuori le chiudono, il focus resta dentro', async () => {
  const { page, errori, chiudi } = await apri()
  try {
    await page.getByRole('button', { name: 'Disconnetti', exact: true }).click()
    const conferma = page.getByRole('dialog')
    await conferma.waitFor()
    assert.ok(await conferma.evaluate((d) => d.contains(document.activeElement)))
    await page.keyboard.press('Escape')
    await conferma.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Ultimi download', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    await page.mouse.click(5, 300)
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    assert.deepEqual(errori, [])
  } finally {
    await chiudi()
  }
})
