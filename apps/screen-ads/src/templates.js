/**
 * Разметка сцен по шаблонам. Каждая функция получает сцену (scenes.js), её фото
 * (url — путь в dist/media) и готовый блок QR и возвращает HTML сцены. Движение —
 * в motion.js по атрибуту data-tpl; классы с префиксом a- — то, что анимируется.
 */

const brand = (cls = '') => `<div class="brand a-brand ${cls}"><img src="media/logo.png" alt=""><div>TITAN<small>клуб спортивной мафии</small></div></div>`
const img = (url, cls = '') => `<img class="ph ${cls}" src="${url}" alt="" decoding="async">`
const pills = (list) => (list ? `<div class="pills">${list.map((p) => `<span class="pill a-pill">${p}</span>`).join('')}</div>` : '')
const head = (s) => `${s.kicker ? `<p class="kicker a-kicker">${s.kicker}</p>` : ''}<h1 class="a-title" data-split="words">${s.title}</h1>`
const lead = (s) => (s.lead ? `<p class="lead a-lead">${s.lead}</p>` : '')

/** Фото, разрезанное на вертикальные полосы (для шаблона blinds). */
function strips(url, n, cls) {
  return `<div class="strips ${cls}">${Array.from({ length: n }, (_, i) =>
    `<div class="strip" style="--i:${i};--n:${n}"><div class="strip-in" style="background-image:url('${url}')"></div></div>`).join('')}</div>`
}

