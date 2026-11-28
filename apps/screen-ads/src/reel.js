/**
 * Ролик: все сцены подряд по кругу, без остановок. Следующая сцена подгружается заранее,
 * входит переходом внахлёст, пока предыдущая ещё движется; после перехода предыдущая
 * удаляется (в документе не больше двух сцен). Переходы — на transform и opacity.
 * window.REEL = [{ id, tpl, cls, d, html }] — из build.js.
 */
(function () {
  var LIST = window.REEL || []
  if (!LIST.length) return
  var reel = document.querySelector('.reel')
  var scale = TitanFit(reel)
  addEventListener('resize', function () { scale = TitanFit(reel) })
  var TR = 1.1
  var index = 0, cur = null, sent = false, pre = {}

  function preload(s) {
    if (!pre[s.id]) { var box = document.createElement('div'); box.innerHTML = s.html; pre[s.id] = TitanLoad(box) }
    return pre[s.id]
  }
  function mount(s) {
    var el = document.createElement('div')
    el.className = s.cls
    el.setAttribute('data-tpl', s.tpl)
    el.innerHTML = s.html
    reel.appendChild(el)
    return el
  }
  function overlay(css) {
    var d = document.createElement('div')
    d.className = 'tr-bar'
    for (var k in css) d.style[k] = css[k]
    reel.appendChild(d)
    return d
  }
  function drop(el) { if (el && el.parentNode) el.parentNode.removeChild(el) }

  // ── Переходы: a — уходящая сцена, b — входящая ──
  var TRANSITIONS = [
    function zoomThrough(a, b) {
      return gsap.timeline()
        .to(a, { scale: 1.45, opacity: 0, duration: TR, ease: 'power2.in' }, 0)
        .fromTo(b, { scale: 0.82, opacity: 0 }, { scale: 1, opacity: 1, duration: TR, ease: 'expo.out' }, 0.3)
    },
    function violetWipe(a, b) {
      var band = overlay({ left: '0', top: '-30%', width: '2700px', height: '160%', background: 'linear-gradient(90deg, #5b21b6, #8b5cf6 40%, #c4b5fd 50%, #8b5cf6 60%, #5b21b6)', transform: 'translateX(-2900px) skewX(-14deg)' })
      gsap.set(b, { opacity: 0 })
      return gsap.timeline({ onComplete: function () { drop(band) } })
        .to(band, { x: 2900, duration: TR * 1.2, ease: 'power3.inOut' }, 0)
        .set(b, { opacity: 1 }, TR * 0.6).set(a, { opacity: 0 }, TR * 0.6)
        .fromTo(b, { x: -120 }, { x: 0, duration: TR, ease: 'expo.out' }, TR * 0.6)
    },
    function push(a, b) {
      return gsap.timeline()
        .to(a, { x: -1920, duration: TR, ease: 'power4.inOut' }, 0)
        .fromTo(b, { x: 1920 }, { x: 0, duration: TR, ease: 'power4.inOut' }, 0)
    },
    function iris(a, b) {
      return gsap.timeline()
        .fromTo(b, { clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)', duration: TR, ease: 'power3.inOut' }, 0)
        .to(a, { scale: 1.12, duration: TR, ease: 'power2.in' }, 0)
        .set(b, { clipPath: 'none' })
    },
    function shutter(a, b) {
      var strips = []
      for (var i = 0; i < 7; i++) strips.push(overlay({ left: (i * 1920 / 7) + 'px', top: '0', width: Math.ceil(1920 / 7) + 2 + 'px', height: '1080px', background: i % 2 ? '#7c3aed' : '#8b5cf6', transform: 'scaleY(0)', transformOrigin: '50% 0' }))
      gsap.set(b, { opacity: 0 })
      return gsap.timeline({ onComplete: function () { strips.forEach(drop) } })
        .to(strips, { scaleY: 1, duration: TR * 0.5, ease: 'power3.in', stagger: 0.04 }, 0)
        .set(b, { opacity: 1 }).set(a, { opacity: 0 })
        .set(strips, { transformOrigin: '50% 100%' })
        .to(strips, { scaleY: 0, duration: TR * 0.6, ease: 'power3.out', stagger: 0.04 })
    },
    function logoFly(a, b) {
      var logo = document.createElement('img')
      logo.src = 'media/logo.png'
      logo.className = 'tr-bar'
      logo.style.cssText = 'left:704px;top:284px;width:512px;height:512px;transform:scale(.05);opacity:0'
      reel.appendChild(logo)
      gsap.set(b, { opacity: 0 })
      return gsap.timeline({ onComplete: function () { drop(logo) } })
        .to(logo, { opacity: 1, duration: 0.15 }, 0)
        .to(logo, { scale: 34, duration: TR, ease: 'power3.in' }, 0)
        .set(b, { opacity: 1 }, TR).set(a, { opacity: 0 }, TR)
        .to(logo, { opacity: 0, duration: 0.5, ease: 'power2.out' }, TR)
        .fromTo(b, { scale: 1.12 }, { scale: 1, duration: 1, ease: 'expo.out' }, TR)
    },
    function flashCut(a, b) {
      var flash = overlay({ left: '0', top: '0', width: '1920px', height: '1080px', background: '#fff', opacity: '0' })
      gsap.set(b, { opacity: 0 })
      return gsap.timeline({ onComplete: function () { drop(flash) } })
        .to(a, { scale: 1.08, duration: 0.35, ease: 'power2.in' }, 0)
        .to(flash, { opacity: 1, duration: 0.12 }, 0.25)
        .set(b, { opacity: 1 }, 0.37).set(a, { opacity: 0 }, 0.37)
        .fromTo(b, { scale: 1.18 }, { scale: 1, duration: 1.1, ease: 'expo.out' }, 0.37)
        .to(flash, { opacity: 0, duration: 0.7, ease: 'power2.out' }, 0.37)
    },
    function riseUp(a, b) {
      return gsap.timeline()
        .to(a, { y: -380, opacity: 0.2, duration: TR, ease: 'power3.inOut' }, 0)
        .fromTo(b, { y: 1080 }, { y: 0, duration: TR, ease: 'power4.inOut' }, 0)
    },
    function spin(a, b) {
      return gsap.timeline()
        .to(a, { rotation: -7, scale: 1.4, opacity: 0, duration: TR, ease: 'power2.in' }, 0)
        .fromTo(b, { rotation: 7, scale: 1.35, opacity: 0 }, { rotation: 0, scale: 1, opacity: 1, duration: TR, ease: 'expo.out' }, 0.25)
    },
  ]

  function next() {
    var k = index++
    var s = LIST[k % LIST.length]
    preload(s).then(function () {
      var el = mount(s)
      var scene = TitanScene(el, s.d, { scale: scale, noOutro: true })
      return Promise.race([scene.ready(), new Promise(function (r) { setTimeout(r, 3000) })]).then(function () {
        delete pre[s.id]
        var tl = scene.build()
        var prev = cur
        cur = { el: el, tl: tl }
        if (prev) {
          var tr = TRANSITIONS[k % TRANSITIONS.length](prev.el, el)
          tr.eventCallback('onComplete', function () { prev.tl.kill(); drop(prev.el) })
        }
        tl.play()
        if (!sent) { sent = true; try { parent.postMessage({ type: 'titan-ad-ready' }, '*') } catch (e) { /* не во фрейме */ } }
        preload(LIST[index % LIST.length])
        gsap.delayedCall(Math.max(3, s.d - TR), next)
      })
    })
  }

  next()
})()
