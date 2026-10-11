'use client'
/**
 * Меню «Управления»: своя шапка (пользователь, выход) + сетка разделов.
 * Используется в двух местах:
 *  • мобильный — страница /manage целиком;
 *  • десктоп (≥1024) — левая панель сплита (app/manage/layout.tsx),
 *    активный раздел подсвечивается по pathname.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth.store'
import { permissionOn } from '@/lib/permissions'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'

interface NavItem {
  href: string
  label: string
  /** Альтернативная подпись для роли 'staff' (напр. «Мой профиль» вместо «Пользователи»). */
  labelStaff?: string
  icon: string
  color: string
  bg: string
  roles: string[]
  /**
   * Ключ права доступа (см. lib/permissions.ts). Если у сотрудника (role 'staff')
   * право выключено — явно или по умолчанию — раздел скрыт.
   * Владельца права не ограничивают. Пункты без perm гейтятся только ролью.
   */
  perm?: string | string[]
}

interface NavGroup {
  title: string
  icon: string
  items: NavItem[]
}

// Группировка по смыслу: товары/склад, всё о клиенте (вкл. его деньги — депозит/долг),
// инструменты продаж и лояльности, чистые финансы заведения, персонал и смены,
// конфигурация заведения, система. Так пункт ищется там, где его ждёшь.
const NAV: NavGroup[] = [
  {
    title: 'Меню и склад',
    icon: 'inventory_2',
    items: [
      { href: '/manage/goods',     label: 'Товары',    icon: 'restaurant_menu', color: '#F97316', bg: 'rgba(249,115,22,0.15)',  roles: ['owner','staff'], perm: ['menu', 'inventory'] },
      // Единый экран «Склад»: остатки, поставки и ревизия — вкладки внутри одного раздела.
      { href: '/manage/pricing',   label: 'Тарифы и аренда', icon: 'confirmation_number', color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', roles: ['owner','staff'] },
      // Телевизоры с Titan Menu: меню или слайдшоу, у каждого свои настройки.
      { href: '/manage/screens',   label: 'Экраны',    icon: 'tv',              color: '#A78BFA', bg: 'rgba(167,139,250,0.15)', roles: ['owner','staff'] },
    ],
  },
  {
    title: 'Клиенты',
    icon: 'group',
    items: [
      { href: '/manage/clients',   label: 'Клиенты',   icon: 'person',     color: '#4cd7f6', bg: 'rgba(76,215,246,0.15)', roles: ['owner','staff'], perm: 'clients' },
      { href: '/manage/customers', label: 'Заказчики', icon: 'person_add', color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', roles: ['owner','staff'] },
      // Единый экран «Депозиты и долги»: депозит и долг — один баланс, вкладки внутри.
      { href: '/manage/balances',  label: 'Депозиты и долги', icon: 'account_balance', color: '#06B6D4', bg: 'rgba(6,182,212,0.15)', roles: ['owner','staff'], perm: 'debtors' },
      // Единый экран «Лояльность»: Скидки · Бонусы · Сертификаты — вкладки внутри.
      { href: '/manage/loyalty',   label: 'Лояльность', icon: 'loyalty', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', roles: ['owner','staff'], perm: ['discounts', 'bonus'] },
      // Сбор средств (Фонд клуба и разовые сборы) — взносы резидентов, мимо кассы.
      { href: '/manage/collections', label: 'Сбор средств', icon: 'savings', color: '#22C55E', bg: 'rgba(34,197,94,0.15)', roles: ['owner','staff'], perm: 'debtors' },
      // Рассылки клиентам: лента и push в приложении My Titan (+ бот My Titan).
      { href: '/manage/broadcasts', label: 'Рассылки', icon: 'campaign', color: '#EC4899', bg: 'rgba(236,72,153,0.15)', roles: ['owner'] },
      // Брони живут в «Мероприятиях» (заявки + Старые брони) — отдельного раздела нет.
    ],
  },
  {
    title: 'Персонал и смены',
    icon: 'badge',
    items: [
      // Владелец: «Пользователи» (управление + свой профиль). Сотрудник: «Мой профиль» (только своё).
      { href: '/manage/staff', label: 'Пользователи', labelStaff: 'Мой профиль', icon: 'group', color: '#A78BFA', bg: 'rgba(167,139,250,0.15)', roles: ['owner','staff'] },
      // Смена и касса в одном экране (инкассация встроена).
      { href: '/manage/shifts', label: 'Смены',     icon: 'schedule', color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)',  roles: ['owner','staff'] },
      { href: '/manage/salary', label: 'Зарплата',  icon: 'payments', color: '#10B981', bg: 'rgba(16,185,129,0.15)', roles: ['owner'], perm: 'salary' },
      { href: '/manage/expenses', label: 'Расходы', icon: 'receipt_long', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', roles: ['owner','staff'], perm: 'expenses' },
    ],
  },
  {
    title: 'Система',
    icon: 'settings',
    items: [
      { href: '/manage/settings', label: 'Настройки',   icon: 'settings',    color: '#94A3B8', bg: 'rgba(148,163,184,0.15)', roles: ['owner'] },
      { href: '/manage/tai',      label: 'Tai',         icon: 'auto_awesome', color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', roles: ['owner'] },
      { href: '/manage/polls',    label: 'Опросы',      icon: 'fact_check',  color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', roles: ['owner'] },
      { href: '/manage/about',    label: 'О системе',   icon: 'info',        color: '#94A3B8', bg: 'rgba(148,163,184,0.15)', roles: ['owner'] },
    ],
  },
]

function NavCard({ href, label, icon, color, bg, active }: { href: string; label: string; icon: string; color: string; bg: string; active: boolean }) {
  const restBorder = active ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.08)'
  return (
    <Link href={href} style={{ textDecoration: 'none' }}>
      <div
        className="glass-l2"
        style={{
          position: 'relative', overflow: 'hidden',
          borderRadius: 16, padding: '16px 14px',
          display: 'flex', alignItems: 'center', gap: 12,
          cursor: 'pointer', minHeight: 64,
          transition: 'transform 0.15s, border-color 0.2s, box-shadow 0.2s',
          border: `1px solid ${restBorder}`,
          background: active ? 'rgba(139,92,246,0.08)' : undefined,
        }}
        onTouchStart={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(0.96)' }}
        onTouchEnd={e => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)' }}
        onMouseEnter={e => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderColor = `${color}55`
          el.style.transform = 'translateY(-2px)'
          el.style.boxShadow = `0 8px 24px ${color}22`
        }}
        onMouseLeave={e => {
          const el = e.currentTarget as HTMLDivElement
          el.style.borderColor = restBorder
          el.style.transform = 'translateY(0)'
          el.style.boxShadow = 'none'
        }}
      >
        <div style={{ width: 42, height: 42, borderRadius: 12, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={icon} size={20} color={color} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', lineHeight: 1.25 }}>{label}</span>
      </div>
    </Link>
  )
}

export function ManageMenu() {
  const pathname = usePathname()
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const role = user?.role ?? 'staff'

  const roleLabel = role === 'owner' ? 'Владелец' : 'Персонал'
  const roleColor = role === 'owner' ? '#F59E0B' : '#8B5CF6'

  // Права доступа сотрудника хранятся в профиле (profiles.permissions), но в
  // auth-сторе их нет (там только id/nickname/role/photoUrl). Поэтому тянем их
  // из /auth/me. Владельцу права не ограничивают — гейтим только роль 'staff'.
  const { data: me } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ permissions?: Record<string, boolean> }>('/auth/me'),
    enabled: role === 'staff',
    staleTime: 60_000,
  })
  const permissions = me?.permissions ?? {}

  // Раздел разрешён, если: роль подходит И (нет perm-ключа ИЛИ это владелец
  // ИЛИ право включено — явно или по умолчанию, как на карточке сотрудника).
  function isAllowed(item: NavItem): boolean {
    if (!item.roles.includes(role)) return false
    if (role === 'owner') return true
    if (item.perm && [item.perm].flat().every(p => !permissionOn(permissions, p))) return false
    return true
  }

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', overflowX: 'hidden', width: '100%' }}>
      {/* Header меню (своя шапка: пользователь + выход) */}
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: 'rgba(21,18,27,0.95)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Управление</h1>
            <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '3px 0 0' }}>
              Titan HUB
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* User chip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 12, background: `${roleColor}15`, border: `1px solid ${roleColor}33` }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: `${roleColor}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: roleColor }}>
                {user?.nickname?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, margin: 0, color: 'var(--on-surface)' }}>{user?.nickname}</p>
                <p style={{ fontSize: 10, margin: 0, color: roleColor, fontFamily: "'JetBrains Mono',monospace" }}>{roleLabel}</p>
              </div>
            </div>
            <button onClick={logout} aria-label="Выйти" style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-variant)' }}>
              <Icon name="logout" size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Sections. Нижний отступ — под плавающую навигацию: глобальное правило
          padding-bottom не доходит сюда (обёртки .manage-split* = display:contents
          на мобильном глушат его), поэтому задаём явно. На десктопе var=0 → norm. */}
      <div style={{ padding: '16px 16px calc(16px + var(--bottom-nav-clear, 0px))', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {NAV.map(group => {
          const visibleItems = group.items.filter(isAllowed)
          if (visibleItems.length === 0) return null
          return (
            <div key={group.title}>
              {/* Section header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '0 4px' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={group.icon} size={13} color="var(--on-surface-variant)" />
                  <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)' }}>{group.title}</span>
                </div>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
              </div>
              {/* Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                {visibleItems.map(item => (
                  <NavCard key={item.href} {...item} label={role !== 'owner' && item.labelStaff ? item.labelStaff : item.label} active={pathname === item.href || pathname.startsWith(item.href + '/')} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
