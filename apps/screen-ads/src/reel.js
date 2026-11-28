/**
 * Ролик — одна непрерывная композиция: сцены идут подряд по кругу, камера не
 * останавливается. Следующая сцена выезжает из той же плоскости (сбоку, сверху или из
 * глубины), её край растворяется в предыдущей сцене — на время перехода это один кадр.
 * Логотип клуба один на весь ролик и не двигается. В документе не больше двух сцен.
 * Движение — только transform, opacity и неподвижные маски краёв.
 * window.REEL = [{ id, tpl, cls, d, html }] — из build.js.
 */
(function () {
  var LIST = window.REEL || []
  if (!LIST.length) return
  var reel = document.querySelector('.reel')
  var scale = TitanFit(reel)
  addEventListener('resize', function () { scale = TitanFit(reel) })
  var TR = 1.6
  var index = 0, cur = null, sent = false, pre = {}

  var brand = document.createElement('div')
  brand.className = 'reel-brand'
  brand.innerHTML = '<img src="media/logo.png" alt=""><div>TITAN<small>клуб спортивной мафии</small></div>'
  reel.appendChild(brand)

  function preload(s) {
    if (!pre[s.id]) { var box = document.createElement('div'); box.innerHTML = s.html; pre[s.id] = TitanLoad(box) }
    return pre[s.id]
  }
  function mount(s) {
    var el = document.createElement('div')
    el.className = s.cls
    el.setAttribute('data-tpl', s.tpl)
    el.innerHTML = s.html
    reel.insertBefore(el, brand)
    return el
  }
  function drop(el) { if (el && el.parentNode) el.parentNode.removeChild(el) }
  function mask(el, value) { el.style.webkitMaskImage = value; el.style.maskImage = value }

  /** Камера едет дальше: dx, dy — откуда выезжает новая сцена; края сцен растворены. */
  function pan(dx, dy) {
    return function (a, b) {
      var dir = dx > 0 ? '90deg' : dx < 0 ? '270deg' : dy > 0 ? '180deg' : '0deg'
      mask(b, 'linear-gradient(' + dir + ', transparent 0%, #000 28%)')
      mask(a, 'linear-gradient(' + dir + ', #000 72%, transparent 100%)')
      return gsap.timeline({ onComplete: function () { mask(b, '') } })
        .to(a, { x: -dx, y: -dy, scale: 1.04, duration: TR, ease: 'power2.inOut' }, 0)
        .fromTo(b, { x: dx, y: dy, scale: 1.06 }, { x: 0, y: 0, scale: 1, duration: TR, ease: 'power2.inOut' }, 0)
    }
  }
  /** Камера уходит в глубину: прежняя сцена наезжает и тает, новая проступает из-под неё. */
  function depth(a, b) {
    return gsap.timeline()
      .to(a, { scale: 1.3, opacity: 0, duration: TR, ease: 'power2.in' }, 0)
      .fromTo(b, { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: TR, ease: 'power2.out' }, 0)
  }

  var TRANSITIONS = [pan(1920, 0), depth, pan(0, 1080), pan(-1920, 0), depth, pan(0, -1080)]

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
