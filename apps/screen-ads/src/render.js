/**
 * Кадры сцен через Chrome headless (сцена перематывается параметром ?t= и замирает):
 *   node src/render.js posters              — dist/posters/<id>.jpg, кадр на 7-й секунде
 *   node src/render.js frames <out> <t,t…> [id…] — кадры для проверки моушна в <out>/<id>-<t>.png
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFile } = require('child_process')

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DIST = path.join(__dirname, '..', 'dist')
const PARALLEL = 6
const POSTER_T = 7

function shot(id, t, out) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-ad-'))
  const url = `file://${DIST}/${id}.html?d=15&t=${t}`
  return new Promise((resolve) => {
    execFile(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1',
      '--virtual-time-budget=12000', '--window-size=1920,1080', `--user-data-dir=${profile}`, `--screenshot=${out}`, url], { timeout: 90_000 }, (err) => {
      fs.rmSync(profile, { recursive: true, force: true })
      resolve(err ? `${id}@${t}: ${err.message}` : null)
    })
  })
}

async function pool(jobs) {
  const errors = []
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (jobs.length) { const e = await jobs.shift()(); if (e) errors.push(e) }
  }))
  return errors
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  const all = JSON.parse(fs.readFileSync(path.join(DIST, 'scenes.json'), 'utf8')).map((s) => s.id)
  let errors
  if (mode === 'posters') {
    const dir = path.join(DIST, 'posters')
    fs.mkdirSync(dir, { recursive: true })
    errors = await pool(all.map((id) => () => shot(id, POSTER_T, path.join(dir, `${id}.png`))))
  } else if (mode === 'frames') {
    const [out, times, ...ids] = args
    fs.mkdirSync(out, { recursive: true })
    const ts = times.split(',').map(Number)
    errors = await pool((ids.length ? ids : all).flatMap((id) => ts.map((t) => () => shot(id, t, path.join(out, `${id}-${t}.png`)))))
  } else {
    console.error('node src/render.js posters | frames <out> <t,t…> [id…]'); process.exitCode = 1; return
  }
  console.log(errors.length ? `ошибки:\n${errors.join('\n')}` : 'готово')
}

main()
