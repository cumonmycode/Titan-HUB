'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { useCurrentShift } from '@/hooks/useShift'
import { Icon } from '@/components/Icon'
import { TaiLogo } from '@/components/TaiLogo'
import { useClubContext } from '@/components/ClubGate'
import { NAV_PRIMARY, NAV_SHIFTS, isNavActive } from '@/lib/nav'
import { hidesAppChrome } from '@/lib/publicRoutes'

const NAV_ITEMS = NAV_PRIMARY
const BOTTOM_NAV = [NAV_SHIFTS]

function getInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('tpos-sidebar-collapsed') === 'true'
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: shift } = useCurrentShift()
  const { moduleEnabled } = useClubContext()
  const [collapsed, setCollapsed] = useState(getInitialCollapsed)
  // Скрываем пункты выключенных у клуба модулей (fail-open: на осн. домене и при
  // неизвестном статусе moduleEnabled=true). AI-кнопку — по модулю 'ai'.
  const navItems = NAV_ITEMS.filter((i) => !i.module || moduleEnabled(i.module))
  const aiEnabled = moduleEnabled('ai')

  function handleCloseShift() {
    router.push('/pos?close=1')
  }

  if (pathname === '/login') return null
  // Публичные страницы (запись, политика, поддержка, вики) — без меню кассы.
  if (hidesAppChrome(pathname)) return null
  if (pathname.startsWith('/tablet')) return null
  if (pathname.startsWith('/superadmin')) return null

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('tpos-sidebar-collapsed', String(next))
  }

  const w = collapsed ? 72 : 260

  return (
    <>
      {/* Sidebar — hidden on mobile, shown on desktop via CSS class lg:flex */}
      <aside
        className="sidebar-root"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: w,
          flexDirection: 'column',
          background: 'rgba(29, 26, 36, 0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '0 32px 32px 0',
          zIndex: 50,
          display: 'none',
          transition: 'width 0.25s ease',
          overflow: 'hidden',
        }}
      >
        {/* Brand + collapse button */}
        <div style={{ padding: collapsed ? '24px 0 16px' : '28px 24px 20px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', minWidth: 0 }}>
          {!collapsed && (
            <div style={{ minWidth: 0 }}>
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 900,
                  
                  letterSpacing: '-0.01em',
                  margin: 0,
                  background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  whiteSpace: 'nowrap',
                }}
              >
                TITAN HUB
              </h1>
              <p
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: shift ? 'var(--on-surface-variant)' : 'rgba(204,195,216,0.4)',
                  margin: '6px 0 0',
                  whiteSpace: 'nowrap',
                }}
              >
                {shift ? 'В СМЕНЕ' : 'НЕТ СМЕНЫ'}
              </p>
            </div>
          )}

          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Развернуть' : 'Свернуть'}
            style={{
              width: 32, height: 32, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(255,255,255,0.04)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--on-surface-variant)', flexShrink: 0,
              transition: 'all 0.2s',
            }}
          >
            <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} size={18} />
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: collapsed ? '0 12px 8px' : '0 16px 8px' }} />

        {/* Nav items */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '8px 10px' : '8px 12px' }}>
          {navItems.map(({ href, icon, label }) => {
            const active = isNavActive(href, pathname)
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: collapsed ? 0 : 12,
                  padding: collapsed ? '10px 0' : '10px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 12,
                  marginBottom: 2,
                  textDecoration: 'none',
                  background: active ? 'rgba(139,92,246,0.1)' : 'transparent',
                  borderRight: !collapsed && active ? '2px solid #8B5CF6' : '2px solid transparent',
                  color: active ? '#8B5CF6' : 'var(--on-surface-variant)',
                  transition: 'all 0.2s',
                }}
              >
                <Icon name={icon} size={20} />
                {!collapsed && (
                  <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Bottom section */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: collapsed ? '12px 10px 24px' : '12px 12px 24px' }}>
          {/* TITAN AI — отдельная фирменная кнопка ассистента (скрыта, если модуль выкл) */}
          {aiEnabled && (() => {
            const aiActive = isNavActive('/ai', pathname)
            return (
              <Link
                href="/ai"
                title={collapsed ? 'Tai' : undefined}
                aria-current={aiActive ? 'page' : undefined}
                style={{
                  display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 12,
                  padding: collapsed ? '8px 0' : '8px 10px', justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 12, marginBottom: 8, textDecoration: 'none',
                  background: aiActive ? 'rgba(139,92,246,0.12)' : 'transparent',
                  border: '1px solid rgba(139,92,246,0.25)',
                }}
              >
                <TaiLogo size={30} float={false} />
                {!collapsed && (
                  <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', background: 'linear-gradient(135deg, #a78bfa, #4cd7f6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Tai</span>
                )}
              </Link>
            )
          })()}
          {BOTTOM_NAV.map(({ href, icon, label }) => {
            const active = isNavActive(href, pathname)
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                aria-current={active ? 'page' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: collapsed ? 0 : 12,
                  padding: collapsed ? '10px 0' : '10px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 12,
                  marginBottom: 12,
                  textDecoration: 'none',
                  background: active ? 'rgba(139,92,246,0.1)' : 'transparent',
                  color: active ? '#8B5CF6' : 'var(--on-surface-variant)',
                  transition: 'all 0.2s',
                }}
              >
                <Icon name={icon} size={20} />
                {!collapsed && <span style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{label}</span>}
              </Link>
            )
          })}

          {collapsed ? (
            <button
              onClick={handleCloseShift}
              disabled={!shift}
              title="Завершить смену"
              style={{
                width: '100%', padding: '10px 0', borderRadius: 14, border: 'none',
                cursor: shift ? 'pointer' : 'not-allowed',
                background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 20px rgba(139,92,246,0.35)',
                opacity: shift ? 1 : 0.4,
              }}
            >
              <Icon name="stop_circle" size={18} color="#fff" />
            </button>
          ) : (
            <button
              onClick={handleCloseShift}
              disabled={!shift}
              style={{
                width: '100%',
                padding: '12px 0',
                borderRadius: 14,
                border: 'none',
                cursor: shift ? 'pointer' : 'not-allowed',
                background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
                color: '#fff',
                fontSize: 11,
                fontFamily: "'JetBrains Mono', monospace",
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                boxShadow: '0 4px 20px rgba(139,92,246,0.35)',
                opacity: shift ? 1 : 0.4,
                whiteSpace: 'nowrap',
              }}
            >
              ЗАВЕРШИТЬ СМЕНУ
            </button>
          )}
        </div>
      </aside>

      {/* Responsive: sidebar для iPad (768-1023) — всегда collapsed (72px), для desktop — нормальный */}
      <style>{`
        @media (min-width: 768px) and (max-width: 1023px) {
          .sidebar-root {
            display: flex !important;
            width: 72px !important;
            border-radius: 0 24px 24px 0 !important;
          }
          .sidebar-root .sidebar-label { display: none !important; }
          .layout-main { margin-left: 72px; transition: margin-left 0.25s ease; }
          .bottom-nav-root { display: none !important; }
        }
        @media (min-width: 1024px) {
          .sidebar-root { display: flex !important; }
          .layout-main { margin-left: ${w}px; transition: margin-left 0.25s ease; }
        }
      `}</style>
    </>
  )
}
