'use client'
/**
 * Центр уведомлений приложения.
 *
 * Единая точка сбора всех уведомлений для staff/owner:
 *  • при монтировании грузит GET /notifications и открывает SSE-поток
 *    /notifications/stream (логика перенесена из старого StaffNotifications);
 *  • хранит список, считает unreadCount и hasImportantUnread (непрочитанные
 *    вызовы из кабинки / запросы счёта);
 *  • при новом SSE-событии добавляет уведомление в начало списка (непрочитанным),
 *    проигрывает звук и показывает временный нижний toast (богатая карточка);
 *  • markRead(id) / markAllRead() — вызывают PUT-эндпоинты и обновляют локальный
 *    стейт.
 *
 * Нижние временные toast-карточки рендерятся прямо здесь (авто-скрытие ~6с),
 * над плавающей навигацией.
 */
import {
  createContext, useContext, useState, useEffect, useRef, useCallback, useMemo,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/store/auth.store'
import { api } from '@/lib/api'
import { openSse } from '@/lib/sse'
import { Icon } from '@/components/Icon'

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string
  meta?: Record<string, unknown>
  isRead: boolean
  createdAt: string
}

interface TransientToast extends AppNotification {
  shownAt: number
}

interface NotificationsContextValue {
  notifications: AppNotification[]
  unreadCount: number
  hasImportantUnread: boolean
  markRead: (id: string) => void
  markAllRead: () => void
  markReadByCheck: (opts: { checkId?: string; spaceId?: string; types: string[] }) => void
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

// Важные типы — те, что вызывают тряску «колокольчика» до прочтения.
const IMPORTANT_TYPES = new Set(['staff_call', 'request_bill', 'client_order', 'chat_message'])

export const NOTIF_ICONS: Record<string, string> = {
  staff_call: 'support_agent',
  request_bill: 'receipt_long',
  client_order: 'room_service',
  chat_message: 'chat',
  check_paid: 'payments',
  large_check: 'payments',
  check_opened: 'receipt_long',
  rental_started: 'schedule',
  low_stock: 'warning',
  refund: 'undo',
  large_refund: 'undo',
  supply_received: 'local_shipping',
  shift_open: 'schedule',
  shift_close: 'schedule',
  cash_discrepancy: 'account_balance_wallet',
  birthday: 'card_giftcard',
  event_created: 'event',
  event_completed: 'event',
  new_client: 'group',
  debt_created: 'account_balance_wallet',
  deposit_topup: 'account_balance_wallet',
  certificate_used: 'card_giftcard',
  guest_feedback: 'star',
}
export const NOTIF_COLORS: Record<string, string> = {
  staff_call: '#F59E0B',
  request_bill: '#10B981',
  client_order: '#8B5CF6',
  chat_message: '#4cd7f6',
  check_paid: '#10B981',
  large_check: '#34D399',
  check_opened: '#8B5CF6',
  rental_started: '#8B5CF6',
  low_stock: '#F43F5E',
  refund: '#F59E0B',
  large_refund: '#F87171',
  supply_received: '#34D399',
  shift_open: '#4cd7f6',
  shift_close: '#4cd7f6',
  cash_discrepancy: '#F59E0B',
  birthday: '#EC4899',
  event_created: '#A78BFA',
  event_completed: '#A78BFA',
  new_client: '#60A5FA',
  debt_created: '#F43F5E',
  deposit_topup: '#10B981',
  certificate_used: '#14B8A6',
  guest_feedback: '#FBBF24',
}
export function notifIcon(type: string) { return NOTIF_ICONS[type] ?? 'notifications' }
export function notifColor(type: string) { return NOTIF_COLORS[type] ?? '#A78BFA' }

// Зеркало серверного resolveNotifUrl (push.ts): целевой экран для перехода по
// уведомлению. Новые уведомления уже несут meta.url; этот фоллбэк покрывает старые.
export function notifUrl(n: { type: string; meta?: Record<string, unknown> }): string {
  const meta = (n.meta ?? {}) as Record<string, unknown>
  if (typeof meta['url'] === 'string' && meta['url']) return meta['url'] as string
  const checkId = typeof meta['checkId'] === 'string' ? (meta['checkId'] as string) : null
  switch (n.type) {
    case 'low_stock': return typeof meta['itemId'] === 'string' ? `/manage/goods/item/${meta['itemId']}` : '/manage/goods?tab=warehouse'
    case 'supply_received': return typeof meta['supplyId'] === 'string' ? `/manage/goods/doc?type=supply&id=${meta['supplyId']}` : '/manage/goods?tab=warehouse'
    case 'shift_open': case 'shift_close': case 'cash_discrepancy': return '/manage/shifts'
    case 'event_created': case 'event_completed': return '/events'
    case 'new_client': case 'birthday': return '/manage/clients'
    case 'staff_call': return checkId ? `/pos/${checkId}` : '/pos'
    case 'guest_feedback': return '/dashboard?tab=feedback'
  }
  if (checkId) return `/pos/${checkId}`
  if (typeof meta['itemId'] === 'string') return `/manage/goods/item/${meta['itemId']}`
  if (typeof meta['supplyId'] === 'string') return `/manage/goods/doc?type=supply&id=${meta['supplyId']}`
  if (typeof meta['eventId'] === 'string') return '/events'
  if (typeof meta['playerId'] === 'string') return '/manage/clients'
  if (typeof meta['spaceId'] === 'string') return '/pos'
  return '/'
}

function playChime() {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch {}
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuthStore()
  const pathname = usePathname()
  const router = useRouter()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [toasts, setToasts] = useState<TransientToast[]>([])
  // id уже виденных уведомлений — защита от дублей (load + SSE re-emit одного и того же).
  const seenRef = useRef<Set<string>>(new Set())

  // Планшет-киоск работает под staff-токеном, но это УСТРОЙСТВО ГОСТЯ — на нём
  // не показываем уведомления персонала (это сам гость их и инициирует).
  const isTablet = pathname?.startsWith('/tablet') ?? false
  const isStaff = !!token && !!user && ['owner', 'staff'].includes(user.role) && !isTablet

  // ── Загрузка истории + открытие SSE-потока с авто-реконнектом ────────────
  // SSE-тикет одноразовый (TTL 60с): встроенный авто-реконнект EventSource по
  // тому же URL бесполезен — ?ticket= уже сгорел, поток молча мёртв. После блипа
  // сети или блокировки экрана iPhone заказы переставали приходить. Поэтому при
  // каждом обрыве сами запрашиваем СВЕЖИЙ тикет (openSse делает POST /auth/sse-ticket)
  // и открываем поток заново — с экспоненциальным бэкоффом + джиттер (1с→2с→…→cap 30с).
  useEffect(() => {
    if (!isStaff) {
      setNotifications([])
      setToasts([])
      seenRef.current = new Set()
      return
    }

    let cancelled = false
    let es: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0            // счётчик подряд идущих неудач — основа бэкоффа
    let connecting = false     // не плодим параллельные подключения

    const clearTimer = () => {
      if (reconnectTimer) { clearTimeout(reconnectTimer) ; reconnectTimer = null }
    }
    const closeStream = () => {
      if (es) { es.onmessage = null; es.onerror = null; es.onopen = null; es.close(); es = null }
    }

    // Планируем реконнект с бэкоффом: 1с,2с,4с,…,cap 30с + до ±30% джиттера
    // (разводим одновременные переподключения нескольких вкладок).
    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return
      const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))
      const jitter = base * (0.7 + Math.random() * 0.3)
      reconnectTimer = setTimeout(() => { reconnectTimer = null; connect() }, jitter)
    }