const T = {
  hero(s, ph, qr) {
    const mode = s.light ? 'light' : s.duo ? 'duo' : s.glass ? 'glass' : 'dark'
    const body = `${brand(s.light ? 'dark' : '')}<div class="mid">${head(s)}${lead(s)}${pills(s.pills)}</div>${qr}`
    return `<div class="bg a-bg" data-mode="${mode}">${img(ph[0])}</div><div class="shade a-shade"></div><div class="sweep a-sweep"></div>
      ${mode === 'glass' ? `<div class="glasscard a-glass">${body}</div>` : `<div class="col a-col">${body}</div>`}`
  },

  blinds(s, ph, qr) {
    return `<div class="bl-photos">${strips(ph[0], 7, 'a-strips1')}${strips(ph[1], 7, 'a-strips2')}</div><div class="bl-edge a-edge"></div>
      <div class="col">${brand()}<div class="mid">${head(s)}${lead(s)}${pills(s.pills)}</div>${qr}</div>`
  },

  mosaic(s, ph, qr) {
    return `<div class="mos-stage"><div class="mos a-mos">${ph.map((u, i) => `<div class="tile a-tile t${i}">${img(u)}</div>`).join('')}</div></div>
      <div class="mos-dim a-dim"></div>${brand('tl')}<div class="mos-panel a-panel">${head(s)}${lead(s)}</div>${qr}`
  },

  word(s, ph, qr) {
    const size = Math.min(360, Math.floor(1720 / (s.word.length * 0.66)))
    return `<div class="bg a-bg">${img(ph[0], 'dim')}</div><div class="wordwrap a-wordwrap"><div class="word" data-split="chars" style="font-size:${size}px;background-image:url('${ph[0]}')">${s.word}</div></div>
      <div class="word-line a-line"></div>${brand('tl')}<p class="wsub a-lead">${s.sub}</p>${qr}`
  },

  stat(s, ph, qr) {
    if (s.stats.length === 1) {
      const [v, unit, label] = s.stats[0]
      return `<div class="bg a-bg">${img(ph[0], 'dim')}</div><div class="shade a-shade"></div>${brand('tl')}
        <div class="bignum-wrap"><div class="bignum a-num" data-to="${v}" style="background-image:url('${ph[0]}')">0</div><div class="bigunit a-unit">${unit.trim()}</div></div>
        <div class="stat-text"><p class="kicker a-kicker">${s.kicker}</p><h1 class="a-title" data-split="words">${s.title}</h1><p class="lead a-lead">${s.lead}</p><p class="stat-label a-lead">${label}</p></div>${qr}`
    }
    return `<div class="bg a-bg">${img(ph[0])}</div><div class="bg2 a-bg2">${img(ph[1])}</div><div class="shade-bottom a-shade"></div>${brand('tl')}
      <div class="stats-box">${head(s)}<div class="stats">${s.stats.map(([v, unit, label]) =>
        `<div class="a-stat"><b><span class="a-count" data-to="${v}">0</span>${unit}</b><span>${label}</span></div>`).join('')}</div></div>${qr}`
  },

  noir(s, ph, qr) {
    return `<div class="bg noir-ph a-bg">${img(ph[0])}</div><div class="bg noir-ph a-bg2">${img(ph[1])}</div><div class="flash a-flash"></div>
      <div class="nshade"></div><div class="bar top a-bar"></div><div class="bar bot a-bar"></div>${brand('tl onbar')}
      <div class="ntitle"><h1 class="a-type" data-split="chars">${s.title}</h1><p class="a-stamp">${s.sub}</p><div class="credits a-lead">${s.credits}</div></div>${qr}`
  },

  polaroids(s, ph, qr) {
    const caps = ['вечер в клубе', 'за столом', 'новые знакомства', 'и это только начало']
    return `<div class="wall"></div><div class="col light">${brand('dark')}<div class="mid">${head(s)}${lead(s)}</div>${qr}</div>
      <div class="pols">${ph.map((u, i) => `<div class="pol a-pol p${i}"><div class="pimg">${img(u, 'a-develop')}</div><span>${caps[i]}</span></div>`).join('')}</div>`
  },

  diagonal(s, ph, qr) {
    const half = (u, [h, d], side) => `<div class="dh ${side}"><div class="dh-in a-dh">${img(u)}</div><div class="dshade"></div><div class="dlabel a-dlabel"><b>${h}</b><span>${d}</span></div></div>`
    return `${half(ph[0], s.a, 'da')}${half(ph[1], s.b, 'db')}<div class="dmid a-badge">или</div>
      <div class="dtitle">${brand()}<h1 class="a-title" data-split="words">${s.title}</h1></div>${qr}`
  },

  magazine(s, ph, qr) {
    return `<div class="bg a-mag">${img(ph[0])}</div><div class="mshade"></div><div class="mast" data-split="chars">TITAN</div><div class="missue a-issue">${s.issue}</div>
      <div class="mlines">${s.lines.map(([b, d]) => `<div class="a-line"><b>${b}</b><span>${d}</span></div>`).join('')}</div><div class="mbar a-qrbox">${qr}</div>`
  },

  phone(s, ph, qr) {
    const n = s.screens.length
    return `<div class="bg a-bg">${img(ph[0], 'blurred')}</div><div class="glow a-glow"></div>
      <div class="col">${brand()}<div class="mid">${head(s)}${lead(s)}</div>${qr}</div>
      <div class="phones n${n}">${s.screens.map((sc, i) => `<div class="phone a-phone ph${i}"><img src="media/${sc}.webp" alt=""><div class="glare"></div></div>`).join('')}</div>`
  },

  quote(s, ph, qr) {
    return `<div class="q-photo a-qphoto">${img(ph[0])}</div><div class="q-bg"></div>${brand('tl')}
      <div class="qbody"><div class="qq a-qq">“</div><p class="qtext" data-split="words">${s.text}</p><div class="qline a-qline"></div><p class="qauthor a-lead">${s.author}, гость клуба</p></div>${qr}`
  },

  faq(s, ph, qr) {
    return `<div class="faq-bg tone-${s.tone}"></div><div class="qmark a-qmark">?</div><div class="faq-photo a-circle">${img(ph[0])}</div>
      ${brand('tl')}<div class="fq"><h1 class="a-type" data-split="chars">${s.q}</h1><p class="lead a-lead">${s.a}</p>${qr}</div>`
  },

  steps(s, ph, qr) {
    return `<div class="bg a-bg">${img(ph[0], 'blurred')}</div><div class="glow"></div>${brand('tl')}<div class="thead">${head(s)}</div>
      <div class="tlw n${s.steps.length}"><div class="tline a-tline"></div>${s.steps.map(([b, d], i) =>
        `<div class="tstep a-step"><div class="tthumb">${img(ph[i] || ph[0])}</div><i>${String(i + 1).padStart(2, '0')}</i><b>${b}</b><span>${d}</span></div>`).join('')}</div>${qr}`
  },

  paper(s, ph, qr) {
    const back = `<div class="bg a-bg">${img(ph[ph.length - 1], 'blurred')}</div><div class="desk-shade"></div>`
    if (s.paper === 'wanted') {
      return `${back}<div class="paperobj wanted a-paper"><div class="wtop">${s.top}</div><div class="wphoto">${img(ph[0], 'a-develop sepia')}</div>
        <div class="wname">${s.name}</div><p class="wtext">${s.text}</p><div class="wreward">${s.reward}</div><div class="stamp a-stamp">Объявлен розыск</div></div>
        <div class="side">${brand()}${qr}</div>`
    }
    if (s.paper === 'dossier') {
      const pic = s.cover ? `<img class="ph" src="media/${s.cover}.webp" alt="">` : img(ph[0], 'a-develop')
      return `${back}<div class="paperobj folder a-paper"><div class="tab">${s.file}</div><div class="sheet"><div class="clip"></div><div class="dphoto a-pin">${pic}</div>
        <h2 class="a-type" data-split="chars">${s.heading}</h2><p class="a-lead">${s.body}</p><div class="stamp a-stamp">${s.stamp}</div></div></div><div class="side">${brand()}${qr}</div>`
    }
    if (s.paper === 'ticket') {
      return `${back}${brand('tl')}<div class="ticket a-paper"><div class="tmain"><p class="kicker">${s.kicker}</p><h1 class="a-title" data-split="words">${s.title}</h1>
        <div class="trows">${s.rows.map(([k, v]) => `<div class="a-row"><span>${k}</span><b>${v}</b></div>`).join('')}</div></div><div class="tstub a-stub">${qr}</div></div>`
    }
    if (s.paper === 'gift') {
      return `${back}<div class="col">${brand()}<div class="mid">${head(s)}${lead(s)}</div>${qr}</div>
        <div class="gift a-gift"><div class="gift-card"><div class="gc-photo">${img(ph[0])}</div><img class="gc-logo" src="media/logo.png" alt=""><p class="g1">Сертификат</p><p class="g2">на вечер мафии</p><div class="ribbon"></div><div class="gc-shine a-shine"></div></div></div>`
    }
    // books
    return `${back}<div class="col">${brand()}<div class="mid">${head(s)}${lead(s)}</div>${qr}</div>
      <div class="books">${['book-red', 'book-rules', 'book-zen'].map((b) => `<img class="a-book" src="media/${b}.webp" alt="">`).join('')}</div>`
  },

  neon(s, ph, qr) {
    return `<div class="bg a-bg">${img(ph[0], 'neon-ph')}</div><div class="neon-tint"></div>${brand('tl')}
      <div class="ntext"><div class="n1 a-n1">${s.line1}</div><div class="n2 a-n2">${s.line2}</div><p class="a-lead">${s.sub}</p></div>${qr}`
  },

  daynight(s, ph, qr) {
    return `<div class="half night a-night"><div class="hph">${img(ph[0])}</div><div class="night-tint"></div><div class="moon a-moon"></div>
        <div class="htext"><h2 data-split="chars">${s.night}</h2><p class="a-lead">${s.nightText}</p></div></div>
      <div class="half day a-day"><div class="hph">${img(ph[1])}</div><div class="day-tint"></div><div class="sun a-sun"></div>
        <div class="htext"><h2 data-split="chars">${s.day}</h2><p class="a-lead2">${s.dayText}</p></div></div>${brand('tc')}${qr}`
  },

  contact(s, ph, qr) {
    const col = (list, dir) => `<div class="mcol ${dir}"><div class="mcol-in a-marquee-${dir}">${[...list, ...list].map((u) => img(u)).join('')}</div></div>`
    return `<div class="marquee">${col(ph.slice(0, 3), 'up')}${col(ph.slice(3, 6), 'down')}${col([ph[1], ph[4], ph[2]], 'up')}</div><div class="marquee-dim"></div>
      <div class="ccard a-card">${brand('dark')}<p class="kicker">${s.kicker}</p><h1 class="a-title" data-split="words">${s.title}</h1><p class="lead a-lead">${s.lead}</p></div>${qr}`
  },

  tiles(s, ph, qr) {
    return `${ph.map((u, i) => `<div class="bg slide-bg a-slide s${i}">${img(u)}</div>`).join('')}<div class="tiles-shade"></div>${brand('tl')}
      <div class="thead">${head(s)}</div><div class="tiles">${s.tiles.map((t, i) => `<div class="tile-x a-tilex c${i % 4}">${t}</div>`).join('')}</div>${qr}`
  },

  grid(s, ph, qr) {
    return `<div class="glow"></div>${brand('tl')}<div class="ghead">${head(s)}</div>
      <div class="sgrid">${s.cards.map(([b, d], i) => `<div class="scard a-scard"><div class="scard-ph">${img(ph[i])}</div><div class="scard-t"><b>${b}</b><span>${d}</span></div></div>`).join('')}</div>${qr}`
  },

  poster(s, ph, qr) {
    return `<div class="grid-lines a-gridlines"></div><div class="pcircle a-circle">${img(ph[0])}</div>
      <div class="pbig" data-split="chars" style="font-size:${s.big.length > 6 ? 180 : 270}px">${s.big}</div><div class="paccent a-accent">${s.accent}</div>
      <div class="pcols">${s.cols.map((c) => `<p class="a-col-p">${c}</p>`).join('')}</div>${brand('dark pbrand')}${qr}`
  },

  chat(s, ph, qr) {
    return `<div class="bg a-bg">${img(ph[0], 'blurred')}</div><div class="glow"></div>
      <div class="col">${brand()}<div class="mid">${head(s)}${lead(s)}</div>${qr}</div>
      <div class="cwin a-cwin"><div class="chead"><img src="media/logo.png" alt=""><div><b>TITAN</b><span>бот клуба</span></div></div>
      <div class="cmsgs">${s.msgs.map(([d, m]) => `<div class="typing ${d} a-typing"><i></i><i></i><i></i></div><div class="msg ${d} a-msg">${m}</div>`).join('')}</div></div>`
  },
}

/** Где стоит QR в шаблоне: в колонке текста или в своём углу. */
const QR_POS = { hero: 'inline', blinds: 'inline', mosaic: 'br', word: 'br', stat: 'br', noir: 'br', polaroids: 'inline', diagonal: 'tr', magazine: 'mag',
  phone: 'inline', quote: 'br', faq: 'inline', steps: 'tr', paper: 'auto', neon: 'br', daynight: 'bc', contact: 'big', tiles: 'br', grid: 'right', poster: 'pq', chat: 'inline' }

module.exports = { T, QR_POS }
