/** Праздничные декорации — нарисованные SVG, поверх стекла, не мешают кликам. */
import type { JSX } from 'react'
import type { Decor } from '@/content/holidays'

const BULBS = ['#FF5C5C', '#FFD15C', '#5CE1FF', '#9B7BFF', '#7CFFB2']

function Garland() {
  const n = 28
  return (
    <svg className="hd-garland" viewBox="0 0 1400 70" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 8 Q 175 60 350 8 T 700 8 T 1050 8 T 1400 8" fill="none" stroke="rgba(30,40,30,.85)" strokeWidth="2.5" />
      {Array.from({ length: n }, (_, i) => {
        const x = (1400 / n) * (i + 0.5)
        const seg = (x % 350) / 350
        const y = 8 + Math.sin(seg * Math.PI) * 26 + 6
        return <circle key={i} cx={x} cy={y} r="6" fill={BULBS[i % BULBS.length]} className="hd-bulb" style={{ animationDelay: `${(i % 5) * 0.35}s` }} />
      })}
    </svg>
  )
}

function Snowman() {
  return (
    <svg className="hd-snowman" viewBox="0 0 120 170" aria-hidden="true">
      <ellipse cx="60" cy="165" rx="46" ry="6" fill="rgba(0,0,0,.25)" />
      <circle cx="60" cy="128" r="36" fill="#F4F8FF" />
      <circle cx="60" cy="78" r="26" fill="#F8FBFF" />
      <circle cx="60" cy="40" r="19" fill="#FFFFFF" />
      <rect x="44" y="10" width="32" height="18" rx="3" fill="#1D1830" />
      <rect x="38" y="25" width="44" height="5" rx="2" fill="#1D1830" />
      <path d="M41 56 Q60 66 79 56 L79 63 Q60 73 41 63 Z" fill="#7C4DFF" />
      <rect x="66" y="58" width="9" height="22" rx="3" fill="#7C4DFF" />
      <circle cx="53" cy="37" r="2.6" fill="#1D1830" /><circle cx="67" cy="37" r="2.6" fill="#1D1830" />
      <path d="M60 42 L80 46 L60 47 Z" fill="#FF8A3D" />
      <circle cx="60" cy="74" r="2.6" fill="#1D1830" /><circle cx="60" cy="86" r="2.6" fill="#1D1830" /><circle cx="60" cy="118" r="2.8" fill="#1D1830" />
      <path d="M36 80 L10 64 M84 80 L110 62" stroke="#6B4A2F" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}

function Pumpkins() {
  const pumpkin = (x: number, s: number, key: string) => (
    <g key={key} transform={`translate(${x} ${110 - 50 * s}) scale(${s})`}>
      <ellipse cx="50" cy="52" rx="48" ry="40" fill="#E8742B" />
      <ellipse cx="32" cy="52" rx="20" ry="38" fill="#F08A3A" />
      <ellipse cx="68" cy="52" rx="20" ry="38" fill="#F08A3A" />
      <ellipse cx="50" cy="52" rx="14" ry="40" fill="#E8742B" />
      <path d="M46 14 Q48 0 58 2 L56 6 Q52 6 51 15 Z" fill="#4A6B2A" />
      <g className="hd-glow">
        <path d="M28 42 L38 34 L40 46 Z M72 42 L62 34 L60 46 Z" fill="#FFE07A" />
        <path d="M28 62 Q50 80 72 62 L66 66 L60 62 L54 68 L48 62 L42 68 L36 62 Z" fill="#FFE07A" />
      </g>
    </g>
  )
  return <svg className="hd-pumpkins" viewBox="0 0 230 120" aria-hidden="true">{pumpkin(0, 1, 'a')}{pumpkin(120, 0.72, 'b')}</svg>
}

function Web() {
  return (
    <svg className="hd-web" viewBox="0 0 200 200" aria-hidden="true">
      <g stroke="rgba(255,255,255,.35)" strokeWidth="1.2" fill="none">
        {[0, 18, 36, 54, 72, 90].map((a) => <line key={a} x1="0" y1="0" x2={200 * Math.cos((a * Math.PI) / 180)} y2={200 * Math.sin((a * Math.PI) / 180)} />)}
        {[40, 80, 120, 160].map((r) => <path key={r} d={`M ${r} 0 Q ${r * 0.85} ${r * 0.35} ${r * 0.95} ${r * 0.31} Q ${r * 0.72} ${r * 0.6} ${r * 0.81} ${r * 0.59} Q ${r * 0.52} ${r * 0.75} ${r * 0.59} ${r * 0.81} Q ${r * 0.28} ${r * 0.88} ${r * 0.31} ${r * 0.95} Q ${r * 0.1} ${r} 0 ${r}`} />)}
      </g>
      <g className="hd-spider"><line x1="120" y1="0" x2="120" y2="96" stroke="rgba(255,255,255,.4)" /><circle cx="120" cy="104" r="8" fill="#14101F" /><path d="M112 100 l-9 -6 M112 106 l-10 2 M128 100 l9 -6 M128 106 l10 2" stroke="#14101F" strokeWidth="2" /></g>
    </svg>
  )
}

function Balloons() {
  const colors = ['#9B7BFF', '#F4C95D', '#FF6FA3', '#5FD3FF']
  return (
    <div className="hd-balloons" aria-hidden="true">
      {colors.map((c, i) => (
        <svg key={c} className="hd-balloon" viewBox="0 0 60 150" style={{ animationDelay: `${i * -3.2}s`, left: `${i * 22}%` }}>
          <ellipse cx="30" cy="34" rx="24" ry="30" fill={c} />
          <ellipse cx="22" cy="24" rx="6" ry="10" fill="rgba(255,255,255,.45)" />
          <path d="M27 63 L33 63 L30 68 Z" fill={c} />
          <path d="M30 68 Q38 90 26 110 Q20 125 30 148" stroke="rgba(255,255,255,.6)" fill="none" strokeWidth="1.3" />
        </svg>
      ))}
    </div>
  )
}

function Sun() {
  return (
    <svg className="hd-sun" viewBox="0 0 200 200" aria-hidden="true">
      <g className="hd-sun-rays">{Array.from({ length: 16 }, (_, i) => <rect key={i} x="97" y="6" width="6" height="34" rx="3" fill="rgba(255,200,90,.55)" transform={`rotate(${i * 22.5} 100 100)`} />)}</g>
      <circle cx="100" cy="100" r="46" fill="rgba(255,196,80,.75)" />
      <circle cx="100" cy="100" r="34" fill="rgba(255,226,140,.85)" />
    </svg>
  )
}

function Mimosa() {
  return (
    <svg className="hd-mimosa" viewBox="0 0 180 160" aria-hidden="true">
      <path d="M10 150 Q70 110 110 40 M60 118 Q100 110 140 70 M40 132 Q60 90 50 50" stroke="#6E8F3A" strokeWidth="3" fill="none" strokeLinecap="round" />
      {[[110, 40], [118, 52], [100, 34], [140, 70], [130, 76], [148, 62], [50, 50], [44, 62], [58, 44], [90, 80], [124, 92], [70, 96]].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="7" fill="#F7E35B" stroke="#E9C83A" strokeWidth="1.5" />
      ))}
    </svg>
  )
}

const MAP: Record<Decor, () => JSX.Element> = { garland: Garland, snowman: Snowman, pumpkins: Pumpkins, web: Web, balloons: Balloons, sun: Sun, mimosa: Mimosa }

export function Decorations({ decor }: { decor: Decor[] }) {
  return <>{decor.map((d) => { const C = MAP[d]; return <C key={d} /> })}</>
}