    const connect = () => {
      if (cancelled || connecting) return
      connecting = true
      closeStream()           // на всякий случай: один активный EventSource
      // openSse сам берёт новый одноразовый тикет → старый сгоревший не мешает.
      openSse('/notifications/stream').then((stream) => {
        connecting = false
        if (cancelled) { stream.close(); return }
        es = stream
        stream.onopen = () => { attempt = 0 }   // успешное соединение сбрасывает бэкофф
        stream.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data) as AppNotification
            const incoming: AppNotification = { ...data, isRead: false }
            // Upsert по id: при группировке «по объекту» сервер обновляет ту же запись
            // (тот же id, новый count) — заменяем её на месте и поднимаем наверх,
            // а не плодим дубль.
            setNotifications((prev) => [incoming, ...prev.filter((n) => n.id !== incoming.id)])
            setToasts((prev) => [...prev.filter((t) => t.id !== incoming.id), { ...incoming, shownAt: Date.now() }])
            playChime()
          } catch {}
        }
        stream.onerror = () => {
          // Обрыв потока (сеть/сгоревший тикет): закрываем и переоткрываем сами
          // со свежим тикетом — встроенный реконнект EventSource нам не подходит.
          if (cancelled) return
          closeStream()
          attempt += 1
          scheduleReconnect()
        }
      }).catch(() => {
        // Нет тикета/сети — повторим позже с бэкоффом.
        connecting = false
        if (cancelled) return
        attempt += 1
        scheduleReconnect()
      })
    }

    // Возврат видимости (разблокировка экрана iPhone рвёт поток молча) или
    // восстановление сети → форсируем немедленный реконнект, сбросив бэкофф.
    const onVisible = () => {
      if (cancelled || document.visibilityState !== 'visible') return
      clearTimer()
      attempt = 0
      connect()
    }
    const onOnline = () => { if (!cancelled) onVisible() }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    // 1) История
    api.get<{ notifications: AppNotification[] }>('/notifications')
      .then((res) => {
        if (cancelled) return
        const list = res.notifications ?? []
        list.forEach((n) => seenRef.current.add(n.id))
        setNotifications(list)
      })
      .catch(() => { /* нет сети — список останется пустым */ })

    // 2) Живой поток
    connect()

    return () => {
      cancelled = true
      clearTimer()
      closeStream()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [isStaff])

  // Авто-скрытие нижних toast через ~6с
  useEffect(() => {
    if (toasts.length === 0) return
    const t = setInterval(() => {
      setToasts((prev) => prev.filter((tt) => Date.now() - tt.shownAt < 6000))
    }, 500)
    return () => clearInterval(t)
  }, [toasts.length])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((tt) => tt.id !== id))
  }, [])

  // Тап по нижней карточке — переход на нужный экран (как и из PWA-пуша), плюс
  // пометка прочитанным.
  const openToast = useCallback((t: AppNotification) => {
    setToasts((prev) => prev.filter((tt) => tt.id !== t.id))
    setNotifications((prev) => prev.map((n) => (n.id === t.id ? { ...n, isRead: true } : n)))
    api.put(`/notifications/${t.id}/read`).catch(() => {})
    const url = notifUrl(t)
    if (url && url !== '/') router.push(url)
  }, [router])

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const target = prev.find((n) => n.id === id)
      if (!target || target.isRead) return prev
      return prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    })
    api.put(`/notifications/${id}/read`).catch(() => { /* best-effort */ })
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.some((n) => !n.isRead)
      ? prev.map((n) => ({ ...n, isRead: true }))
      : prev)
    api.put('/notifications/read-all').catch(() => { /* best-effort */ })
  }, [])

  // Помечаем прочитанными уведомления, относящиеся к чеку (meta.checkId) или
  // пространству (meta.spaceId — для вызова персонала без checkId), заданных типов.
  // Используется при открытии чека/чата, чтобы погасить «пульс» карточки.
  const markReadByCheck = useCallback((opts: { checkId?: string; spaceId?: string; types: string[] }) => {
    let changed = false
    setNotifications((prev) => prev.map((n) => {
      if (n.isRead || !opts.types.includes(n.type)) return n
      const m = (n.meta ?? {}) as Record<string, unknown>
      const match = (opts.checkId && m['checkId'] === opts.checkId) || (opts.spaceId && m['spaceId'] === opts.spaceId)
      if (!match) return n
      changed = true
      return { ...n, isRead: true }
    }))
    if (changed) api.put('/notifications/read-by-check', opts).catch(() => { /* best-effort */ })
  }, [])

  const unreadCount = useMemo(
    () => notifications.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0),
    [notifications],
  )
  const hasImportantUnread = useMemo(
    () => notifications.some((n) => !n.isRead && IMPORTANT_TYPES.has(n.type)),
    [notifications],
  )

  const value = useMemo<NotificationsContextValue>(
    () => ({ notifications, unreadCount, hasImportantUnread, markRead, markAllRead, markReadByCheck }),
    [notifications, unreadCount, hasImportantUnread, markRead, markAllRead, markReadByCheck],
  )

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <TransientToasts toasts={toasts} onDismiss={dismissToast} onOpen={openToast} />
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider')
  return ctx
}

