/**
 * Частицы праздника на canvas: один цикл requestAnimationFrame, без DOM-узлов на
 * частицу. Каждый вид — своя форма и физика (снег кружится, листья вращаются,
 * мыши летят поперёк, искры поднимаются).
 */
import type { ParticleKind } from '@/content/holidays'

interface P { x: number; y: number; vx: number; vy: number; s: number; r: number; vr: number; ph: number; c: string; a: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a)

function spawn(kind: ParticleKind, w: number, h: number, colors: string[], anywhere: boolean): P {
  const c = colors[Math.floor(Math.random() * colors.length)] ?? '#fff'
  const base: P = { x: rand(0, w), y: anywhere ? rand(0, h) : rand(-60, -10), vx: 0, vy: 0, s: 4, r: rand(0, Math.PI * 2), vr: rand(-0.02, 0.02), ph: rand(0, Math.PI * 2), c, a: rand(0.55, 1) }
  switch (kind) {
    case 'snow': return { ...base, s: rand(1.5, 4.2), vy: rand(0.35, 1.2), vx: rand(-0.2, 0.2), a: rand(0.5, 0.95) }
    case 'hearts': return { ...base, s: rand(7, 14), vy: rand(-0.6, -0.25), y: anywhere ? rand(0, h) : h + rand(10, 60), a: rand(0.5, 0.85) }
    case 'leaves': return { ...base, s: rand(8, 15), vy: rand(0.5, 1.2), vx: rand(-0.3, 0.6), vr: rand(-0.04, 0.04) }
    case 'petals': return { ...base, s: rand(5, 9), vy: rand(0.4, 0.9), vx: rand(0.1, 0.6), vr: rand(-0.05, 0.05) }
    case 'confetti': return { ...base, s: rand(5, 9), vy: rand(0.8, 1.8), vx: rand(-0.4, 0.4), vr: rand(-0.12, 0.12) }
    case 'bats': return { ...base, s: rand(14, 24), x: anywhere ? rand(0, w) : -40, y: rand(h * 0.05, h * 0.55), vx: rand(0.7, 1.6), vy: 0, a: rand(0.55, 0.9) }
    case 'stars': return { ...base, s: rand(4, 8), vy: rand(0.25, 0.6), vx: rand(-0.1, 0.1), vr: rand(-0.01, 0.01) }
    case 'sparks': return { ...base, s: rand(1.5, 3.5), vy: rand(-1.1, -0.4), vx: rand(-0.3, 0.3), y: anywhere ? rand(0, h) : h + rand(5, 40) }
    case 'bokeh': return { ...base, s: rand(14, 40), vy: rand(-0.25, -0.05), vx: rand(-0.15, 0.15), a: rand(0.08, 0.22), y: anywhere ? rand(0, h) : h + 50 }
  }
}

function heart(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath()
  ctx.moveTo(0, s * 0.35)
  ctx.bezierCurveTo(-s, -s * 0.4, -s * 0.45, -s * 1.1, 0, -s * 0.45)
  ctx.bezierCurveTo(s * 0.45, -s * 1.1, s, -s * 0.4, 0, s * 0.35)
  ctx.fill()
}
function star(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? s * 0.45 : s
    const ang = (Math.PI / 5) * i - Math.PI / 2
    ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad)
  }
  ctx.closePath()
  ctx.fill()
}
function bat(ctx: CanvasRenderingContext2D, s: number, flap: number) {
  const wing = s * (0.55 + 0.35 * Math.sin(flap))
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.quadraticCurveTo(-s * 0.5, -wing, -s, -wing * 0.2)
  ctx.quadraticCurveTo(-s * 0.7, s * 0.05, -s * 0.45, s * 0.15)
  ctx.quadraticCurveTo(-s * 0.2, s * 0.05, 0, s * 0.25)
  ctx.quadraticCurveTo(s * 0.2, s * 0.05, s * 0.45, s * 0.15)
  ctx.quadraticCurveTo(s * 0.7, s * 0.05, s, -wing * 0.2)
  ctx.quadraticCurveTo(s * 0.5, -wing, 0, 0)
  ctx.fill()
}

function draw(ctx: CanvasRenderingContext2D, kind: ParticleKind, p: P, t: number) {
  ctx.save()
  ctx.globalAlpha = p.a
  ctx.fillStyle = p.c
  ctx.translate(p.x, p.y)
  switch (kind) {
    case 'snow':
    case 'sparks': {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.s * 2)
      g.addColorStop(0, p.c); g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(0, 0, p.s * 2, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'bokeh': ctx.beginPath(); ctx.arc(0, 0, p.s, 0, Math.PI * 2); ctx.fill(); break
    case 'hearts': ctx.rotate(Math.sin(t / 900 + p.ph) * 0.25); heart(ctx, p.s); break
    case 'stars': ctx.rotate(p.r); ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(t / 500 + p.ph)); star(ctx, p.s); break
    case 'leaves': ctx.rotate(p.r); ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.moveTo(-p.s, 0); ctx.lineTo(p.s, 0); ctx.stroke(); break
    case 'petals': ctx.rotate(p.r); ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2); ctx.fill(); break
    case 'confetti': ctx.rotate(p.r); ctx.scale(1, Math.cos(t / 300 + p.ph)); ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); break
    case 'bats': bat(ctx, p.s, t / 90 + p.ph); break
  }
  ctx.restore()
}

/** Запускает анимацию на canvas, возвращает функцию остановки. */
export function runParticles(canvas: HTMLCanvasElement, kind: ParticleKind, colors: string[], density: number): () => void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}
  const dpr = Math.min(1.5, window.devicePixelRatio || 1)
  let w = 0
  let h = 0
  let ps: P[] = []
  const resize = () => {
    w = window.innerWidth; h = window.innerHeight
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const max = kind === 'bats' ? 9 : kind === 'bokeh' ? 22 : 110
    const count = Math.round(Math.min(max, ((w * h) / 16000) * density))
    ps = Array.from({ length: count }, () => spawn(kind, w, h, colors, true))
  }
  resize()
  let raf = 0
  let running = true
  const tick = (t: number) => {
    ctx.clearRect(0, 0, w, h)
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!
      p.ph += 0.01
      p.x += p.vx + (kind === 'snow' || kind === 'petals' || kind === 'leaves' ? Math.sin(t / 1500 + p.ph) * 0.35 : 0)
      p.y += p.vy + (kind === 'bats' ? Math.sin(t / 400 + p.ph) * 0.6 : 0)
      p.r += p.vr
      const out = p.y > h + 60 || p.y < -80 || p.x > w + 60 || p.x < -80
      if (out) ps[i] = spawn(kind, w, h, colors, false)
      draw(ctx, kind, p, t)
    }
    if (running) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  const onVis = () => {
    running = !document.hidden
    cancelAnimationFrame(raf)
    if (running) raf = requestAnimationFrame(tick)
  }
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', onVis)
  return () => { running = false; cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis) }
}
