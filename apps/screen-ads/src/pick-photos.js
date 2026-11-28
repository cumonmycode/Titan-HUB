/**
 * Подбор фото из архива клуба для сцен — без повторов между сценами.
 *
 * Вход: .cache/land.tsv и .cache/port.tsv — выгрузка smm_library (горизонтальные и
 * вертикальные фото качества ≥ 4, без Хэллоуина): drive_id, quality, people, path,
 * description, tags. Выход: photos.json — { сцена: [{ id, o }] } (id — drive_id или
 * site:<имя> для фото с сайта). Уже выбранные фото в photos.json сохраняются, если их
 * не убрать вручную, — так можно заменить отдельный кадр, не перетасовав остальные.
 *
 * Серию одного момента (несколько кадров подряд) отсекаем по одинаковому описанию.
 */
const fs = require('fs')
const path = require('path')
const scenes = require('./scenes')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'photos.json')

function readTsv(file, o) {
  return fs.readFileSync(path.join(ROOT, '.cache', file), 'utf8').trim().split('\n').map((line) => {
    const [id, quality, people, p, description, tags] = line.split('\t')
    return { id, o, quality: Number(quality), people: Number(people), text: `${description} ${tags} ${p}`.toLowerCase(), description: (description || '').trim().toLowerCase() }
  })
}

// Стабильный «случайный» порядок, чтобы равные по качеству кадры шли вперемешку.
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0 }

function main() {
  const pool = { land: readTsv('land.tsv', 'land'), port: readTsv('port.tsv', 'port') }
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
  const used = new Set()
  const usedDesc = new Set()
  const result = {}
  const descOf = new Map([...pool.land, ...pool.port].map((p) => [p.id, p.description]))
  const keep = (id) => { used.add(id); const d = descOf.get(id); if (d) usedDesc.add(d) }
  const wantOf = (s) => (s.ph || []).length + (s.site || []).length

  // Сначала — то, что уже выбрано, чтобы новые подборы это не взяли.
  for (const s of scenes) if (prev[s.id] && prev[s.id].length === wantOf(s)) prev[s.id].forEach((p) => keep(p.id))
  let missing = 0
  for (const s of scenes) {
    if (prev[s.id] && prev[s.id].length === wantOf(s)) { result[s.id] = prev[s.id]; continue }
    const picked = (s.site || []).map((name) => ({ id: `site:${name}`, o: 'land' }))
    for (const { q, o } of s.ph || []) {
      const re = new RegExp(q, 'i')
      const free = (p) => !used.has(p.id) && !usedDesc.has(p.description)
      const rank = (a, b) => b.quality - a.quality || Math.min(b.people, 1) - Math.min(a.people, 1) || hash(a.id + s.id) - hash(b.id + s.id)
      let cands = pool[o].filter((p) => free(p) && re.test(p.text)).sort(rank)
      if (!cands.length) {
        missing++
        console.warn(`  ${s.id}: по «${q}» (${o}) свободных нет — берём любое хорошее`)
        cands = pool[o].filter((p) => free(p) && p.quality >= 5 && p.people > 0).sort(rank)
      }
      const p = cands[0]
      keep(p.id)
      picked.push({ id: p.id, o })
    }
    result[s.id] = picked
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n')
  const all = Object.values(result).flat()
  console.log(`${scenes.length} сцен, ${all.length} фото, уникальных ${new Set(all.map((p) => p.id)).size}, без точного совпадения запроса: ${missing}`)
}

main()
