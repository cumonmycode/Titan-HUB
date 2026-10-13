'use client'
import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { Icon } from '@/components/Icon'
import { TaiLogo } from '@/components/TaiLogo'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { funnyGuestName } from '@/lib/funnyName'
import { useCurrentShift } from '@/hooks/useShift'
import { OpenShiftModal, CloseShiftModal } from '@/components/ShiftModals'
import { differenceInMinutes } from 'date-fns'
import { CheckDetailView } from '@/components/CheckDetailView'
import { PullToRefreshContainer } from '@/components/PullToRefreshContainer'
import { useToast } from '@/components/Toast'
import { NotificationBell } from '@/components/NotificationBell'
import { TaiButton } from '@/components/tai/TaiPanel'
import { useNotifications } from '@/components/NotificationsProvider'

interface CheckCard {
  id: string
  createdAt: string
  totalAmount: string
  itemCount: number
  items?: string[]
  status: string
  note?: string
  guestName?: string
  guestPhotoUrl?: string | null
  spaceName?: string
  hasRental?: boolean
  spaceStartAt?: string | null
  spaceEndAt?: string | null
  spaceHourlyRate?: string | null
  eventBaseAmount?: string | null
  spaceId?: string | null
}

// Предчек — виртуальная карточка отметившегося в опросе игрока (до открытия чека).
interface Precheck {
  playerId: string
  nickname: string
  photoUrl: string | null
  clientTier: string
  vote: string
  tariffItemId: string | null
  tariffName: string | null
  tariffPrice: string | null
}

interface PlayerResult {
  id: string
  nickname: string
  clientTier: string
  balance: string
  bonusPoints: string
  photoUrl: string | null
}

// Прогноз/сводка смены для карточки кассы.
interface ShiftForecastCheck { checkId: string; name: string; isResident: boolean; current: number; projected: number; avgSpend: number | null; samples: number; weekdayBased: boolean }
interface ShiftSummary {
  shift: { id: string; openedAt: string; eveningType: string } | null
  openChecks: { count: number; total: number }
  cashInRegister: number
  taiEnabled?: boolean
  forecast: { amount: number; currentTotal: number; additional: number; perCheck: ShiftForecastCheck[] } | null
}

// Игрок GoMafia в подборе (из /gomafia/search).
interface PosGmPlayer {
  gomafiaId: string
  login: string
  avatar: string | null
  elo: number | null
  clubTitle: string | null
  inClub: boolean
}

interface SpaceResult {
  id: string
  name: string
  type: string
  hourlyRate: string
  isActive: boolean
}

// Стандартизированный тариф из /tariffs. itemId — backing-позиция меню,
// которую добавляем в чек при выборе тарифа.
interface TariffOption {
  id: string
  name: string
  key?: string | null
  price: string | number
  color?: string | null
  isActive?: boolean
  itemId?: string | null
}

type NewCheckStep = 'search' | 'tariff' | 'new_client' | 'space'

// Нормальное время нахождения — 8 часов. До него таймер просто считается
// (нейтральный), последние 30 мин — мягкое жёлтое предупреждение, после 8ч — красный.
const NORMAL_STAY_MIN = 8 * 60

function getTimerColor(createdAt: string, now: number): string {
  const mins = differenceInMinutes(now, new Date(createdAt))
  if (mins >= NORMAL_STAY_MIN) return 'var(--danger)'
  if (mins >= NORMAL_STAY_MIN - 30) return 'var(--warning)'
  return 'var(--on-surface-variant)'
}