// ── Нижние временные карточки (над навигацией) ────────────────────────────
function TransientToasts({ toasts, onDismiss, onOpen }: { toasts: TransientToast[]; onDismiss: (id: string) => void; onOpen: (n: AppNotification) => void }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(var(--bottom-nav-clear, 96px) + 10px)',
      left: '50%', transform: 'translateX(-50%)',
      zIndex: 9998, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none',
      width: 'min(calc(100vw - 32px), 360px)',
    }}>
      <AnimatePresence>
        {toasts.slice(-3).map((t) => {
          const icon = notifIcon(t.type)
          const color = notifColor(t.type)
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.95 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              onClick={() => onOpen(t)}
              style={{
                padding: '14px 16px', borderRadius: 16,
                background: 'rgba(29,26,36,0.96)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
                border: `1px solid ${color}55`,
                boxShadow: `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px ${color}22`,
                display: 'flex', gap: 12, alignItems: 'flex-start',
                pointerEvents: 'auto', cursor: 'pointer',
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: `${color}22`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon name={icon} size={20} color={color} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 2px', color: 'var(--on-surface)' }}>{t.title}</p>
                <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>{t.body}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onDismiss(t.id) }}
                aria-label="Закрыть"
                style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: -2, marginRight: -4 }}
              >
                <Icon name="close" size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
