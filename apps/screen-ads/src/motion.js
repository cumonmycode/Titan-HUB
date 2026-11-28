/**
 * Моушн рекламной сцены (GSAP). Одна временная шкала длиной ровно в показ:
 *   ?d=15 — сколько секунд сцену покажут (экран ТВ передаёт сам), уход — в последние 0,7 с;
 *   ?t=6  — перемотать в эту секунду и остановиться (статичный кадр и проверка по кадрам).
 * Сцена ждёт фото и шрифты, потом шлёт экрану «titan-ad-ready» и только тогда играет.
 * Движение — быстрые выразительные входы без отскоков (expo/power), затем медленная
 * «камера» по фото до конца показа.
 */
(function () {
  var q = new URLSearchParams(location.search)
  var D = Math.max(6, Number(q.get('d')) || 15)
  var SEEK = q.has('t') ? Number(q.get('t')) : null
  var stage = document.querySelector('.stage')
  var TPL = stage.getAttribute('data-tpl')
  var $ = function (s, root) { return (root || stage).querySelector(s) }
  var $$ = function (s, root) { return Array.prototype.slice.call((root || stage).querySelectorAll(s)) }
  var scale = 1

  function fit() {
    scale = Math.min(innerWidth / 1920, innerHeight / 1080)
    stage.style.transform = 'translate(' + (innerWidth - 1920 * scale) / 2 + 'px,' + (innerHeight - 1080 * scale) / 2 + 'px) scale(' + scale + ')'
  }

  // ── Разбивка текста: слова (с маской) и буквы (внутри неразрывных слов) ──
  function walk(el, onText) {
    Array.prototype.slice.call(el.childNodes).forEach(function (n) {
      if (n.nodeType === 3) onText(n)
      else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n, onText)
    })
  }
  function splitWords(el) {
    walk(el, function (t) {
      var frag = document.createDocumentFragment()
      t.nodeValue.split(/( +)/).forEach(function (part) {
        if (!part) return
        if (/^ +$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return }
        var w = document.createElement('span'); w.className = 'w'
        var wi = document.createElement('span'); wi.className = 'wi'; wi.textContent = part
        w.appendChild(wi); frag.appendChild(w)
      })
      t.parentNode.replaceChild(frag, t)
    })
  }
  function splitChars(el) {
    walk(el, function (t) {
      var frag = document.createDocumentFragment()
      t.nodeValue.split(/( +)/).forEach(function (part) {
        if (!part) return
        if (/^ +$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return }
        var cw = document.createElement('span'); cw.style.display = 'inline-block'; cw.style.whiteSpace = 'nowrap'
        Array.from(part).forEach(function (ch) { var c = document.createElement('span'); c.className = 'c'; c.textContent = ch; cw.appendChild(c) })
        frag.appendChild(cw)
      })
      t.parentNode.replaceChild(frag, t)
    })
  }
  $$('[data-split]').forEach(function (el) { el.getAttribute('data-split') === 'chars' ? splitChars(el) : splitWords(el) })

  // ── Ожидание фото и шрифтов ──
  function ready() {
    var urls = $$('img').map(function (i) { return i.src })
    $$('[style*="background-image"]').forEach(function (el) {
      var m = /url\(['"]?([^'")]+)['"]?\)/.exec(el.style.backgroundImage); if (m) urls.push(m[1])
    })
    var loads = urls.map(function (u) {
      return new Promise(function (res) { var im = new Image(); im.onload = im.onerror = function () { (im.decode ? im.decode() : Promise.resolve()).then(res, res) }; im.src = u })
    })
    var all = Promise.all(loads.concat([document.fonts ? document.fonts.ready : Promise.resolve()]))
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 8000) })])
  }

  // Буквы с фото внутри (шаблон word): каждой букве — своя часть общего фото.
  function photoLetters() {
    var word = $('.word'); if (!word) return
    var img = word.style.backgroundImage, box = word.getBoundingClientRect()
    word.style.backgroundImage = 'none'
    $$('.c', word).forEach(function (c) {
      var r = c.getBoundingClientRect()
      c.style.backgroundImage = img
      c.style.backgroundSize = '1920px 1080px'
      c.style.backgroundPosition = 'calc(var(--pan, 0px) - ' + (r.left - box.left) / scale + 'px) ' + -(r.top - box.top) / scale + 'px'
      c.style.webkitBackgroundClip = 'text'; c.style.backgroundClip = 'text'
    })
  }

  // ── Общие приёмы ──
  var tl
  var E = 'expo.out'
  function words(sel, at, root) { var w = $$(sel + ' .wi', root); if (w.length) tl.from(w, { yPercent: 118, rotate: 5, duration: 1.15, ease: E, stagger: 0.07 }, at) }
  function chars(sel, at, opts) {
    var c = $$(sel + ' .c'); if (!c.length) return at
    tl.from(c, Object.assign({ opacity: 0, y: 46, filter: 'blur(12px)', duration: 0.9, ease: E, stagger: 0.035 }, opts || {}), at)
    return at + c.length * ((opts && opts.stagger) || 0.035)
  }
  function type(sel, at, step) { var c = $$(sel + ' .c'); if (!c.length) return at; tl.from(c, { opacity: 0, duration: 0.01, stagger: step || 0.05 }, at); return at + c.length * (step || 0.05) }
  function fadeUp(sel, at, dur) { var el = $$(sel); if (el.length) tl.from(el, { opacity: 0, y: 34, duration: dur || 0.9, ease: 'power3.out', stagger: 0.12 }, at) }
  function kicker(at) { var k = $$('.a-kicker'); if (k.length) tl.from(k, { opacity: 0, letterSpacing: '0.75em', duration: 1.3, ease: E }, at) }
  function pills(at) { var p = $$('.a-pill'); if (p.length) tl.from(p, { opacity: 0, y: 24, scale: 0.92, duration: 0.7, ease: 'power3.out', stagger: 0.09 }, at) }
  function kb(target, from, to, at, dur) { var el = typeof target === 'string' ? $$(target) : target; if (el.length !== 0) tl.fromTo(el, from, Object.assign({ duration: dur || D - (at || 0), ease: 'none' }, to), at || 0) }
  function qr(at) {
    var box = $('.qr'); if (!box) return
    tl.from(box, { opacity: 0, y: 40, rotationX: -55, transformPerspective: 900, transformOrigin: '50% 100%', duration: 1, ease: E }, at)
    $$('.qc').forEach(function (qc) {
      for (var t = at + 1.1; t < D - 1.5; t += 4.2) tl.fromTo(qc, { '--shine': '-120%' }, { '--shine': '120%', duration: 1.1, ease: 'power2.inOut' }, t)
    })
  }
  function brand(at) { var b = $$('.a-brand'); if (b.length) tl.from(b, { opacity: 0, y: -24, duration: 1, ease: E }, at || 0.15) }
  function sweep(at) { var s = $('.a-sweep'); if (!s) return; tl.fromTo(s, { xPercent: -100 }, { xPercent: 100, duration: 1.7, ease: 'power2.inOut' }, at) }

  function atmosphere() {
    var grain = document.createElement('div'); grain.className = 'grain'
    var vig = document.createElement('div'); vig.className = 'vignette'
    var leak = document.createElement('div'); leak.className = 'leak'
    stage.appendChild(vig); stage.appendChild(grain); stage.appendChild(leak)
    tl.to(grain, { x: -140, y: 90, duration: D, ease: 'steps(' + Math.round(D * 12) + ')' }, 0)
    tl.fromTo(leak, { x: -1100, y: -700, opacity: 0 }, { x: 1500, y: 300, opacity: 1, duration: D * 0.55, ease: 'sine.inOut' }, 0.8)
    tl.to(leak, { opacity: 0, duration: D * 0.25 }, 0.8 + D * 0.55)
  }

  function outro() {
    var out = $$('.a-title .wi, .a-lead, .a-lead2, .a-kicker, .pills, .qr, .brand, .a-type, .a-stamp')
    if (out.length) tl.to(out, { y: -22, opacity: 0, duration: 0.5, ease: 'power2.in', stagger: 0.012 }, D - 0.7)
    tl.set({}, {}, D)
  }

  // ── Хореография шаблонов ──
  var CHOREO = {
    hero: function () {
      var mode = $('.a-bg').getAttribute('data-mode')
      tl.fromTo('.a-bg', { filter: 'blur(14px) brightness(.55)' }, { filter: 'blur(0px) brightness(1)', duration: 1.9, ease: E }, 0)
      tl.fromTo('.a-bg .ph', { scale: 1.38 }, { scale: 1.12, duration: 1.9, ease: E }, 0)
      tl.to('.a-bg .ph', { scale: 1.0, xPercent: -3, duration: D - 1.9, ease: 'none' }, 1.9)
      tl.from('.a-shade', { xPercent: mode === 'glass' ? 0 : -45, opacity: 0, duration: 1.3, ease: E }, 0.1)
      if (mode === 'glass') tl.from('.a-glass', { opacity: 0, y: 70, scale: 0.95, filter: 'blur(10px)', duration: 1.2, ease: E }, 0.35)
      kicker(0.45); words('.a-title', 0.6); fadeUp('.a-lead', 1.15); pills(1.4); qr(1.9)
      sweep(2.5); sweep(D * 0.62)
      var col = $('.a-col'); if (col) tl.to(col, { y: -12, duration: D - 3.5, ease: 'sine.inOut' }, 2.6)
    },

    blinds: function () {
      var s1 = $$('.a-strips1 .strip-in'), s2 = $$('.a-strips2 .strip-in')
      tl.set(s2, { yPercent: function (i) { return i % 2 ? -101 : 101 } }, 0)
      tl.from(s1, { yPercent: function (i) { return i % 2 ? 101 : -101 }, duration: 1.2, ease: 'power4.out', stagger: 0.07 }, 0.15)
      tl.to(s2, { yPercent: 0, duration: 1.25, ease: 'power4.inOut', stagger: 0.07 }, D * 0.47)
      kb('.bl-photos', { scale: 1.14 }, { scale: 1 }, 0)
      tl.from('.a-edge', { scaleY: 0, transformOrigin: '50% 0', duration: 1.2, ease: E }, 0.8)
      kicker(0.5); words('.a-title', 0.65); fadeUp('.a-lead', 1.2); pills(1.45); qr(2); brand()
    },

    mosaic: function () {
      var tiles = $$('.a-tile')
      tl.from(tiles, { scale: 0.25, opacity: 0, z: -900, rotation: function (i) { return [-14, 9, -6, 12, -10, 7][i % 6] }, duration: 1.4, ease: E, stagger: { each: 0.09, from: 'center' } }, 0.05)
      tiles.forEach(function (t, i) { kb($$('.ph', t), { scale: 1.3 }, { scale: 1.04, xPercent: i % 2 ? 3 : -3 }, 0) })
      kb('.a-mos', { rotationX: 18, rotationZ: -5, scale: 1.18 }, { rotationX: 5, rotationZ: -1.5, scale: 1.02 }, 0)
      tl.from('.a-dim', { opacity: 0, duration: 1.2, ease: 'power2.out' }, 0.9)
      tl.from('.a-panel', { scale: 0.92, opacity: 0, duration: 1.1, ease: E }, 1.0)
      kicker(1.0); words('.a-title', 1.15); fadeUp('.a-lead', 1.7); qr(2.2); brand(0.8)
    },

    word: function () {
      kb('.a-bg .ph', { scale: 1.28 }, { scale: 1.05 }, 0)
      var c = $$('.word .c')
      tl.from(c, { opacity: 0, scale: 2.3, y: function (i) { return [-90, 70, -40, 90, -70, 40, -20, 60, -50][i % 9] }, filter: 'blur(20px)', duration: 1.3, ease: E, stagger: { each: 0.07, from: 'center' } }, 0.3)
      tl.fromTo('.word', { '--pan': '0px' }, { '--pan': '-160px', duration: D, ease: 'none' }, 0)
      kb('.a-wordwrap', { scale: 1.06 }, { scale: 1 }, 0)
      tl.from('.a-line', { scaleX: 0, duration: 1.2, ease: E }, 1.3)
      fadeUp('.a-lead', 1.5); qr(2.1); brand()
    },

    stat: function () {
      kb('.a-bg .ph', { scale: 1.3 }, { scale: 1.04, xPercent: -2 }, 0)
      var fmt = function (v) { return Math.round(v).toLocaleString('ru-RU') }
      var num = $('.a-num')
      if (num) {
        var o = { v: 0 }, to = Number(num.getAttribute('data-to'))
        tl.from(num, { opacity: 0, scale: 0.8, filter: 'blur(16px)', transformOrigin: '0 50%', duration: 1.2, ease: E }, 0.35)
        tl.to(o, { v: to, duration: 1.9, ease: 'power3.out', onUpdate: function () { num.textContent = fmt(o.v) } }, 0.5)
        tl.from('.a-unit', { opacity: 0, x: -40, duration: 0.8, ease: E }, 2.0)
        tl.from('.a-shade', { opacity: 0, duration: 1 }, 0)
        kicker(1.0); words('.a-title', 1.1); fadeUp('.a-lead', 1.7)
      } else {
        tl.fromTo('.a-bg2', { opacity: 0 }, { opacity: 1, duration: 1.3, ease: 'power2.inOut' }, D * 0.5)
        kb('.a-bg2 .ph', { scale: 1.2 }, { scale: 1.04 }, D * 0.5)
        words('.a-title', 0.5)
        $$('.a-count').forEach(function (el, i) {
          var o = { v: 0 }, to = Number(el.getAttribute('data-to'))
          tl.to(o, { v: to, duration: 2, ease: 'power3.out', onUpdate: function () { el.textContent = fmt(o.v) } }, 1.0 + i * 0.3)
        })
        tl.from('.a-stat', { opacity: 0, y: 50, duration: 1, ease: E, stagger: 0.3 }, 1.0)
      }
      qr(2.3); brand()
    },

    noir: function () {
      tl.to('.a-bar', { height: 110, duration: 1.1, ease: 'power4.inOut' }, 0)
      kb('.a-bg .ph', { scale: 1.04 }, { scale: 1.26 }, 0)
      tl.to('.a-flash', { opacity: 0.85, duration: 0.07 }, D * 0.48)
      tl.set('.a-bg2', { opacity: 1 }, D * 0.48 + 0.06)
      tl.to('.a-flash', { opacity: 0, duration: 0.7, ease: 'power2.out' }, D * 0.48 + 0.08)
      kb('.a-bg2 .ph', { scale: 1.2 }, { scale: 1.02, xPercent: 2 }, D * 0.48)
      var end = type('.a-type', 0.9, 0.055)
      tl.from('.a-stamp', { scale: 2.6, opacity: 0, rotate: -7, duration: 0.32, ease: 'power4.in' }, end + 0.2)
      fadeUp('.a-lead', end + 0.6); qr(end + 0.9); brand(0.9)
    },

    polaroids: function () {
      var rot = [-7, 5, 4, -4]
      var pols = $$('.a-pol')
      tl.set(pols, { rotation: function (i) { return rot[i] } }, 0)
      tl.from(pols, { y: -1000, rotation: function (i) { return rot[i] * -4 }, duration: 0.95, ease: 'power4.out', stagger: 0.3 }, 0.3)
      $$('.a-develop').forEach(function (im, i) {
        tl.fromTo(im, { filter: 'brightness(2.4) saturate(0) blur(5px)' }, { filter: 'brightness(1) saturate(1) blur(0px)', duration: 2.6, ease: 'power2.out' }, 0.7 + i * 0.3)
        kb([im], { scale: 1.18 }, { scale: 1.02 }, 0.7 + i * 0.3)
      })
      pols.forEach(function (p, i) { tl.to(p, { y: i % 2 ? 14 : -12, rotation: rot[i] + (i % 2 ? -1.5 : 1.5), duration: D - 3.5, ease: 'sine.inOut' }, 2.8) })
      kicker(0.5); words('.a-title', 0.7); fadeUp('.a-lead', 1.3); qr(2); brand()
    },

    diagonal: function () {
      tl.from('.da', { x: -1150, duration: 1.3, ease: 'power4.out' }, 0.1)
      tl.from('.db', { x: 1150, duration: 1.3, ease: 'power4.out' }, 0.25)
      kb('.a-dh .ph', { scale: 1.22 }, { scale: 1.02 }, 0)
      tl.from('.a-badge', { scale: 0, rotation: -200, duration: 0.95, ease: E }, 1.05)
      tl.to('.a-badge', { rotation: 12, duration: D - 3, ease: 'sine.inOut' }, 2.2)
      tl.from('.a-dlabel', { opacity: 0, y: 50, duration: 1, ease: E, stagger: 0.18 }, 1.3)
      words('.a-title', 0.85); qr(2); brand(0.7)
    },

    magazine: function () {
      tl.fromTo('.a-mag .ph', { scale: 2.1, transformOrigin: '55% 35%' }, { scale: 1.05, duration: 2.7, ease: 'power4.inOut' }, 0)
      tl.to('.a-mag .ph', { scale: 1.0, duration: D - 2.7, ease: 'none' }, 2.7)
      chars('.mast', 1.25, { y: -120, filter: 'blur(0px)', stagger: 0.08 })
      tl.from('.a-issue', { clipPath: 'inset(0 100% 0 0)', duration: 0.7, ease: 'power4.inOut' }, 1.9)
      tl.from('.a-line', { opacity: 0, x: -70, duration: 0.9, ease: E, stagger: 0.15 }, 2.0)
      tl.from('.a-qrbox', { opacity: 0, y: 40, duration: 0.9, ease: E }, 2.7)
    },

    phone: function () {
      kb('.a-bg .ph', { scale: 1.32 }, { scale: 1.14 }, 0)
      tl.from('.a-glow', { opacity: 0, duration: 1.5 }, 0.3)
      var ph = $$('.a-phone')
      tl.from(ph, { y: 340, rotationY: -42, rotationX: 22, opacity: 0, duration: 1.5, ease: E, stagger: 0.16 }, 0.5)
      tl.to(ph, { rotationY: -10, rotationX: 4, y: -18, duration: D - 2.5, ease: 'sine.inOut', stagger: 0.2 }, 2.0)
      ph.forEach(function (p) { for (var t = 2.3; t < D - 2; t += 5) tl.fromTo(p.querySelector('.glare'), { '--g': '-120%' }, { '--g': '120%', duration: 1.4, ease: 'power2.inOut' }, t) })
      kicker(0.3); words('.a-title', 0.45); fadeUp('.a-lead', 1.0); qr(1.8); brand()
    },

    quote: function () {
      tl.from('.a-qphoto', { clipPath: 'inset(0 0 0 100%)', duration: 1.4, ease: 'power4.inOut' }, 0.1)
      kb('.a-qphoto .ph', { scale: 1.3 }, { scale: 1.02, yPercent: -2 }, 0)
      tl.from('.a-qq', { scale: 0, opacity: 0, rotate: -25, duration: 1, ease: E }, 0.6)
      var w = $$('.qtext .wi')
      tl.from(w, { opacity: 0.08, duration: 0.35, ease: 'power1.out', stagger: Math.min(0.14, 4.5 / w.length) }, 1.0)
      var end = 1.0 + w.length * Math.min(0.14, 4.5 / w.length)
      tl.from('.a-qline', { scaleX: 0, duration: 0.9, ease: E }, end + 0.1)
      fadeUp('.a-lead', end + 0.3); qr(end + 0.6); brand()
    },

    faq: function () {
      tl.from('.a-qmark', { rotation: -35, scale: 0.6, opacity: 0, duration: 1.5, ease: E }, 0)
      tl.to('.a-qmark', { rotation: 9, duration: D - 1.5, ease: 'sine.inOut' }, 1.5)
      tl.to('.a-circle', { clipPath: 'circle(50% at 50% 50%)', duration: 1.5, ease: 'power4.inOut' }, 0.45)
      kb('.a-circle .ph', { scale: 1.3 }, { scale: 1.03 }, 0)
      var end = type('.a-type', 1.0, 0.045)
      fadeUp('.a-lead', end + 0.25); qr(end + 0.7); brand()
    },

    steps: function () {
      kb('.a-bg .ph', { scale: 1.3 }, { scale: 1.12 }, 0)
      kicker(0.3); words('.a-title', 0.45)
      tl.from('.a-tline', { scaleX: 0, duration: 1.8, ease: 'power3.inOut' }, 0.9)
      var st = $$('.a-step')
      st.forEach(function (s, i) {
        var at = 1.1 + i * 0.38
        tl.from(s, { opacity: 0, y: 50, duration: 0.9, ease: E }, at)
        tl.from($('.tthumb', s), { rotationY: 100, transformPerspective: 700, duration: 1, ease: E }, at)
        kb($$('.tthumb .ph', s), { scale: 1.35 }, { scale: 1.05 }, at)
      })
      qr(1.4 + st.length * 0.38); brand()
    },

    paper: function () {
      kb('.a-bg .ph', { scale: 1.3 }, { scale: 1.12, xPercent: -2 }, 0)
      var p = $('.a-paper')
      if (p && p.classList.contains('wanted')) tl.fromTo(p, { y: 1250, rotation: -16 }, { y: 0, rotation: -1.5, duration: 1.35, ease: 'power4.out' }, 0.1)
      else if (p && p.classList.contains('folder')) tl.fromTo(p, { y: 1250, rotation: 12 }, { y: 0, rotation: -1.5, duration: 1.35, ease: 'power4.out' }, 0.1)
      else if (p) tl.fromTo(p, { x: -1900, rotation: -9 }, { x: 0, rotation: -2, duration: 1.3, ease: 'power4.out' }, 0.2)
      $$('.a-develop').forEach(function (im) { tl.fromTo(im, { filter: 'brightness(2.4) saturate(0) blur(5px)' }, { filter: 'brightness(1) saturate(1) blur(0px)', duration: 2.4, ease: 'power2.out' }, 1.0); kb([im], { scale: 1.2 }, { scale: 1.02 }, 1.0) })
      var end = type('.a-type', 1.3, 0.04)
      fadeUp('.a-lead', Math.max(end, 1.6) + 0.1)
      var stamp = $('.a-stamp')
      if (stamp) tl.fromTo(stamp, { scale: 2.7, opacity: 0 }, { scale: 1, opacity: 0.88, rotation: p && p.classList.contains('wanted') ? -14 : -12, duration: 0.3, ease: 'power4.in' }, Math.max(end, 2.4) + 0.4)
      var rows = $$('.a-row'); if (rows.length) tl.from(rows, { opacity: 0, y: 30, duration: 0.8, ease: E, stagger: 0.15 }, 1.6)
      if ($('.a-stub')) tl.to('.a-stub', { x: 34, rotation: 3.5, duration: 0.7, ease: 'power3.out' }, 3.2)
      var gift = $('.gift-card')
      if (gift) {
        tl.fromTo(gift, { rotationY: -115, rotationX: 22, z: -500, opacity: 0 }, { rotationY: -14, rotationX: 7, z: 0, opacity: 1, duration: 1.6, ease: E }, 0.5)
        tl.to(gift, { rotationY: -3, rotationX: 2, duration: D - 2.5, ease: 'sine.inOut' }, 2.1)
        kb('.gc-photo .ph', { scale: 1.3 }, { scale: 1.05 }, 0)
        for (var t = 2.2; t < D - 2; t += 4.5) tl.fromTo('.a-shine', { xPercent: -120 }, { xPercent: 120, duration: 1.3, ease: 'power2.inOut' }, t)
      }
      var books = $$('.a-book')
      if (books.length) {
        var fin = [{ rotation: -8, x: 40, y: 30 }, { rotation: 0, x: 0, y: -30 }, { rotation: 8, x: -40, y: 30 }]
        books.forEach(function (b, i) { tl.fromTo(b, { y: 700, rotation: i * 30 - 30, opacity: 0 }, Object.assign({ opacity: 1, duration: 1.2, ease: 'power4.out' }, fin[i]), 0.4 + i * 0.18) })
        tl.to(books, { y: '-=14', duration: D - 3, ease: 'sine.inOut', stagger: 0.3 }, 2.2)
      }
      kicker(0.5); words('.a-title', 0.65); qr(2.2); brand()
    },

    neon: function () {
      kb('.a-bg .ph', { scale: 1.3 }, { scale: 1.06, xPercent: -3 }, 0)
      var flick = [{ opacity: 1, duration: 0.05 }, { opacity: 0.12, duration: 0.09 }, { opacity: 1, duration: 0.05 }, { opacity: 0.3, duration: 0.14 }, { opacity: 1, duration: 0.07 }]
      tl.fromTo('.a-n1', { opacity: 0 }, { keyframes: flick }, 0.6)
      tl.fromTo('.a-n2', { opacity: 0 }, { keyframes: flick }, 1.25)
      tl.to('.a-n2', { keyframes: [{ opacity: 0.25, duration: 0.06 }, { opacity: 1, duration: 0.08 }] }, D * 0.55)
      tl.to('.a-n1', { opacity: 0.82, duration: 1.2, yoyo: true, repeat: Math.max(1, Math.floor((D - 4) / 1.2) - 1), ease: 'sine.inOut' }, 2.5)
      fadeUp('.a-lead', 2.0); qr(2.3); brand()
    },

    daynight: function () {
      tl.from('.a-night', { clipPath: 'inset(0 100% 0 0)', duration: 1.3, ease: 'power4.inOut' }, 0.05)
      kb('.a-night .ph', { scale: 1.3 }, { scale: 1.05 }, 0)
      tl.from('.a-moon', { y: 240, opacity: 0, duration: 2.2, ease: 'power2.out' }, 0.7)
      chars('.night h2', 1.0)
      fadeUp('.a-lead', 1.9)
      tl.from('.a-day', { clipPath: 'inset(0 0 0 100%)', duration: 1.4, ease: 'power4.inOut' }, 2.5)
      kb('.a-day .ph', { scale: 1.3 }, { scale: 1.05 }, 2.5)
      tl.from('.a-sun', { y: 320, opacity: 0, duration: 2.2, ease: 'power2.out' }, 3.0)
      chars('.day h2', 3.2)
      fadeUp('.a-lead2', 4.0); qr(4.3); brand(0.2)
    },

    contact: function () {
      tl.fromTo('.a-marquee-up', { yPercent: 0 }, { yPercent: -50, duration: D, ease: 'none' }, 0)
      tl.fromTo('.a-marquee-down', { yPercent: -50 }, { yPercent: 0, duration: D, ease: 'none' }, 0)
      tl.from('.marquee', { opacity: 0, scale: 1.15, duration: 1.4, ease: E }, 0)
      tl.from('.a-card', { x: -260, opacity: 0, duration: 1.2, ease: E }, 0.2)
      kicker(0.5); words('.a-title', 0.6); fadeUp('.a-lead', 1.1)
      var box = $('.qr')
      if (box) {
        tl.from(box, { scale: 0.7, opacity: 0, rotation: -8, duration: 1.1, ease: E }, 0.9)
        for (var t = 2.2; t < D - 1.5; t += 4) tl.fromTo('.qc', { '--shine': '-120%' }, { '--shine': '120%', duration: 1.1, ease: 'power2.inOut' }, t)
      }
      brand(0.4)
    },

    tiles: function () {
      var sl = $$('.a-slide'), part = D / sl.length
      sl.forEach(function (s, i) {
        if (i) tl.fromTo(s, { opacity: 0 }, { opacity: 1, duration: 1.2, ease: 'power2.inOut' }, part * i)
        kb($$('.ph', s), { scale: 1.2 }, { scale: 1.02, xPercent: i % 2 ? 2 : -2 }, part * i, part + 1.2)
      })
      tl.from('.a-tilex', { y: 90, opacity: 0, scale: 0.8, rotation: function (i) { return [-12, 9, -6, 11, -9, 6, -11][i % 7] }, duration: 0.9, ease: E, stagger: 0.1 }, 1.2)
      tl.to('.a-tilex', { rotation: function (i) { return i % 2 ? 1.5 : -2 }, duration: 0.6, ease: 'power2.out' }, 2.4)
      kicker(0.3); words('.a-title', 0.45); qr(2.1); brand()
    },

    grid: function () {
      var cards = $$('.a-scard')
      tl.from(cards, { clipPath: 'inset(100% 0 0 0)', duration: 1, ease: 'power4.out', stagger: { each: 0.08, grid: [3, 3], from: 'start' } }, 0.6)
      cards.forEach(function (c, i) { kb($$('.ph', c), { scale: 1.35 }, { scale: 1.05, xPercent: i % 2 ? 2 : -2 }, 0) })
      tl.from($$('.scard-t'), { opacity: 0, y: 24, duration: 0.7, ease: E, stagger: 0.08 }, 1.2)
      kicker(0.2); words('.a-title', 0.35); qr(2.2); brand()
    },

    poster: function () {
      tl.from('.a-gridlines', { scaleX: 0, duration: 1.3, ease: 'power3.inOut' }, 0)
      tl.from('.a-circle', { scale: 0, duration: 1.3, ease: E }, 0.3)
      kb('.a-circle .ph', { scale: 1.45 }, { scale: 1.02 }, 0.3)
      chars('.pbig', 0.5, { y: 140, filter: 'blur(0px)', stagger: 0.05 })
      tl.from('.a-accent', { clipPath: 'inset(0 100% 0 0)', duration: 0.85, ease: 'power4.inOut' }, 1.15)
      tl.from('.a-col-p', { opacity: 0, y: 34, duration: 0.9, ease: E, stagger: 0.15 }, 1.6)
      qr(2.2); brand(1.9)
    },

    chat: function () {
      kb('.a-bg .ph', { scale: 1.32 }, { scale: 1.12 }, 0)
      tl.from('.a-cwin', { y: 260, rotationX: 24, transformPerspective: 1400, opacity: 0, duration: 1.3, ease: E }, 0.5)
      var typing = $$('.a-typing'), msgs = $$('.a-msg')
      tl.set(msgs, { display: 'none' }, 0)
      tl.set(typing, { display: 'none' }, 0)
      msgs.forEach(function (m, i) {
        var t0 = 1.7 + i * 1.5
        tl.set(typing[i], { display: 'flex', opacity: 1 }, t0)
        tl.fromTo($$('i', typing[i]), { y: 0 }, { y: -6, duration: 0.3, ease: 'sine.inOut', yoyo: true, repeat: 2, stagger: 0.1 }, t0)
        tl.set(typing[i], { display: 'none' }, t0 + 0.9)
        tl.set(m, { display: 'block' }, t0 + 0.9)
        tl.from(m, { opacity: 0, y: 24, scale: 0.94, transformOrigin: m.classList.contains('out') ? '100% 100%' : '0 100%', duration: 0.5, ease: 'power3.out', immediateRender: false }, t0 + 0.9)
      })
      kicker(0.3); words('.a-title', 0.45); fadeUp('.a-lead', 1.0); qr(1.6); brand()
    },
  }

  fit()
  addEventListener('resize', fit)
  ready().then(function () {
    photoLetters()
    tl = gsap.timeline({ paused: true })
    atmosphere()
    ;(CHOREO[TPL] || CHOREO.hero)()
    outro()
    stage.classList.add('go')
    if (SEEK !== null) { tl.seek(Math.min(SEEK, D), false).pause(); document.body.setAttribute('data-ready', '1'); return }
    try { parent.postMessage({ type: 'titan-ad-ready' }, '*') } catch (e) { /* не во фрейме */ }
    tl.play()
  })
})()