function formatElapsed(createdAt: string, now: number): string {
  const mins = differenceInMinutes(now, new Date(createdAt))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м`
}

// Аренда зоны: ceil(минуты/60) × ставка. До spaceEndAt (если задан) либо до now
// (живой счётчик). Тем же правилом считает бэкенд при оплате.
function computeRental(startAt: string | null | undefined, endAt: string | null | undefined, hourlyRate: string | null | undefined, now: number): number {
  if (!startAt || !hourlyRate) return 0
  const end = endAt ? new Date(endAt).getTime() : now
  // Целые минуты — как бэкенд (lib/money.ts): секунды не делают из 3 ч аренды 4 ч.
  const mins = Math.floor(Math.max(0, end - new Date(startAt).getTime()) / 60000)
  return Math.ceil(mins / 60) * (parseFloat(hourlyRate) || 0)
}

function getInitials(name?: string | null): string {
  if (!name) return 'Г'
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

// Красное мигание — только после 8ч (для обычных гостей и почасовой аренды).
function isWarning(createdAt: string, now: number): boolean {
  return differenceInMinutes(now, new Date(createdAt)) >= NORMAL_STAY_MIN
}


const TIER_LABELS: Record<string, string> = {
  guest: 'Гость',
  resident: 'Резидент',
  student: 'Студент',
}

// Маппинг clientTier → название тарифа в меню
const TIER_TO_TARIFF_NAME: Record<string, string> = {
  guest: 'Гость',
  resident: 'Резидент',
  student: 'Студент',
}

// Цветовая палитра тарифов (по индексу)
const TARIFF_PALETTE = [
  { color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', selBg: 'rgba(139,92,246,0.22)', selBorder: 'rgba(139,92,246,0.65)' },
  { color: '#10B981', bg: 'rgba(16,185,129,0.15)',  selBg: 'rgba(16,185,129,0.22)',  selBorder: 'rgba(16,185,129,0.65)'  },
  { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)',  selBg: 'rgba(245,158,11,0.22)',  selBorder: 'rgba(245,158,11,0.65)'  },
  { color: '#3B82F6', bg: 'rgba(59,130,246,0.15)',  selBg: 'rgba(59,130,246,0.22)',  selBorder: 'rgba(59,130,246,0.65)'  },
  { color: '#F43F5E', bg: 'rgba(244,63,94,0.15)',   selBg: 'rgba(244,63,94,0.22)',   selBorder: 'rgba(244,63,94,0.65)'   },
  { color: '#4cd7f6', bg: 'rgba(76,215,246,0.15)',  selBg: 'rgba(76,215,246,0.22)',  selBorder: 'rgba(76,215,246,0.65)'  },
]


const SPACE_TYPE_LABELS: Record<string, string> = {
  small_booth: 'Малая кабинка',
  large_booth: 'Большая кабинка',
  hall: 'Зал',
}

function PosPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const qc = useQueryClient()

  const { data: shift, isLoading: shiftLoading } = useCurrentShift()

  // Таймер для обновления времени на карточках чеков каждые 30 секунд
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // ── Регулируемый сплит (десктоп/планшет ≥1024): ширина правой панели чека ──
  // Тянется мышью или пальцем за ручку между панелями; сохраняется в localStorage.
  const splitRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const saved = parseInt(localStorage.getItem('pos-split-w') ?? '')
    if (saved && splitRef.current) splitRef.current.style.setProperty('--pos-right-w', `${saved}px`)
  }, [])
  const startSplitDrag = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const root = splitRef.current
    if (!root) return
    let last = 0
    const onMove = (ev: PointerEvent) => {
      // Ширина правой панели = расстояние от курсора до правого края окна.
      last = Math.round(Math.min(Math.max(window.innerWidth - ev.clientX, 420), Math.min(960, window.innerWidth - 480)))
      root.style.setProperty('--pos-right-w', `${last}px`)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (last) localStorage.setItem('pos-split-w', String(last))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [])

  const { data: checksData, isLoading, refetch: refetchChecks } = useQuery({
    queryKey: ['checks', 'active'],
    queryFn: () => api.get<{ checks: CheckCard[] }>('/pos/checks'),
    refetchInterval: 5000,
    enabled: !!shift,
  })

  // Предчеки (виртуальные карточки отметившихся в опросе вечера).
  const { data: prechecksData } = useQuery({
    queryKey: ['prechecks'],
    queryFn: () => api.get<{ prechecks: Precheck[] }>('/pos/prechecks'),
    refetchInterval: 20000,
    enabled: !!shift,
  })

  // Сводка смены для карточки кассы (открытые чеки, прогноз Tai, касса).
  const { data: shiftSummary } = useQuery({
    queryKey: ['pos', 'shift-summary'],
    queryFn: () => api.get<ShiftSummary>('/pos/shift-summary'),
    refetchInterval: 30000,
    enabled: !!shift,
  })
  const [showShiftDetail, setShowShiftDetail] = useState(false)

  // Число колонок masonry-сетки — по ШИРИНЕ КОНТЕЙНЕРА (а не окна): в сплите левая
  // панель узкая, и при расчёте от ширины окна колонок было слишком много → ломалось.
  const [cols, setCols] = useState(2)
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const calc = () => {
      // По ширине контейнера. Порог «2 колонки» низкий (≥280): на телефоне грид
      // ~290–360px (вьюпорт минус паддинги), и при пороге 380 он падал в 1 колонку.
      const w = el.clientWidth
      setCols(w >= 980 ? 4 : w >= 620 ? 3 : w >= 280 ? 2 : 1)
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { show: showToast } = useToast()

  const createCheck = useMutation({
    mutationFn: async (body: { note?: string; playerId?: string; spaceId?: string; tariffItemId?: string; linkedEventId?: string }) => {
      const { tariffItemId, ...checkBody } = body
      // Привязка к событию: если открываем чек на зону, у которой сейчас идёт
      // активное мероприятие, прикрепляем его linkedEventId — бэкенд тогда
      // инкрементит число гостей события. (UI выбора события в кассе нет —
      // событие определяется по активной зоне через /events/active-for-space.)
      if (checkBody.spaceId && !checkBody.linkedEventId) {
        try {
          const { event } = await api.get<{ event: { id: string } | null }>(`/events/active-for-space/${checkBody.spaceId}`)
          if (event?.id) checkBody.linkedEventId = event.id
        } catch {
          // не блокируем открытие чека, если проверка события упала
        }
      }
      const res = await api.post<{ check: { id: string } }>('/pos/checks', checkBody)
      if (tariffItemId) {
        // itemId — правильное имя поля согласно AddItemSchema на бэкенде
        await api.post(`/pos/checks/${res.check.id}/items`, { itemId: tariffItemId, quantity: 1 })
          .catch(() => {}) // не блокировать навигацию если добавление позиции упало
      }
      return res
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['checks'] })
      setShowNewCheck(false)
      // На широком экране открываем новый чек в правой панели сплита (как при тапе
      // по карточке), а не на весь экран. На телефоне — отдельной страницей.
      if (window.innerWidth >= 1024) setActiveCheckId(res.check.id)
      else router.push(`/pos/${res.check.id}`)
    },
    onError: (e) => showToast(e instanceof ApiError ? String((e.data as Record<string, unknown>)?.error ?? 'Не удалось создать чек') : 'Ошибка сети', 'error'),
  })

  // Предчек → открытый чек (долгое нажатие). Без навигации: касса остаётся в сетке.
  const openPrecheck = useMutation({
    mutationFn: async (pc: Precheck) => {
      const res = await api.post<{ check: { id: string } }>('/pos/checks', { playerId: pc.playerId })
      if (pc.tariffItemId) {
        await api.post(`/pos/checks/${res.check.id}/items`, { itemId: pc.tariffItemId, quantity: 1 }).catch(() => {})
      }
      return res
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checks'] })
      qc.invalidateQueries({ queryKey: ['prechecks'] })
      showToast('Чек открыт', 'success')
    },
    onError: (e) => showToast(e instanceof ApiError ? String((e.data as Record<string, unknown>)?.error ?? 'Не удалось открыть чек') : 'Ошибка сети', 'error'),
  })
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holdingId, setHoldingId] = useState<string | null>(null)
  function startHold(pc: Precheck) {
    if (openPrecheck.isPending) return
    setHoldingId(pc.playerId)
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => { holdTimer.current = null; setHoldingId(null); openPrecheck.mutate(pc) }, 600)
  }
  function cancelHold() {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
    setHoldingId(null)
  }

  const createClient = useMutation({
    // POST /clients возвращает { client: {...} } — раньше читали .profile.id (undefined),
    // из-за чего открытие чека падало молча: клиент создавался, а чек не открывался.
    mutationFn: (body: { nickname: string; clientTier: string; fullName?: string; gomafiaPhotoUrl?: string; searchTags?: string[] }) =>
      api.post<{ client: { id: string } }>('/clients', body),
  })

  // Open shift modal state
  const [showOpenShift, setShowOpenShift] = useState(false)

  // New check modal state
  const [showNewCheck, setShowNewCheck] = useState(false)
  const [newCheckStep, setNewCheckStep] = useState<NewCheckStep>('search')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PlayerResult[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerResult | null>(null)
  const [newClientNick, setNewClientNick] = useState('')
  const [newClientTier, setNewClientTier] = useState('newbie')
  // Подбор GoMafia в шаге «новый клиент».
  const [posGmQuery, setPosGmQuery] = useState('')
  const [posGmResults, setPosGmResults] = useState<any[]>([])
  const [posGmLoading, setPosGmLoading] = useState(false)
  const [posGmPicked, setPosGmPicked] = useState<{ gomafiaId: string; login: string; fullName: string | null; photoUrl: string | null } | null>(null)
  const [selectedTariffId, setSelectedTariffId] = useState<string | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Desktop split-view: активный чек справа
  const [activeCheckId, setActiveCheckId] = useState<string | null>(null)
  // Анимация закрытия правой панели сплита: ставим класс .closing, ждём анимацию, размонтируем.
  const [rightClosing, setRightClosing] = useState(false)
  const closeRightPanel = useCallback(() => {
    setRightClosing(true)
    // Чек могли удалить/оплатить в панели — сразу обновляем сетку и сводку смены.
    qc.invalidateQueries({ queryKey: ['checks'] })
    qc.invalidateQueries({ queryKey: ['pos', 'shift-summary'] })
    setTimeout(() => { setRightClosing(false); setActiveCheckId(null) }, 200)
  }, [qc])

  // Close shift modal state
  const [showCloseShift, setShowCloseShift] = useState(false)

  // Открыть модал закрытия смены если URL содержит ?close=1 (из Sidebar)
  useEffect(() => {
    if (searchParams.get('close') === '1') {
      setShowCloseShift(true)
      // Убираем параметр из URL без перехода
      router.replace('/pos')
    }
  }, [searchParams, router])

  // Birthdays
  const [showBirthdays, setShowBirthdays] = useState(false)
  const [birthdaysShown, setBirthdaysShown] = useState(false)

  const { data: birthdaysData } = useQuery({
    queryKey: ['shifts', 'birthdays-today'],
    queryFn: () => api.get<{ birthdays: { id: string; nickname: string; birthday: string | null; photoUrl?: string | null }[] }>('/shifts/birthdays-today'),
    enabled: !!shift && !birthdaysShown,
  })

  useEffect(() => {
    if (birthdaysData?.birthdays?.length && !birthdaysShown) {
      setShowBirthdays(true)
      setBirthdaysShown(true)
    }
  }, [birthdaysData, birthdaysShown])

  // Spaces for rental step
  const { data: spacesData } = useQuery({
    queryKey: ['pos', 'spaces'],
    queryFn: () => api.get<{ spaces: SpaceResult[] }>('/pos/spaces'),
    enabled: newCheckStep === 'space',
  })

  // Тарифы из стандартизированного справочника /tariffs (активные). У каждого
  // тарифа есть backing itemId — его и добавляем позицией в чек при выборе.
  const { data: tariffsData } = useQuery({
    queryKey: ['pricing', 'tariffs'],
    queryFn: () => api.get<{ tariffs: TariffOption[] } | TariffOption[]>('/pricing/tariffs'),
    enabled: newCheckStep === 'tariff',
  })
  const allTariffs: TariffOption[] = Array.isArray(tariffsData) ? tariffsData : (tariffsData?.tariffs ?? [])
  const tariffItems = allTariffs.filter(t => t.isActive !== false)

  // Предвыбор тарифа по СТАТУСУ клиента (тариф = статус, матч по key; фолбэк по имени).
  useEffect(() => {
    if (newCheckStep !== 'tariff' || !tariffsData || !selectedPlayer) return
    // Сотрудник на чеке — без игрового тарифа (предвыбор «Без тарифа»).
    const role = (selectedPlayer as { role?: string }).role
    if (role === 'staff' || role === 'owner') { setSelectedTariffId(null); return }
    const byKey = tariffItems.find(t => t.key && t.key === selectedPlayer.clientTier)
    const fallbackName = TIER_TO_TARIFF_NAME[selectedPlayer.clientTier]
    const match = byKey ?? (fallbackName ? tariffItems.find(t => t.name.toLowerCase() === fallbackName.toLowerCase()) : undefined)
    setSelectedTariffId(match?.id ?? null)
  }, [newCheckStep, tariffsData, selectedPlayer]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced player search. Раскладку/транслитерацию и поля (ник/имя/Telegram/
  // ник GoMafia) раскрывает сервер — отправляем сырой запрос.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const r = await api.get<{ players: PlayerResult[] }>(`/pos/players/search?q=${encodeURIComponent(searchQuery)}`)
        setSearchResults(r.players ?? [])
      } catch {
        setSearchResults([])
      }
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery])

  // Подбор GoMafia в шаге «новый клиент»: дебаунс-поиск (клуб → все игроки).
  useEffect(() => {
    if (newCheckStep !== 'new_client') return
    const q = posGmQuery.trim()
    if (q.length < 2) { setPosGmResults([]); setPosGmLoading(false); return }
    setPosGmLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ players: PosGmPlayer[] }>(`/gomafia/search?q=${encodeURIComponent(q)}`)
        setPosGmResults(Array.isArray(r.players) ? r.players : [])
      } catch { setPosGmResults([]) }
      finally { setPosGmLoading(false) }
    }, 350)
    return () => clearTimeout(t)
  }, [posGmQuery, newCheckStep])

  async function pickPosGomafia(p: PosGmPlayer) {
    setPosGmPicked({ gomafiaId: String(p.gomafiaId), login: p.login, fullName: null, photoUrl: p.avatar ?? null })
    setNewClientNick(p.login || '')
    setPosGmQuery('')
    setPosGmResults([])
    try {
      const r = await api.get<{ player: { fullName?: string | null } }>(`/gomafia/player/${p.gomafiaId}`)
      if (r.player?.fullName) setPosGmPicked(prev => (prev ? { ...prev, fullName: r.player.fullName ?? null } : prev))
    } catch { /* имя необязательно */ }
  }

  function openNewCheckModal() {
    setShowNewCheck(true)
    setNewCheckStep('search')
    setSearchQuery('')
    setSearchResults([])
    setSelectedPlayer(null)
    setNewClientNick('')
    setNewClientTier('guest')
    setPosGmQuery('')
    setPosGmResults([])
    setPosGmPicked(null)
  }

  function closeNewCheckModal() {
    setShowNewCheck(false)
  }

  // FAB в BottomNav открывает новый чек через CustomEvent
  useEffect(() => {
    const handler = () => { if (shift) openNewCheckModal() }
    window.addEventListener('titan:new-check', handler)
    return () => window.removeEventListener('titan:new-check', handler)
  }, [shift])

  const checks = checksData?.checks ?? []
  const prechecks = prechecksData?.prechecks ?? []

  // Карточка смены должна пересчитываться сразу при изменении набора/сумм открытых
  // чеков (удаление/оплата/добавление позиции), а не раз в 30с. Подпись по чекам
  // (id+сумма+кол-во позиций) меняется → инвалидируем сводку смены.
  const checksSig = checks.map(c => `${c.id}:${c.totalAmount}:${c.itemCount}`).join('|')
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['pos', 'shift-summary'] })
  }, [checksSig, qc])

  // «Пульс» карточки чека: непрочитанное обращение гостя (чат / вызов / заказ /
  // запрос счёта). staff_call привязан к пространству (без checkId), остальные — к чеку.
  const { notifications: appNotifs } = useNotifications()
  const ATTENTION_TYPES = new Set(['staff_call', 'request_bill', 'client_order', 'chat_message'])
  function checkNeedsAttention(card: CheckCard): boolean {
    return appNotifs.some((n) => {
      if (n.isRead || !ATTENTION_TYPES.has(n.type)) return false
      const m = (n.meta ?? {}) as Record<string, unknown>
      return m['checkId'] === card.id || (n.type === 'staff_call' && !!card.spaceId && m['spaceId'] === card.spaceId)
    })
  }

  const avgTime = checks.length
    ? Math.round(checks.reduce((acc, c) => acc + differenceInMinutes(now, new Date(c.createdAt)), 0) / checks.length)
    : 0

  // Определяем режим split-view через CSS media
  // На десктопе клик открывает панель справа, на мобильном — навигация
  function handleCheckClick(checkId: string) {
    if (window.innerWidth >= 1024) {
      setActiveCheckId(checkId)
    } else {
      router.push(`/pos/${checkId}`)
    }
  }

  // paddingBottom:0 на корне перебивает глобальное правило
  // `.layout-content > :last-child { padding-bottom: --bottom-nav-clear }`: для
  // height:100% flex-контейнера этот отступ укорачивал видимую область и создавал
  // «мёртвую» полосу, перекрывавшую чеки. Клиренс под плавающую нижнюю навигацию
  // перенесён на саму сетку карточек (.pos-cards-grid, прокручиваемый контент).
  return (
    <div ref={splitRef} style={{ height: '100%', display: 'flex', flexDirection: 'row', overflow: 'hidden', paddingBottom: 0 }}>
      {/* Left panel — список чеков (всегда виден) */}
      <div className="pos-left-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

      {/* Page header */}
      <div className="pos-header" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          {/* Left: title + count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <h2 className="pos-header-title" style={{ margin: 0, flexShrink: 0, letterSpacing: '-0.01em', color: 'var(--on-surface)' }}>Касса</h2>
            {checks.length > 0 && (
              <div className="glass-l2" style={{ borderRadius: 999, padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <Icon name="groups" size={13} color="var(--on-surface-variant)" />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-variant)' }}>{checks.length}</span>
              </div>
            )}
          </div>

          {/* Right: action icon buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {/* Возврат — только мобильный режим (на десктопе есть нижняя панель) */}
            {shift && (
              <button
                onClick={() => router.push('/manage/refunds')}
                className="glass-l2 pos-header-actions"
                title="Возврат"
                style={{ width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
                <Icon name="money_return" size={18} color="var(--on-surface-variant)" />
              </button>
            )}
            {/* Tai: «открой чек на Саида», «как идёт смена?» */}
            <TaiButton context={{ screen: 'pos' }} />
            {/* Колокольчик уведомлений: бейдж непрочитанных + тряска при важных */}
            <NotificationBell />
          </div>
        </div>
      </div>
      <style>{`
        .pos-header {
          padding: 10px 14px 8px;
        }
        .pos-header-title {
          font-size: 18px;
          font-weight: 800;
        }
        /* На десктопе шапку с иконками прячем — там есть нижняя панель */
        @media (min-width: 1024px) {
          .pos-header {
            padding: 24px 32px 0;
          }
          .pos-header-title {
            font-size: 24px;
          }
          .pos-header-actions {
            display: none;
          }
        }
      `}</style>

      {/* Cards grid — scrollable */}
      <PullToRefreshContainer onRefresh={async () => { await refetchChecks() }} disabled={!shift}>
      <div className="pos-cards-wrap" style={{ flex: 1 }}>
        <div className="pos-cards-grid" ref={gridRef}>
        <style>{`
          /* Masonry со смещением правой колонки (стиль Apple «Воспоминания»):
             раскладку строит MasonryColumns (flex-колонки), здесь — облик карточек:
             крупные скругления, воздух, мягкий фон. Высота — по числу позиций. */
          .pos-cards-wrap { padding: 10px 14px calc(20px + var(--bottom-nav-clear, 0px)); }
          .pos-check-card { padding: 14px; border-radius: 24px !important; }
          .pos-check-card .card-avatar { width: 32px; height: 32px; font-size: 11px; }
          .pos-check-card .card-name { font-size: 13px; }
          .pos-check-card .card-space { font-size: 10px; }
          .pos-check-card .card-amount { font-size: 23px; }
          .pos-check-card .card-line { font-size: 11.5px; }
          .pos-check-card .card-top { margin-bottom: 10px; gap: 9px; }
          @media (min-width: 480px) {
            .pos-check-card { padding: 16px; }
            .pos-check-card .card-avatar { width: 36px; height: 36px; font-size: 12px; }
            .pos-check-card .card-amount { font-size: 25px; }
            .pos-check-card .card-line { font-size: 12px; }
          }
          @media (min-width: 1024px) {
            .pos-cards-wrap { padding: 0 32px 24px; max-width: var(--content-wide); margin: 0 auto; }
            .pos-check-card { padding: 18px; border-radius: 28px !important; }
            .pos-check-card .card-avatar { width: 40px; height: 40px; font-size: 13px; }
            .pos-check-card .card-amount { font-size: 28px; }
            .pos-check-card .card-line { font-size: 12.5px; }
            .pos-check-card .card-top { margin-bottom: 13px; gap: 11px; }
          }
        `}</style>

          <MasonryColumns cols={cols} items={([
            // Скелетоны при загрузке
            ...(isLoading ? Array.from({ length: 6 }).map((_, i) => (
              <div key={`sk${i}`} className="skeleton" style={{ height: 120 + (i % 3) * 44, borderRadius: 24 }} />
            )) : []),
            // Открытые чеки
            ...checks.map((check, idx) => {
            const warn = isWarning(check.createdAt, now)
            const timerColor = getTimerColor(check.createdAt, now)
            const isActive = activeCheckId === check.id
            const attention = checkNeedsAttention(check)
            // Почасовая аренда: итог на карточке = позиции + живой счётчик аренды.
            const rental = computeRental(check.spaceStartAt, check.spaceEndAt, check.spaceHourlyRate, now)
            const displayTotal = parseFloat(check.totalAmount) + rental + (parseFloat(check.eventBaseAmount ?? '0') || 0)
            const cardName = check.guestName || funnyGuestName(check.id)
            return (
              <button
                key={check.id}
                onClick={() => handleCheckClick(check.id)}
                className={`glass-l2 ti-slide-up stagger-${Math.min(idx, 6)} pos-check-card${attention ? ' pos-card-attention' : ''}`}
                style={{
                  borderRadius: 16,
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: isActive ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: isActive ? '0 0 20px rgba(139,92,246,0.2)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0,
                  transition: 'all 0.3s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget
                  el.style.transform = 'scale(1.02)'
                  el.style.border = '1px solid rgba(139,92,246,0.5)'
                  el.style.boxShadow = '0 0 20px rgba(139,92,246,0.2)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget
                  el.style.transform = 'scale(1)'
                  el.style.border = '1px solid rgba(255,255,255,0.08)'
                  el.style.boxShadow = 'none'
                }}
              >
                {/* Полоса-маркер только для семантики «требует внимания» */}
                {attention && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#F59E0B', opacity: 0.9, pointerEvents: 'none' }} />}
                {attention && (
                  <span style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, width: 26, height: 26, borderRadius: '50%', background: 'rgba(245,158,11,0.95)', boxShadow: '0 0 0 3px rgba(245,158,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="notifications_active" size={15} color="#1a1622" />
                  </span>
                )}
                {/* Top: avatar + nick */}
                <div className="card-top" style={{ display: 'flex', alignItems: 'center' }}>
                  <div className="card-avatar" style={{
                    borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                    border: '1px solid rgba(139,92,246,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, color: '#A78BFA',
                    background: check.guestPhotoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(76,215,246,0.3))',
                  }}>
                    {check.guestPhotoUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={check.guestPhotoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : getInitials(cardName)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="card-name" style={{ fontWeight: 700, color: 'var(--on-surface)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cardName}
                    </p>
                    {check.spaceName && (
                      <p className="card-space" style={{ color: 'var(--on-surface-variant)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{check.spaceName}</p>
                    )}
                  </div>
                </div>

                {/* Позиции чека: до 5 строк; >5 → 4 строки + «Ещё N» */}
                {(() => {
                  const items = check.items ?? []
                  const more = check.itemCount > 5
                  const shown = more ? items.slice(0, 4) : items
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '9px 0 10px' }}>
                      {shown.map((it, i) => (
                        <div key={i} className="card-line" style={{ display: 'flex', gap: 6, alignItems: 'baseline', color: 'var(--on-surface-variant)' }}>
                          <span style={{ color: 'rgba(167,139,250,0.7)', flexShrink: 0 }}>•</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it}</span>
                        </div>
                      ))}
                      {more && <div className="card-line" style={{ color: '#A78BFA', fontWeight: 600, paddingLeft: 12 }}>Ещё {check.itemCount - 4}</div>}
                      {check.itemCount === 0 && <div className="card-line" style={{ color: 'rgba(204,195,216,0.4)' }}>Чек пуст</div>}
                    </div>
                  )
                })()}

                {/* Footer: время открытия + крупная сумма */}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name={warn ? 'warning' : 'schedule'} size={13} color={timerColor} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: timerColor, animation: warn ? 'pulse-dot 2s ease-in-out infinite' : 'none' }}>
                      {formatElapsed(check.createdAt, now)}
                    </span>
                  </div>
                  <p className="card-amount" style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: 'var(--on-surface)', lineHeight: 1, margin: 0 }}>
                    {displayTotal.toLocaleString('ru')} ₽
                  </p>
                </div>

                {/* Rental stripe */}
                {check.hasRental && (
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
                    background: 'linear-gradient(90deg, #8B5CF6, #4cd7f6)',
                  }} />
                )}
              </button>
            )
          }),
            // Предчеки — тот же стиль карточки (ИИ-фон, тариф как позиция)
            ...prechecks.map((pc) => {
            const holding = holdingId === pc.playerId
            const price = parseFloat(String(pc.tariffPrice ?? 0)) || 0
            return (
              <div
                key={`pre-${pc.playerId}`}
                className="pos-check-card"
                onPointerDown={() => startHold(pc)}
                onPointerUp={cancelHold}
                onPointerLeave={cancelHold}
                onPointerCancel={cancelHold}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  borderRadius: 16, textAlign: 'left', cursor: 'pointer', position: 'relative', overflow: 'hidden',
                  border: '1px solid rgba(160,125,255,0.4)', opacity: holding ? 0.92 : 0.66,
                  display: 'flex', flexDirection: 'column',
                  transform: holding ? 'scale(0.97)' : 'scale(1)', transition: 'transform .15s, opacity .15s',
                  background: 'linear-gradient(120deg, rgba(130,88,242,0.26), rgba(76,215,246,0.13), rgba(160,125,255,0.3), rgba(76,215,246,0.13), rgba(130,88,242,0.26))',
                  backgroundSize: '300% 300%', animation: 'tai-precheck-bg 5s ease infinite',
                  WebkitTapHighlightColor: 'transparent', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
                }}
              >
                {/* Переливающийся «ИИ-блик» поверх фона */}
                <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 16, background: 'linear-gradient(105deg, transparent 35%, rgba(224,195,252,0.22) 50%, transparent 65%)', backgroundSize: '250% 100%', animation: 'tai-precheck-sheen 2.8s linear infinite' }} />
                <div className="card-top" style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                  <div className="card-avatar" style={{
                    borderRadius: '50%', flexShrink: 0, overflow: 'hidden', border: '1px solid rgba(160,125,255,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#A78BFA',
                    background: pc.photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(130,88,242,0.35), rgba(76,215,246,0.3))',
                  }}>
                    {pc.photoUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={pc.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : getInitials(pc.nickname)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="card-name" style={{ fontWeight: 600, color: 'var(--on-surface)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pc.nickname}</p>
                    <p className="card-space" style={{ color: '#A78BFA', margin: 0 }}>{pc.vote === 'опоздаю' ? 'Опоздает' : 'Придёт'} · предчек</p>
                  </div>
                  <TaiLogo size={28} thinking float={false} />
                </div>

                {/* Позиция-тариф (как строка позиции у чека) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '9px 0 10px', position: 'relative' }}>
                  <div className="card-line" style={{ display: 'flex', gap: 6, alignItems: 'baseline', color: 'var(--on-surface-variant)' }}>
                    <span style={{ color: 'rgba(167,139,250,0.7)', flexShrink: 0 }}>•</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pc.tariffName ?? 'Тариф'}</span>
                  </div>
                </div>

                {/* Footer: подсказка + крупная сумма */}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, marginTop: 'auto', position: 'relative' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#A78BFA', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Удерживайте</span>
                  <p className="card-amount" style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: 'var(--on-surface)', lineHeight: 1, margin: 0 }}>
                    {price.toLocaleString('ru')} ₽
                  </p>
                </div>

                {holding && <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, background: 'linear-gradient(90deg,#A07DFF,#4cd7f6)', animation: 'tai-hold 0.6s linear forwards' }} />}
              </div>
            )
          }),
            // Карточка смены — предпоследняя (перед «Новый чек»)
            ...(!shiftLoading ? [(
              <ShiftCard
                key="shift-card"
                shift={shift}
                summary={shiftSummary}
                onOpen={() => setShowOpenShift(true)}
                onCloseShift={() => setShowCloseShift(true)}
                onDetail={() => setShowShiftDetail(true)}
              />
            )] : []),
            // Новый чек — последняя карточка
            ...((shift && !isLoading) ? [(
              <button
                key="new-check"
                onClick={openNewCheckModal}
                style={{
                  borderRadius: 24,
                  padding: 14,
                  cursor: 'pointer',
                  background: 'rgba(139,92,246,0.03)',
                  border: '1.5px dashed rgba(139,92,246,0.3)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 10, minHeight: 100, transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.08)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.6)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.03)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.3)' }}
              >
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(76,215,246,0.25))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="add" size={22} color="#A78BFA" />
                </div>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#A78BFA' }}>
                  НОВЫЙ ЧЕК
                </span>
              </button>
            )] : []),
          ]).filter(Boolean)} />
          {prechecks.length > 0 && (
            <style>{`@keyframes tai-precheck-bg{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}@keyframes tai-precheck-sheen{0%{background-position:220% 0}100%{background-position:-60% 0}}@keyframes tai-hold{from{width:0}to{width:100%}}`}</style>
          )}
        </div>
      </div>
      </PullToRefreshContainer>

      {/* Bottom action bar */}
      {shift && (
        <div className="pos-action-bar" style={{
          flexShrink: 0,
          background: 'rgba(29,26,36,0.4)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          gap: 8,
        }}>
        <style>{`
          /* На мобильном bottom bar скрыт — кнопки перенесены в шапку */
          .pos-action-bar { display: none; }
          @media (min-width: 1024px) {
            .pos-action-bar { display: flex; padding: 16px 32px; gap: 12px; }
            .pos-action-btn { padding: 12px 20px !important; border-radius: 14px !important; }
            .pos-action-btn .btn-label { display: inline; }
          }
        `}</style>
          <button
            onClick={openNewCheckModal}
            className="glass-l2 pos-action-btn"
            style={{
              border: '1px solid rgba(139,92,246,0.4)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: '#A78BFA',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              transition: 'all 0.2s',
            }}
          >
            <Icon name="add_circle" size={18} />
            <span className="btn-label">НОВЫЙ СЧЁТ</span>
          </button>
          <button
            onClick={() => router.push('/manage/refunds')}
            className="glass-l2 pos-action-btn"
            style={{
              marginLeft: 'auto',
              border: '1px solid rgba(255,255,255,0.1)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--on-surface-variant)',
              fontSize: 12,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            <Icon name="money_return" size={18} />
            <span className="btn-label">ВОЗВРАТ</span>
          </button>
        </div>
      )}

      {/* Состояние «смена не открыта» теперь — карточка ShiftCard в сетке кассы. */}

      <ShiftDetailSheet open={showShiftDetail} onClose={() => setShowShiftDetail(false)} summary={shiftSummary} />

      <OpenShiftModal open={showOpenShift} onClose={() => setShowOpenShift(false)} />

      {/* New Check Modal — multi-step */}
      {showNewCheck && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(13,21,38,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) closeNewCheckModal() }}
        >
          <div
            className="glass-l1"
            style={{ borderRadius: 32, maxWidth: 520, width: '100%', maxHeight: '90dvh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}
          >
            {/* Step: search */}
            {newCheckStep === 'search' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 24 }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 14, flexShrink: 0,
                    background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 20px rgba(139,92,246,0.35)',
                  }}>
                    <Icon name="receipt_long" size={26} color="#fff" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>
                      НОВЫЙ ЧЕК
                    </h2>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>
                      ШАГ 1 — ВЫБЕРИТЕ ИГРОКА
                    </p>
                  </div>
                  <button
                    onClick={closeNewCheckModal}
                    style={{ width: 32, height: 32, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>

                {/* Search input */}
                <div style={{ position: 'relative', marginBottom: 16 }}>
                  <Icon name="search" size={18} color="var(--on-surface-variant)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Имя игрока..."
                    className="glass-l2"
                    style={{
                      width: '100%', padding: '14px 14px 14px 44px', borderRadius: 14,
                      border: '1px solid rgba(139,92,246,0.25)', color: 'var(--on-surface)',
                      fontSize: 15, outline: 'none', background: 'none',
                    }}
                  />
                </div>

                {/* Search results */}
                {searchResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, maxHeight: 280, overflowY: 'auto' }}>
                    {searchResults.map(player => (
                      <button
                        key={player.id}
                        onClick={() => { setSelectedPlayer(player); setNewCheckStep('tariff') }}
                        className="glass-l2"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '12px 14px', borderRadius: 14,
                          border: '1px solid rgba(255,255,255,0.07)',
                          cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.4)'; e.currentTarget.style.background = 'rgba(139,92,246,0.08)' }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; e.currentTarget.style.background = '' }}
                      >
                        <div style={{
                          width: 38, height: 38, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                          background: player.photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(76,215,246,0.35))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 13, fontWeight: 700, color: '#A78BFA',
                        }}>
                          {player.photoUrl
                            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={player.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : getInitials(player.nickname)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {player.nickname}
                          </p>
                          <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>
                            {TIER_LABELS[player.clientTier] ?? player.clientTier}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pay-deposit)', background: 'rgba(6,182,212,0.1)', borderRadius: 6, padding: '2px 7px' }}>
                            {parseFloat(player.balance).toLocaleString('ru')} ₽
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pay-bonus)', background: 'rgba(245,158,11,0.1)', borderRadius: 6, padding: '2px 7px' }}>
                            ★ {parseFloat(player.bonusPoints).toLocaleString('ru')}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {searchQuery.trim() && searchResults.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px 0 8px', color: 'var(--on-surface-variant)', fontSize: 13 }}>
                    Игрок не найден
                  </div>
                )}

                {/* Quick action buttons */}
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button
                    onClick={() => createCheck.mutate({})}
                    disabled={createCheck.isPending}
                    className="glass-l2"
                    style={{
                      flex: 1, padding: '12px 10px', borderRadius: 14,
                      border: '1px solid rgba(255,255,255,0.1)',
                      cursor: 'pointer', color: 'var(--on-surface-variant)',
                      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <Icon name="person_off" size={16} />
                    БЕЗ КЛИЕНТА
                  </button>
                  <button
                    onClick={() => setNewCheckStep('new_client')}
                    className="glass-l2"
                    style={{
                      flex: 1, padding: '12px 10px', borderRadius: 14,
                      border: '1px solid rgba(76,215,246,0.3)',
                      cursor: 'pointer', color: '#4cd7f6',
                      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <Icon name="person_add" size={16} />
                    НОВЫЙ КЛИЕНТ
                  </button>
                  <button
                    onClick={() => setNewCheckStep('space')}
                    className="glass-l2"
                    style={{
                      flex: 1, padding: '12px 10px', borderRadius: 14,
                      border: '1px solid rgba(139,92,246,0.35)',
                      cursor: 'pointer', color: '#A78BFA',
                      fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}
                  >
                    <Icon name="meeting_room" size={16} />
                    АРЕНДА
                  </button>
                </div>
              </div>
            )}

            {/* Step: tariff */}
            {newCheckStep === 'tariff' && selectedPlayer && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <button
                    onClick={() => setNewCheckStep('search')}
                    style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>ТАРИФ</h2>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>
                      ШАГ 2 — ВЫБЕРИТЕ ТАРИФ
                    </p>
                  </div>
                </div>

                {/* Selected player display */}
                <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, marginBottom: 20, border: '1px solid rgba(139,92,246,0.25)' }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
                    background: selectedPlayer.photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(76,215,246,0.35))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: '#A78BFA',
                  }}>
                    {selectedPlayer.photoUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={selectedPlayer.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : getInitials(selectedPlayer.nickname)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--on-surface)' }}>{selectedPlayer.nickname}</p>
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{TIER_LABELS[selectedPlayer.clientTier] ?? selectedPlayer.clientTier}</p>
                  </div>
                </div>

                {/* Tariff list — from /tariffs, with pre-selection by player tier */}
                {!tariffsData ? (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--on-surface-variant)', fontSize: 13 }}>
                    Загрузка тарифов…
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                    {/* Сетка: Резидент·Новичок·Студент (по 2 кол.) → Гость·Одна игра
                        (по 3 кол.) → прочие тарифы → Без тарифа (на всю ширину). */}
                    {(() => {
                      const byKey = (k: string) => tariffItems.find(t => t.key === k)
                      const ordered: TariffOption[] = []
                      for (const k of ['resident', 'newbie', 'student', 'guest']) { const t = byKey(k); if (t) ordered.push(t) }
                      for (const t of tariffItems) { if (!ordered.includes(t)) ordered.push(t) }
                      return ordered.map((item, idx) => {
                        const price = parseFloat(String(item.price)) || 0
                        const isSelected = selectedTariffId === item.id
                        const color = item.color || TARIFF_PALETTE[idx % TARIFF_PALETTE.length].color
                        const span = idx < 3 ? 2 : 3 // первые 3 — ряд по три; дальше — по два
                        return (
                          <button
                            key={item.id}
                            onClick={() => setSelectedTariffId(isSelected ? null : item.id)}
                            disabled={createCheck.isPending}
                            className="glass-l2"
                            style={{
                              gridColumn: `span ${span}`,
                              padding: '14px 8px', borderRadius: 14,
                              border: isSelected ? `1px solid ${color}` : '1px solid rgba(255,255,255,0.08)',
                              background: isSelected ? `${color}22` : 'transparent',
                              boxShadow: isSelected ? `0 0 0 1px ${color}55` : 'none',
                              cursor: 'pointer', textAlign: 'center', minWidth: 0,
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                              transition: 'all 0.18s', opacity: createCheck.isPending ? 0.6 : 1,
                            }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 700, color: isSelected ? '#fff' : 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{item.name}</span>
                            <span style={{ fontSize: 14, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums' }}>{price.toLocaleString('ru')} ₽</span>
                          </button>
                        )
                      })
                    })()}

                    {/* Без тарифа — на всю ширину */}
                    <button
                      onClick={() => setSelectedTariffId(null)}
                      disabled={createCheck.isPending}
                      style={{
                        gridColumn: '1 / -1',
                        padding: '12px 16px', borderRadius: 14,
                        border: selectedTariffId === null ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.06)',
                        background: selectedTariffId === null ? 'rgba(255,255,255,0.06)' : 'transparent',
                        cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 12,
                        opacity: createCheck.isPending ? 0.6 : 1, transition: 'all 0.18s',
                      }}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="block" size={17} color="var(--on-surface-variant)" />
                      </div>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 600, color: selectedTariffId === null ? 'var(--on-surface)' : 'var(--on-surface-variant)' }}>Без тарифа</span>
                        <p style={{ fontSize: 11, color: 'rgba(204,195,216,0.4)', margin: '2px 0 0' }}>Открыть счёт без добавления позиции</p>
                      </div>
                    </button>

                    {/* Confirm button */}
                    <button
                      onClick={() => {
                        const chosen = tariffItems.find(t => t.id === selectedTariffId)
                        createCheck.mutate({ playerId: selectedPlayer.id, tariffItemId: chosen?.itemId ?? undefined })
                      }}
                      disabled={createCheck.isPending}
                      style={{
                        gridColumn: '1 / -1',
                        marginTop: 4, width: '100%', padding: '15px 0', borderRadius: 16,
                        border: 'none', cursor: 'pointer',
                        background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
                        color: '#fff', fontSize: 14, fontWeight: 700,
                        boxShadow: '0 4px 20px rgba(139,92,246,0.35)',
                        opacity: createCheck.isPending ? 0.7 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      {createCheck.isPending ? 'Открываем…' : 'Открыть счёт'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Step: new_client */}
            {newCheckStep === 'new_client' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <button
                    onClick={() => setNewCheckStep('search')}
                    style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>НОВЫЙ КЛИЕНТ</h2>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>
                      ШАГ 3 — ДАННЫЕ
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Поле 1 — поиск по GoMafia */}
                  <div>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--on-surface-variant)' }}>
                      Поиск в GoMafia
                    </label>
                    {posGmPicked ? (
                      <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14, border: '1px solid rgba(139,92,246,0.3)' }}>
                        {posGmPicked.photoUrl
                          ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={posGmPicked.photoUrl} alt="" width={36} height={36} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                          : <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="person" size={18} color="#a78bfa" /></div>}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{posGmPicked.login}</p>
                          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--on-surface-variant)' }}>GoMafia #{posGmPicked.gomafiaId}{posGmPicked.fullName ? ` · ${posGmPicked.fullName}` : ''}</p>
                        </div>
                        <button onClick={() => { setPosGmPicked(null) }} aria-label="Отвязать"
                          style={{ width: 32, height: 32, borderRadius: 9, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon name="close" size={16} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          value={posGmQuery}
                          onChange={e => setPosGmQuery(e.target.value)}
                          placeholder="Ник игрока на GoMafia…"
                          className="glass-l2"
                          style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', color: 'var(--on-surface)', fontSize: 15, outline: 'none', background: 'none' }}
                        />
                        {posGmQuery.trim().length >= 2 && (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                            {posGmLoading && <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '4px 2px' }}>Поиск…</p>}
                            {!posGmLoading && posGmResults.length === 0 && <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '4px 2px' }}>Игроки не найдены</p>}
                            {posGmResults.map(p => (
                              <button key={p.gomafiaId} type="button" onClick={() => pickPosGomafia(p)} className="glass-l2"
                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', textAlign: 'left', width: '100%', background: 'none' }}>
                                {p.avatar
                                  ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.avatar} alt="" width={34} height={34} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                                  : <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="person" size={18} color="var(--on-surface-variant)" /></div>}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.login}</span>
                                    {p.inClub && <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 5, background: 'rgba(139,92,246,0.2)', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>клуб</span>}
                                  </div>
                                  <p style={{ margin: '1px 0 0', fontSize: 11, color: 'var(--on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.clubTitle ? p.clubTitle : 'Без клуба'}{p.elo != null ? ` · ELO ${Math.round(p.elo)}` : ''}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '8px 2px 0', lineHeight: 1.4 }}>
                          Сначала игроки вашего клуба, затем все игроки сайта.
                        </p>
                      </>
                    )}
                  </div>

                  {/* Поле 2 — никнейм вручную (для тех, у кого нет GoMafia) */}
                  <div>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--on-surface-variant)' }}>
                      Никнейм * {posGmPicked ? '' : '(если нет GoMafia)'}
                    </label>
                    <input
                      value={newClientNick}
                      onChange={e => setNewClientNick(e.target.value)}
                      placeholder="Имя игрока"
                      className="glass-l2"
                      style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', color: 'var(--on-surface)', fontSize: 15, outline: 'none', background: 'none' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--on-surface-variant)' }}>
                      Тип
                    </label>
                    <select
                      value={newClientTier}
                      onChange={e => setNewClientTier(e.target.value)}
                      className="glass-l2"
                      style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', color: 'var(--on-surface)', fontSize: 14, outline: 'none', background: 'rgba(255,255,255,0.04)' }}
                    >
                      <option value="newbie">Новичок</option>
                      <option value="guest">Гость</option>
                      <option value="resident">Резидент</option>
                      <option value="student">Студент</option>
                    </select>
                  </div>
                  <button
                    onClick={async () => {
                      if (!newClientNick.trim()) return
                      const body: { nickname: string; clientTier: string; fullName?: string; gomafiaPhotoUrl?: string; searchTags?: string[] } = {
                        nickname: newClientNick.trim(), clientTier: newClientTier,
                      }
                      if (posGmPicked) {
                        body.searchTags = [`gomafia:${posGmPicked.gomafiaId}`]
                        if (posGmPicked.photoUrl) body.gomafiaPhotoUrl = posGmPicked.photoUrl
                        if (posGmPicked.fullName) body.fullName = posGmPicked.fullName
                      }
                      const clientRes = await createClient.mutateAsync(body)
                      createCheck.mutate({ playerId: clientRes.client.id })
                    }}
                    disabled={!newClientNick.trim() || createClient.isPending || createCheck.isPending}
                    style={{
                      marginTop: 8, padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                      background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
                      color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
                      boxShadow: '0 4px 20px rgba(139,92,246,0.35)',
                      opacity: (!newClientNick.trim() || createClient.isPending || createCheck.isPending) ? 0.5 : 1,
                    }}
                  >
                    {createClient.isPending || createCheck.isPending ? 'СОЗДАЁМ...' : 'СОЗДАТЬ И ОТКРЫТЬ ЧЕК'}
                  </button>
                  {createClient.isError && (
                    <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>
                      {(createClient.error as Error)?.message ?? 'Ошибка создания'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Step: space */}
            {newCheckStep === 'space' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <button
                    onClick={() => setNewCheckStep('search')}
                    style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>АРЕНДА</h2>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>
                      ШАГ 3 — ПРОСТРАНСТВО
                    </p>
                  </div>
                </div>

                {!spacesData && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="skeleton" style={{ height: 72, borderRadius: 14 }} />
                    ))}
                  </div>
                )}

                {spacesData?.spaces.length === 0 && (
                  <p style={{ color: 'var(--on-surface-variant)', textAlign: 'center', padding: '24px 0' }}>Нет активных пространств</p>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(spacesData?.spaces ?? []).map(space => (
                    <button
                      key={space.id}
                      onClick={() => createCheck.mutate({ spaceId: space.id })}
                      disabled={createCheck.isPending}
                      className="glass-l2"
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14,
                        padding: '14px 16px', borderRadius: 14,
                        border: '1px solid rgba(255,255,255,0.08)',
                        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                        opacity: createCheck.isPending ? 0.6 : 1,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.4)'; e.currentTarget.style.background = 'rgba(139,92,246,0.08)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = '' }}
                    >
                      <div style={{
                        width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                        background: 'rgba(139,92,246,0.15)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon name="meeting_room" size={22} color="#A78BFA" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--on-surface)' }}>{space.name}</p>
                        <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{SPACE_TYPE_LABELS[space.type] ?? space.type}</p>
                      </div>
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <p style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: 0, color: '#A78BFA' }}>
                          {parseFloat(space.hourlyRate).toLocaleString('ru')} ₽
                        </p>
                        <p style={{ fontSize: 10, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>/ час</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <CloseShiftModal open={showCloseShift} onClose={() => setShowCloseShift(false)} />

      {/* Birthdays popup */}
      {showBirthdays && birthdaysData?.birthdays && birthdaysData.birthdays.length > 0 && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setShowBirthdays(false) }}
        >
          <div className="glass-l1" style={{ borderRadius: 28, padding: '36px 32px', maxWidth: 380, width: '100%', textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎂</div>
            <h2 style={{ fontSize: 20, fontWeight: 900, textTransform: 'uppercase', marginBottom: 8, color: 'var(--on-surface)' }}>
              ИМЕНИННИКИ СЕГОДНЯ
            </h2>
            <p style={{ color: 'var(--on-surface-variant)', fontSize: 13, marginBottom: 24 }}>
              Не забудьте поздравить!
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
              {birthdaysData.birthdays.map(person => (
                <div key={person.id} className="glass-l2" style={{ padding: '10px 14px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', overflow: 'hidden', background: 'rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#A78BFA', flexShrink: 0 }}>
                    {person.photoUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={person.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : getInitials(person.nickname)}
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--on-surface)' }}>{person.nickname}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowBirthdays(false)}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 14, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
                color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
              }}
            >
              Понятно
            </button>
          </div>
        </div>
      )}
      </div>{/* /pos-left-panel */}

      {/* Ручка регулировки сплита (видна только при открытой правой панели, ≥1024) */}
      {activeCheckId && (
        <div
          className="pos-split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину панели чека"
          onPointerDown={startSplitDrag}
        >
          <div className="pos-split-grip" />
        </div>
      )}

      {/* Right panel — detail view на десктопе */}
      {activeCheckId && (
        <div
          className={`pos-right-panel${rightClosing ? ' closing' : ''}`}
          style={{
            width: 0,
            flexShrink: 0,
            overflow: 'hidden',
            borderLeft: '1px solid rgba(255,255,255,0.07)',
            position: 'relative',
          }}
        >
          <CheckDetailView
            key={activeCheckId}
            checkId={activeCheckId}
            onBack={closeRightPanel}
            onClose={closeRightPanel}
          />
        </div>
      )}

      <style>{`
        .pos-split-handle { display: none; }
        @keyframes split-panel-in {
          from { opacity: 0; transform: translateX(28px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes split-panel-out {
          from { opacity: 1; transform: none; }
          to   { opacity: 0; transform: translateX(36px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pos-right-panel, .pos-right-panel.closing { animation: none !important; }
        }
        @media (min-width: 1024px) {
          .pos-right-panel {
            width: var(--pos-right-w, 680px) !important;
            animation: split-panel-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
          }
          .pos-right-panel.closing {
            animation: split-panel-out 200ms cubic-bezier(0.4, 0, 1, 1) both !important;
          }
          .pos-split-handle {
            display: flex; align-items: center; justify-content: center;
            width: 16px; margin: 0 -6px; flex-shrink: 0; z-index: 5;
            cursor: col-resize; touch-action: none; user-select: none;
            -webkit-tap-highlight-color: transparent;
          }
          .pos-split-grip {
            width: 4px; height: 48px; border-radius: 4px;
            background: rgba(255,255,255,0.14); transition: background 0.15s;
          }
          .pos-split-handle:hover .pos-split-grip,
          .pos-split-handle:active .pos-split-grip { background: rgba(139,92,246,0.65); }
        }
      `}</style>
    </div>
  )
}

export default function PosPage() {
  return (
    <Suspense fallback={null}>
      <PosPageInner />
    </Suspense>
  )
}

const fmtRub = (n: number) => `${Math.round(n || 0).toLocaleString('ru')} ₽`

/* ─── Masonry-раскладка со смещением правой колонки (стиль Apple «Воспоминания») ─
   Карточки раздаются по колонкам по кругу (i % cols), нечётные колонки сдвинуты
   вниз на offset — отсюда «шахматный» ритм. Высота колонок — по контенту. */
function MasonryColumns({ cols, items, gap = 12, offset = 34 }: { cols: number; items: React.ReactNode[]; gap?: number; offset?: number }) {
  const n = Math.max(1, cols)
  const columns: React.ReactNode[][] = Array.from({ length: n }, () => [])
  items.forEach((node, i) => { columns[i % n].push(node) })
  return (
    <div style={{ display: 'flex', gap, alignItems: 'flex-start' }}>
      {columns.map((col, ci) => (
        <div key={ci} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap, marginTop: n > 1 && ci % 2 === 1 ? offset : 0 }}>
          {col}
        </div>
      ))}
    </div>
  )
}

/* ─── Карточка смены в кассе ──────────────────────────────────────────────── */
function ShiftCard({ shift, summary, onOpen, onCloseShift, onDetail }: {
  shift: any
  summary?: ShiftSummary
  onOpen: () => void
  onCloseShift: () => void
  onDetail: () => void
}) {
  // Карточка-ячейка как чеки (ширину/зазор задаёт .pos-cards-grid > *).
  const base: React.CSSProperties = { borderRadius: 16, padding: 14, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', WebkitTapHighlightColor: 'transparent' }

  // 1) Смена закрыта → «Открыть смену».
  if (!shift) {
    return (
      <button onClick={onOpen} style={{
        ...base, color: '#fff', minHeight: 124, justifyContent: 'space-between', gap: 12,
        background: 'linear-gradient(150deg, rgba(139,92,246,0.92), rgba(76,215,246,0.8))',
        border: '1px solid rgba(255,255,255,0.2)', boxShadow: '0 6px 22px rgba(139,92,246,0.3)',
      }}>
        <div style={{ width: 46, height: 46, borderRadius: 14, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="schedule" size={26} color="#fff" />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>Открыть смену</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, opacity: 0.85 }}>Начать рабочий день</p>
        </div>
      </button>
    )
  }

  // Пока сводка грузится.
  if (!summary) {
    return (
      <div className="glass-l2" style={{ ...base, cursor: 'default', minHeight: 100, alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px solid rgba(255,255,255,0.08)' }}>
        <TaiLogo size={22} thinking float={false} />
        <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>Смена · сводка…</span>
      </div>
    )
  }

  const hasChecks = summary.openChecks.count > 0

  // 3) Смена открыта, чеков нет → «Закрыть смену» + касса.
  if (!hasChecks) {
    return (
      <button onClick={onCloseShift} style={{
        ...base, color: 'var(--on-surface)', minHeight: 124, justifyContent: 'space-between', gap: 10,
        background: 'rgba(244,63,94,0.07)', border: '1px solid rgba(244,63,94,0.28)',
      }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: 'rgba(244,63,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="logout" size={22} color="#F43F5E" />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Закрыть смену</p>
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--on-surface-variant)' }}>Открытых чеков нет</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 9 }}>
          <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>В кассе</span>
          <span style={{ fontSize: 16, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtRub(summary.cashInRegister)}</span>
        </div>
      </button>
    )
  }

  // 2) Смена открыта, есть чеки → ИИ-карточка со сводкой (3 цифры), тап → детали.
  return (
    <button onClick={onDetail} className="glass-l2" style={{
      ...base, gap: 9, border: '1px solid rgba(139,92,246,0.35)',
      background: 'linear-gradient(160deg, rgba(139,92,246,0.13), rgba(76,215,246,0.05))',
    }}>
      {/* Бегущая ИИ-полоса сверху — «инновационный» акцент */}
      <div aria-hidden style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg,#8B5CF6,#4cd7f6,#A07DFF,#8B5CF6)', backgroundSize: '300% 100%', animation: 'tai-shift-bar 4s linear infinite' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <TaiLogo size={22} thinking float={false} />
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--on-surface)' }}>Смена</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, color: 'var(--on-surface-variant)' }}>Подробнее<Icon name="chevron_right" size={13} color="var(--on-surface-variant)" /></span>
      </div>
      <ShiftMiniStat label={`Открыто · ${summary.openChecks.count}`} value={fmtRub(summary.openChecks.total)} />
      {/* Прогноз вечера (Tai) — только при подписке. Подпись не влезает на телефоне:
          вместо неё бегущая ИИ-искра по строке (не доходит до суммы); пояснение — в шторке. */}
      {summary.forecast && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Прогноз вечера от Tai">
          <div style={{ position: 'relative', flex: 1, height: 18, minWidth: 0, overflow: 'hidden' }}>
            <span style={{ position: 'absolute', top: '50%', marginTop: -8, animation: 'tai-run 2.6s ease-in-out infinite' }}>
              <TaiLogo size={16} thinking float={false} />
            </span>
          </div>
          <span style={{ flexShrink: 0, fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#A78BFA' }}>{fmtRub(summary.forecast.amount)}</span>
        </div>
      )}
      <ShiftMiniStat label="В кассе" value={fmtRub(summary.cashInRegister)} />
      <style>{`@keyframes tai-shift-bar{0%{background-position:0% 0}100%{background-position:300% 0}}@keyframes tai-run{0%{left:0}50%{left:calc(100% - 16px)}100%{left:0}}`}</style>
    </button>
  )
}

function ShiftMiniStat({ label, value, accent, tai }: { label: string; value: string; accent?: boolean; tai?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, fontSize: 11, fontWeight: accent ? 700 : 500, color: accent ? '#A78BFA' : 'var(--on-surface-variant)' }}>
        {tai && <TaiLogo size={13} float={false} />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      </span>
      <span style={{ flexShrink: 0, fontSize: accent ? 17 : 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: accent ? '#A78BFA' : 'var(--on-surface)' }}>{value}</span>
    </div>
  )
}

/* ─── Детализация сводки смены ────────────────────────────────────────────── */
function ShiftDetailSheet({ open, onClose, summary }: { open: boolean; onClose: () => void; summary?: ShiftSummary }) {
  if (!open || !summary) return null
  const perCheck = summary.forecast ? [...summary.forecast.perCheck].sort((a, b) => b.projected - a.projected) : []
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(13,21,38,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="glass-l1" style={{ borderRadius: 28, maxWidth: 480, width: '100%', maxHeight: '90dvh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', padding: '22px 22px calc(22px + var(--bottom-nav-clear, 0px))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Сводка смены</h3>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-variant)' }}><Icon name="close" size={18} /></button>
        </div>

        {/* Три цифры с пояснениями */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
          <DetailRow icon="receipt_long" color="#4cd7f6" title="Открыто чеков" hint={`${summary.openChecks.count} активных · уже набрано`} value={fmtRub(summary.openChecks.total)} />
          {summary.forecast && (
            <DetailRow icon="auto_awesome" color="#A78BFA" tai title="Прогноз вечера" hint="Сколько ожидается к закрытию смены" value={fmtRub(summary.forecast.amount)} accent
              extra={summary.forecast.additional > 0 ? `+${fmtRub(summary.forecast.additional)} к текущему` : undefined} />
          )}
          <DetailRow icon="account_balance_wallet" color="#10B981" title="В кассе сейчас" hint="Наличные с начала смены (касса)" value={fmtRub(summary.cashInRegister)} />
        </div>

        {summary.forecast && (<>
        {/* Пояснение прогноза — упор на ИИ */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 12, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', marginBottom: 16 }}>
          <TaiLogo size={24} thinking float={false} />
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--on-surface)', lineHeight: 1.45 }}>
            <b style={{ color: '#A78BFA' }}>Tai</b> читает зал и предсказывает выручку вечера — по тысячам прошлых чеков, привычкам гостей и дню недели.
          </p>
        </div>

        {/* Разбивка по чекам */}
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', margin: '0 0 8px' }}>По чекам</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {perCheck.map(p => {
            const uplift = p.projected - p.current
            return (
              <div key={p.checkId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--on-surface-variant)' }}>
                    {p.avgSpend != null
                      ? <>обычно {fmtRub(p.avgSpend)} · {p.samples} {p.samples === 1 ? 'чек' : p.samples < 5 ? 'чека' : 'чеков'}{p.weekdayBased ? ' (этот день)' : ''}</>
                      : 'без истории — по текущей сумме'}
                  </p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: uplift > 0 ? '#A78BFA' : 'var(--on-surface)', fontVariantNumeric: 'tabular-nums' }}>{fmtRub(p.projected)}</p>
                  {uplift > 0 && <p style={{ margin: '1px 0 0', fontSize: 10, color: 'var(--on-surface-variant)' }}>сейчас {fmtRub(p.current)}</p>}
                </div>
              </div>
            )
          })}
        </div>
        </>)}
      </div>
    </div>
  )
}

function DetailRow({ icon, color, title, hint, value, accent, tai, extra }: { icon: string; color: string; title: string; hint: string; value: string; accent?: boolean; tai?: boolean; extra?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
        <Icon name={icon} size={20} color={color} />
        {tai && <span style={{ position: 'absolute', bottom: -3, right: -3 }}><TaiLogo size={16} float={false} /></span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{title}</p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--on-surface-variant)' }}>{hint}</p>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: accent ? '#A78BFA' : 'var(--on-surface)' }}>{value}</p>
        {extra && <p style={{ margin: '1px 0 0', fontSize: 10, color: '#A78BFA' }}>{extra}</p>}
      </div>
    </div>
  )
}
