'use client'
import type React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/api'
import { funnyGuestName } from '@/lib/funnyName'
import { SwipeableRow } from '@/components/SwipeableRow'
import { Icon } from '@/components/Icon'
import { TaiLogo } from '@/components/TaiLogo'
import { TaiButton } from '@/components/tai/TaiPanel'
import { useToast } from '@/components/Toast'
import { ConfirmDialog } from '@/components/manage/DesignSystem'
import { TimeInput24 } from '@/components/TimeInput24'
import { CheckChat, type ChatMessage } from '@/components/CheckChat'
import { useNotifications } from '@/components/NotificationsProvider'
import { CategoryIcon } from '@/components/CategoryIcon'

// Цвет категории: hex или legacy-имя → { hex, light, border, text }. Совпадает с
// логикой управления меню/планшета, чтобы POS-меню выглядело так же (цвета+иконки).
const LEGACY_CAT_COLORS: Record<string, string> = {
  violet: '#8B5CF6', slate: '#94A3B8', orange: '#F97316', emerald: '#10B981',
  rose: '#F43F5E', amber: '#F59E0B', blue: '#3B82F6', indigo: '#6366F1',
  pink: '#EC4899', cyan: '#06B6D4',
}
function catHex(v?: string | null): string {
  if (!v) return '#8B5CF6'
  return LEGACY_CAT_COLORS[v] || (v.startsWith('#') ? v : '#8B5CF6')
}
function catColor(v?: string | null) {
  const hex = catHex(v)
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return { hex, light: `rgba(${r},${g},${b},0.13)`, border: `rgba(${r},${g},${b},0.3)`, text: hex }
}

interface InventoryItem {
  id: string
  name: string
  price: string
  category: string | null
  isActive: boolean
  stockQuantity: number
  trackStock: boolean
}

interface MenuCategory {
  id: string
  name: string
  icon: string
  color: string
}

interface CheckItem {
  checkItem: { id: string; quantity: number; priceAtTime: string }
  item: InventoryItem | null
}

interface CheckData {
  id: string
  totalAmount: string
  status: string
  items: CheckItem[]
  payments: { id: string; method: string; amount: string }[]
  guestName?: string
  guestNames?: string[] | null
  playerId?: string | null
  staffCompId?: string | null
  spaceId?: string | null
  spaceStartAt?: string | null
  spaceEndAt?: string | null
  spaceHourlyRate?: string | null
  eventBaseAmount?: string | null
  prepaidAmount?: string | null
  linkedEventId?: string | null
  discounts?: { id: string; name: string; type: string; value: string; amount: string; discountId: string | null }[]
  excludedDiscounts?: { id: string; name: string; type: string; value: string }[]
  pendingOrders?: PendingOrder[]
}

interface PendingOrder {
  id: string
  status: string
  items: { itemId: string; name: string; quantity: number; price: string }[]
  createdAt: string
}

interface PlayerProfile {
  id: string
  nickname: string
  clientTier: string
  balance: string
  bonusPoints: string
  photoUrl: string | null
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

// Привязанное мероприятие чека (GET /events/{id}). billingMode: 'amount' = Фикс,
// 'hourly' = Почасовая. eventBaseAmount живёт на чеке, не здесь.
interface LinkedEvent {
  id: string
  title?: string
  billingMode: 'amount' | 'hourly'
  plannedHours: number | null
  fixedAmount: string | null
}

// Почасовой тариф мероприятия (GET /pricing/event-rates), hours 1..6.
interface EventRate {
  hours: number
  price: string
}

interface CertificateInfo {
  id: string
  code: string
  nominal: string
  balance: string
  isUsed: boolean
}

interface SplitPart {
  method: string
  amount: number
  label?: string
}

type PayScreen = 'methods' | 'bonus' | 'deposit' | 'certificate' | 'split' | 'qr' | 'sbp_surcharge'

const METHOD_CONFIGS: Record<string, { label: string; icon: string; color: string; rgb: string }> = {
  cash: { label: 'Наличные', icon: 'payments', color: 'var(--pay-cash)', rgb: '16,185,129' },
  // «Перевод» = перевод на карту (DB enum остаётся card).
  card: { label: 'Перевод', icon: 'credit_card', color: 'var(--pay-card)', rgb: '59,130,246' },
  // «СБП» = Platega QR (DB enum остаётся transfer).
  transfer: { label: 'СБП', icon: 'qr_code_2', color: 'var(--pay-split)', rgb: '139,92,246' },
  bonus: { label: 'Бонусы', icon: 'stars', color: 'var(--pay-bonus)', rgb: '245,158,11' },
  deposit: { label: 'Депозит', icon: 'account_balance_wallet', color: 'var(--pay-deposit)', rgb: '6,182,212' },
  debt: { label: 'В долг', icon: 'person_pin', color: 'var(--pay-debt, #f43f5e)', rgb: '244,63,94' },
  split: { label: 'Раздельная', icon: 'call_split', color: 'var(--on-surface-variant)', rgb: '148,163,184' },
}

// Сертификат больше не в сетке методов (вход — кнопка на event-чеке), но
// метку/иконку/цвет всё ещё нужно отрисовывать в списке сплит-частей.
const CERT_CONFIG = { label: 'Сертификат', icon: 'card_membership', color: 'var(--pay-cert)', rgb: '251,191,36' }

// Методы, доступные как ручной tender внутри «Раздельной» (без QR-СБП).
const SPLIT_MANUAL_METHODS = ['cash', 'card', 'deposit', 'debt', 'bonus'] as const

// Тарифный шаг при привязке плательщика — как при открытии нового чека на кассе.
// Маппинг тира клиента → название тарифа в меню (для предвыбора).
const TIER_TO_TARIFF_NAME: Record<string, string> = { guest: 'Гость', resident: 'Резидент', student: 'Студент' }
const TIER_LABELS: Record<string, string> = { guest: 'Гость', resident: 'Резидент', student: 'Студент' }
const TARIFF_PALETTE = [
  { color: '#8B5CF6', bg: 'rgba(139,92,246,0.15)', selBg: 'rgba(139,92,246,0.22)', selBorder: 'rgba(139,92,246,0.65)' },
  { color: '#10B981', bg: 'rgba(16,185,129,0.15)', selBg: 'rgba(16,185,129,0.22)', selBorder: 'rgba(16,185,129,0.65)' },
  { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', selBg: 'rgba(245,158,11,0.22)', selBorder: 'rgba(245,158,11,0.65)' },
  { color: '#3B82F6', bg: 'rgba(59,130,246,0.15)', selBg: 'rgba(59,130,246,0.22)', selBorder: 'rgba(59,130,246,0.65)' },
  { color: '#F43F5E', bg: 'rgba(244,63,94,0.15)', selBg: 'rgba(244,63,94,0.22)', selBorder: 'rgba(244,63,94,0.65)' },
  { color: '#4cd7f6', bg: 'rgba(76,215,246,0.15)', selBg: 'rgba(76,215,246,0.22)', selBorder: 'rgba(76,215,246,0.65)' },
]

function getInitials(name?: string | null): string {
  if (!name) return 'Г'
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

// ISO → значение для <input type="datetime-local"> (локальное время, без TZ-суффикса)
function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function methodColor(m: string): string {
  if (m === 'certificate') return CERT_CONFIG.color
  return METHOD_CONFIGS[m]?.color ?? 'var(--on-surface-variant)'
}

function methodLabel(m: string): string {
  if (m === 'certificate') return CERT_CONFIG.label
  return METHOD_CONFIGS[m]?.label ?? m
}

function methodIcon(m: string): string {
  if (m === 'certificate') return CERT_CONFIG.icon
  return METHOD_CONFIGS[m]?.icon ?? 'payments'
}

interface CheckDetailViewProps {
  checkId: string
  onBack: () => void
  onClose?: () => void // для split-view — очистить активный чек
}

export function CheckDetailView({ checkId, onBack, onClose }: CheckDetailViewProps) {
  const qc = useQueryClient()
  const { show } = useToast()
  const toastError = useCallback(
    (e: unknown) => show(e instanceof ApiError ? String((e.data as Record<string, unknown>)?.error ?? 'Ошибка') : 'Ошибка сети', 'error'),
    [show],
  )
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatSeenAt, setChatSeenAt] = useState(0)

  const { data: checkData, isLoading } = useQuery({
    queryKey: ['check', checkId],
    queryFn: () => api.get<{ check: CheckData }>(`/pos/checks/${checkId}`).then(r => r.check),
    refetchInterval: 10000,
  })

  const { data: categoriesData } = useQuery({
    queryKey: ['menu', 'categories'],
    queryFn: () => api.get<{ categories: MenuCategory[] }>('/menu/categories'),
  })

  const { data: itemsData } = useQuery({
    queryKey: ['menu', 'items'],
    queryFn: () => api.get<{ items: InventoryItem[] }>('/menu/items'),
  })

  // Тарифы — из стандартизированного справочника /tariffs (активные). itemId
  // каждого тарифа добавляется позицией в чек при выборе (через addItem).
  const { data: tariffsData } = useQuery({
    queryKey: ['pricing', 'tariffs'],
    queryFn: () => api.get<{ tariffs: TariffOption[] } | TariffOption[]>('/pricing/tariffs'),
  })

  // Настройки: процент макс. оплаты бонусами (bonus_max_spend). Бэкенд /pay
  // enforce-ит этот же лимит; здесь — только для корректного UI слайдера.
  const { data: settingsData } = useQuery({
    queryKey: ['app-settings'],
    queryFn: () => api.get<{ settings: Record<string, string> }>('/system/settings'),
  })
  const bonusMaxSpendPct = (() => {
    const parsed = parseFloat(settingsData?.settings?.['bonus_max_spend'] ?? '')
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 50
  })()

  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showMenuDrawer, setShowMenuDrawer] = useState(false)
  const [showPayment, setShowPayment] = useState(false)
  const [isPaid, setIsPaid] = useState(false)

  // ─── Выезжающая панель меню: тянется за пальцем, поднимается над клавиатурой,
  //     свайпом вниз закрывается полностью (как нижние шторки в приложении). ──────
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const curHRef = useRef(0)
  const [sheetH, setSheetH] = useState(0)     // высота панели, px
  const [kbInset, setKbInset] = useState(0)   // высота, перекрытая клавиатурой, px
  const [sheetDragging, setSheetDragging] = useState(false)
  const MID_FRAC = 0.7, TOP_GAP = 8
  const vpMetrics = () => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const innerH = typeof window !== 'undefined' ? window.innerHeight : 800
    const visH = vv ? vv.height : innerH
    const inset = vv ? Math.max(0, innerH - vv.height - vv.offsetTop) : 0
    return { innerH, visH, inset }
  }
  // При открытии — высота по умолчанию (70% видимой области).
  useEffect(() => {
    if (!showMenuDrawer) { setKbInset(0); return }
    const { visH } = vpMetrics()
    const h = Math.round(visH * MID_FRAC)
    curHRef.current = h; setSheetH(h)
  }, [showMenuDrawer])
  // Клавиатура: следим за visualViewport — поднимаем панель над клавиатурой
  // (bottom = inset) и не даём вылезти за верх экрана.
  useEffect(() => {
    if (!showMenuDrawer || typeof window === 'undefined') return
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const { visH, inset } = vpMetrics()
      setKbInset(inset)
      const maxH = visH - TOP_GAP
      if (curHRef.current > maxH) { curHRef.current = maxH; setSheetH(maxH) }
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    onResize()
    return () => { vv.removeEventListener('resize', onResize); vv.removeEventListener('scroll', onResize) }
  }, [showMenuDrawer])
  const onSheetDragStart = (e: React.TouchEvent) => {
    dragRef.current = { startY: e.touches[0].clientY, startH: curHRef.current }
    setSheetDragging(true)
  }
  const onSheetDragMove = (e: React.TouchEvent) => {
    if (!dragRef.current) return
    const { visH } = vpMetrics()
    const dy = dragRef.current.startY - e.touches[0].clientY   // палец вверх = рост
    const h = Math.min(visH - TOP_GAP, Math.max(60, dragRef.current.startH + dy))
    curHRef.current = h; setSheetH(h)
  }
  const onSheetDragEnd = () => {
    if (!dragRef.current) return
    dragRef.current = null
    setSheetDragging(false)
    const { visH } = vpMetrics()
    const h = curHRef.current
    if (h < visH * 0.38) { setShowMenuDrawer(false); return }  // свайп вниз → закрыть
    const target = h > visH * 0.82 ? visH - TOP_GAP : Math.round(visH * MID_FRAC)
    curHRef.current = target; setSheetH(target)
  }
  // Фокус в поиске → панель почти до верха, чтобы клавиатура не перекрывала позиции.
  const expandSheetFull = () => {
    const { visH } = vpMetrics()
    const target = visH - TOP_GAP
    curHRef.current = target; setSheetH(target)
  }

  // Space rental live timer
  const [spaceRental, setSpaceRental] = useState(0)
  // Редактор времени аренды
  const [showRentalEdit, setShowRentalEdit] = useState(false)
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  // Ручная скидка на чек
  const [showDiscount, setShowDiscount] = useState(false)
  const [discType, setDiscType] = useState<'percent' | 'fixed'>('percent')
  const [discValue, setDiscValue] = useState('')

  // Payment drawer state
  const [payScreen, setPayScreen] = useState<PayScreen>('methods')
  const [splitParts, setSplitParts] = useState<SplitPart[]>([])
  const [bonusAmount, setBonusAmount] = useState(0)
  const [depositAmt, setDepositAmt] = useState(0)
  const [certCode, setCertCode] = useState('')
  const [certInfo, setCertInfo] = useState<CertificateInfo | null>(null)
  const [certError, setCertError] = useState('')
  const [certLoading, setCertLoading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // QR / Platega state
  const [qrTransactionId, setQrTransactionId] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrStatus, setQrStatus] = useState<'pending' | 'confirmed' | 'canceled'>('pending')
  const [qrError, setQrError] = useState('')
  const [qrRedirectUrl, setQrRedirectUrl] = useState<string | null>(null)
  const [qrAmount, setQrAmount] = useState(0)
  const [qrSurcharge8, setQrSurcharge8] = useState(false)
  const [qrBaseAmount, setQrBaseAmount] = useState(0)

  // Split-композитор: выбранный метод и сумма для следующего добавляемого tender'а.
  const [splitMethod, setSplitMethod] = useState<string>('cash')
  const [splitAmtInput, setSplitAmtInput] = useState('')

  // Клиенты в чеке: плательщик (playerId) + доп. люди (guestNames). Шторка добавления.
  const [showClient, setShowClient] = useState(false)
  const [clientQuery, setClientQuery] = useState('')
  const [clientResults, setClientResults] = useState<{ id: string; nickname: string; clientTier: string; photoUrl?: string | null }[]>([])
  const [clientSearching, setClientSearching] = useState(false)
  const [guestNameInput, setGuestNameInput] = useState('')
  const clientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Тарифный шаг (как на кассе): после выбора плательщика предлагаем выбрать тариф.
  const [tariffStep, setTariffStep] = useState(false)
  // asGuest=true → добавляем доп. участника (имя в guestNames на подтверждении).
  const [pendingPlayer, setPendingPlayer] = useState<{ id?: string; nickname: string; clientTier: string; asGuest?: boolean; photoUrl?: string | null } | null>(null)
  const [selectedTariffId, setSelectedTariffId] = useState<string | null>(null)

  const check = checkData
  // Имя в заголовке: реальное имя клиента/гостя, иначе смешная заглушка (по id чека).
  const displayName = check ? (check.guestName || funnyGuestName(check.id)) : 'Гость'

  // Открытие чека гасит «пульс» карточки: помечаем прочитанными обращения гостя
  // (чат / вызов / заказ / запрос счёта) по этому чеку и пространству.
  const { markReadByCheck } = useNotifications()
  const checkSpaceId = check?.spaceId ?? undefined
  useEffect(() => {
    markReadByCheck({ checkId, spaceId: checkSpaceId ?? undefined, types: ['staff_call', 'request_bill', 'client_order', 'chat_message'] })
  }, [checkId, checkSpaceId, markReadByCheck])
  const categories = categoriesData?.categories ?? []
  const catById = new Map(categories.map((cc) => [cc.id, cc]))
  // Тарифные категории (название содержит «тариф») всегда в самом конце —
  // и во вкладках, и в сгруппированном виде «Все». Остальной порядок наследуется
  // из меню (sortOrder, уже применён сервером).
  const isTariffCat = (cc: any) => String(cc?.name ?? '').toLowerCase().includes('тариф')
  const nonTariffCats = categories.filter((cc) => !isTariffCat(cc))
  const tariffCats = categories.filter((cc) => isTariffCat(cc))
  const orderedCats = [...nonTariffCats, ...tariffCats]
  // Сколько каждой позиции уже в чеке — для бейджа «×N» на карточке меню.
  const qtyInCheck = new Map<string, number>()
  for (const ci of (check?.items ?? [])) {
    const id = ci.item?.id
    if (id) qtyInCheck.set(id, (qtyInCheck.get(id) ?? 0) + ci.checkItem.quantity)
  }
  const allItems = (itemsData?.items ?? []).filter(i => i.isActive)
  // Тарифы — из стандартизированного справочника /tariffs (активные).
  const allTariffs: TariffOption[] = Array.isArray(tariffsData) ? tariffsData : (tariffsData?.tariffs ?? [])
  const tariffItems = allTariffs.filter(t => t.isActive !== false)
  const filteredItems = allItems.filter(item => {
    const matchCat = !activeCat || item.category === activeCat
    const q = search.toLowerCase()
    const matchSearch = !search
      || item.name.toLowerCase().includes(q)
      || ((item as { searchTags?: string[] }).searchTags ?? []).some(t => t.toLowerCase().includes(q))
    return matchCat && matchSearch
  })
  // Карточка товара в меню кассы (общая для плоского и сгруппированного видов).
  const renderItemCard = (item: any) => {
    const cat = item.category ? catById.get(item.category) : undefined
    const cc = catColor(cat?.color)
    const qty = qtyInCheck.get(item.id) ?? 0
    const out = item.trackStock && item.stockQuantity <= 0
    return (
      <button
        key={item.id}
        onClick={() => { addItem.mutate(item.id) }}
        className="glass-l2"
        style={{ position: 'relative', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 108, borderRadius: 14, padding: '12px', border: `1px solid ${qty > 0 ? cc.hex : cc.border}`, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', background: qty > 0 ? cc.light : 'rgba(255,255,255,0.04)' }}
        onMouseEnter={e => { e.currentTarget.style.background = cc.light; e.currentTarget.style.borderColor = cc.hex }}
        onMouseLeave={e => { e.currentTarget.style.background = qty > 0 ? cc.light : 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = qty > 0 ? cc.hex : cc.border }}
      >
        {qty > 0 && (
          <span style={{ position: 'absolute', top: 8, right: 8, minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: cc.hex, color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{qty}</span>
        )}
        <div style={{ width: 30, height: 30, borderRadius: 9, background: cc.light, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <CategoryIcon icon={cat?.icon ?? 'restaurant_menu'} size={17} color={cc.hex} />
        </div>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word' }}>{item.name}</span>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 800, color: cc.text, fontVariantNumeric: 'tabular-nums' }}>{parseFloat(item.price).toLocaleString('ru')} ₽</span>
          {item.trackStock && <span style={{ fontSize: 10, fontWeight: out ? 700 : 500, color: out ? '#f43f5e' : item.stockQuantity <= 3 ? '#F59E0B' : 'var(--on-surface-variant)', whiteSpace: 'nowrap' }}>{out ? 'нет' : `×${item.stockQuantity}`}</span>}
        </div>
      </button>
    )
  }
  // Сгруппированный вид «Все»: секции по категориям в порядке меню, тарифы — в конце,
  // «Прочее» (без категории) — перед тарифами.
  const groupedSections = (() => {
    if (search || activeCat) return null
    const sections: { key: string; cat?: any; items: any[] }[] = []
    for (const cat of nonTariffCats) {
      const items = allItems.filter(i => i.category === cat.id)
      if (items.length) sections.push({ key: cat.id, cat, items })
    }
    const uncategorized = allItems.filter(i => !i.category || !catById.has(i.category))
    if (uncategorized.length) sections.push({ key: '__uncat__', items: uncategorized })
    for (const cat of tariffCats) {
      const items = allItems.filter(i => i.category === cat.id)
      if (items.length) sections.push({ key: cat.id, cat, items })
    }
    return sections
  })()

  // Space rental calc — та же epoch-логика, что и на бэкенде при оплате:
  // ceil(минуты/60) × ставка. До spaceEndAt (если задан) либо до now (живой счётчик).
  useEffect(() => {
    // Нет аренды у этого чека — обнуляем счётчик (иначе значение «прилипло» бы
    // от предыдущего чека и попало в «Итого»).
    if (!check?.spaceId || !check?.spaceStartAt || !check?.spaceHourlyRate) { setSpaceRental(0); return }
    const startMs = new Date(check.spaceStartAt).getTime()
    const rate = parseFloat(check.spaceHourlyRate ?? '0')
    const calc = () => {
      const endMs = check.spaceEndAt ? new Date(check.spaceEndAt).getTime() : Date.now()
      // Целые минуты — как бэкенд (lib/money.ts).
      const mins = Math.floor(Math.max(0, endMs - startMs) / 60000)
      setSpaceRental(Math.ceil(mins / 60) * rate)
    }
    calc()
    if (check.spaceEndAt) return // фиксированный конец — счётчик не тикает
    const t = setInterval(calc, 15000)
    return () => clearInterval(t)
  }, [check])

  const baseTotal = parseFloat(check?.totalAmount ?? '0')
  // База мероприятия (фикс/ручная сумма события) — отдельное слагаемое итога,
  // как и аренда. Сервер так же считает grandTotal в /pay (computeCheckGrandTotal).
  const eventBase = parseFloat(check?.eventBaseAmount ?? '0') || 0
  const total = baseTotal + spaceRental + eventBase
  // Предоплаченная часть (взнос участия миникапа): пробивается полный total, но в
  // этой сессии собираем только остаток `due`. Предоплата уйдёт в кассу при закрытии.
  const prepaidAmount = Math.min(parseFloat(check?.prepaidAmount ?? '0') || 0, total)
  const due = Math.max(0, total - prepaidAmount)
  const splitSum = splitParts.reduce((s, p) => s + p.amount, 0)
  const remaining = Math.max(0, due - splitSum)

  // Чек редактируем (можно менять позиции/мероприятие), пока он открыт.
  const isEditable = check?.status === 'open'

  // Привязанное мероприятие: для inline-редактирования планового времени / фикс-суммы.
  const linkedEventId = check?.linkedEventId ?? null
  const { data: eventData } = useQuery({
    queryKey: ['event', linkedEventId],
    queryFn: () => api.get<{ event: LinkedEvent }>(`/events/${linkedEventId}`).then(r => r.event),
    enabled: !!linkedEventId,
  })
  const linkedEvent = eventData ?? null
  // Почасовые тарифы мероприятия (1..6 ч) — для сетки кнопок.
  const { data: eventRatesData } = useQuery({
    queryKey: ['pricing', 'event-rates'],
    queryFn: () => api.get<{ rates: EventRate[] }>('/pricing/event-rates'),
    enabled: !!linkedEventId,
  })
  const eventRates = eventRatesData?.rates ?? []
  // Локальное состояние редактора фикс-суммы (Фикс-мероприятие).
  const [editEventAmount, setEditEventAmount] = useState(false)
  const [eventAmountInput, setEventAmountInput] = useState('')

  const { data: playerData } = useQuery({
    queryKey: ['player', check?.playerId],
    queryFn: () => api.get<{ player: PlayerProfile }>(`/pos/players/${check!.playerId}`).then(r => r.player),
    // Грузим всегда при наличии плательщика (а не только на оплате) — нужно для
    // аватара в шапке открытого чека.
    enabled: !!check?.playerId,
  })
  const player = playerData ?? null

  const playerBalance = parseFloat(player?.balance ?? '0') || 0
  // Депозит и долг — две стороны одного баланса: плюс = предоплаченный депозит,
  // минус = долг. В оплате их РАЗДЕЛЯЕМ: депозитом можно платить только из
  // положительной части; при долге доступный депозит = 0 (нельзя «платить долгом»).
  const availableDeposit = Math.max(0, playerBalance)
  const playerDebt = Math.max(0, -playerBalance)
  const playerBonus = parseFloat(player?.bonusPoints ?? '0') || 0

  function openPaymentDrawer() {
    setSplitParts([])
    setBonusAmount(0)
    setDepositAmt(0)
    setCertCode('')
    setCertInfo(null)
    setCertError('')
    setPayScreen('methods')
    setIsProcessing(false)
    setQrTransactionId(null)
    setQrDataUrl(null)
    setQrStatus('pending')
    setQrError('')
    setQrSurcharge8(false)
    setQrBaseAmount(0)
    setSplitMethod('cash')
    setSplitAmtInput('')
    setShowPayment(true)
  }

  function openRentalEdit() {
    setEditStart(toLocalInput(check?.spaceStartAt))
    setEditEnd(toLocalInput(check?.spaceEndAt))
    setShowRentalEdit(true)
  }
  function saveRental() {
    const body: { spaceStartAt?: string; spaceEndAt?: string | null } = {}
    if (editStart) body.spaceStartAt = new Date(editStart).toISOString()
    // Пустой конец → null (снова живой счётчик до оплаты)
    body.spaceEndAt = editEnd ? new Date(editEnd).toISOString() : null
    updateRental.mutate(body)
  }

  async function startQrPayment(surcharge8: boolean) {
    const amount = remaining > 0 ? remaining : total
    setQrSurcharge8(surcharge8)
    setQrBaseAmount(amount)
    // Предварительная сумма (с комиссией) до ответа сервера — сервер вернёт точное chargedAmount.
    setQrAmount(surcharge8 ? Math.round(amount * 1.08) : amount)
    setQrLoading(true)
    setQrError('')
    setQrRedirectUrl(null)
    setQrStatus('pending')
    setQrTransactionId(null)
    setQrDataUrl(null)
    setPayScreen('qr')
    try {
      const res = await api.post<{ transactionId: string; qrDataUrl: string; chargedAmount?: number; baseAmount?: number; surcharge8?: boolean; expiresIn?: string }>(
        `/pos/checks/${checkId}/qr`,
        { amount, surcharge8 }
      )
      setQrTransactionId(res.transactionId)
      setQrDataUrl(res.qrDataUrl)
      // Сервер — источник истины по суммам (chargedAmount = к оплате incl. комиссия).
      if (typeof res.chargedAmount === 'number') setQrAmount(res.chargedAmount)
      if (typeof res.baseAmount === 'number') setQrBaseAmount(res.baseAmount)
      if (typeof res.surcharge8 === 'boolean') setQrSurcharge8(res.surcharge8)
    } catch (err) {
      const data = err instanceof ApiError ? err.data : undefined
      const redirect = data?.['redirectUrl'] as string | undefined
      const txId = data?.['transactionId'] as string | undefined
      if (redirect) setQrRedirectUrl(redirect)
      // Транзакция создана на Platega, polling продолжается чтобы поймать CONFIRMED
      if (txId) setQrTransactionId(txId)
      // Если есть страница оплаты или транзакция — это не ошибка, а ожидание
      // подтверждения через redirect (H2H ещё генерит QR). Иначе — реальная ошибка.
      if (!redirect && !txId) {
        setQrError((err as Error)?.message ?? 'Ошибка создания QR')
      }
    } finally {
      setQrLoading(false)
    }
  }

  // Единый путь "успешно оплачено и закрыто": показать успех и закрыть шторку.
  const markPaidAndClose = useCallback(() => {
    setIsPaid(true)
    setShowPayment(false)
    qc.invalidateQueries({ queryKey: ['checks', 'active'] })
    qc.invalidateQueries({ queryKey: ['check', checkId] })
    setTimeout(() => { if (onClose) onClose(); else onBack() }, 1800)
  }, [qc, checkId, onClose, onBack])

  // Polling Platega статуса каждые 3 секунды пока QR-экран активен
  useEffect(() => {
    if (payScreen !== 'qr' || !qrTransactionId || qrStatus !== 'pending' || qrLoading) return
    const poll = async () => {
      try {
        const res = await api.get<{ status: string }>(`/pos/checks/${checkId}/qr/${qrTransactionId}/status`)
        if (res.status === 'CONFIRMED') {
          setQrStatus('confirmed')
          // Webhook Platega АВТОРИТЕТНО закрывает чек на сервере (фиксирует надбавку
          // и чаевые отдельно от выручки). Даём ему фору: несколько раз переспрашиваем
          // статус чека перед фолбэком, чтобы попасть в чистый путь, а не в ручной
          // сплит. Раньше POS-поллинг часто выигрывал гонку у вебхука → срабатывал
          // фолбэк ниже с неверной суммой.
          for (let i = 0; i < 4; i++) {
            try {
              const { check: fresh } = await api.get<{ check: { status: string } }>(`/pos/checks/${checkId}`)
              if (fresh.status === 'closed') {
                markPaidAndClose()
                return
              }
            } catch {
              // не смогли свериться — пробуем ещё раз
            }
            await new Promise((r) => setTimeout(r, 800))
          }
          // Вебхук так и не закрыл чек (медленный/недоступен) — фолбэк: проводим СБП
          // как tender. ВАЖНО: на БАЗОВУЮ сумму (qrBaseAmount = товары/итог чека), а
          // НЕ qrAmount — надбавку 8% и чаевые гость платит СВЕРХ чека (эквайеру), в
          // оплату чека они не идут. Иначе splitSum > due → фантомная «сдача».
          addSplitPart({ method: 'transfer', amount: qrBaseAmount || qrAmount, label: 'СБП (Platega)' })
          setPayScreen('split')
        } else if (res.status === 'CANCELED') {
          setQrStatus('canceled')
          setQrError('Платёж отменён или истекло время ожидания')
        }
      } catch {
        // игнорируем ошибки поллинга
      }
    }
    const t = setInterval(poll, 3000)
    return () => clearInterval(t)
  }, [payScreen, qrTransactionId, qrStatus, qrLoading, checkId, qrAmount, qrBaseAmount, markPaidAndClose])

  // Ответ мутации = свежий чек целиком (getCheckWithItems). Пишем его прямо в кэш
  // вместо invalidate+refetch — карточка обновляется мгновенно, без сетевой задержки.
  const writeCheck = useCallback((res: { check: CheckData }) => {
    qc.setQueryData(['check', checkId], res.check)
    qc.invalidateQueries({ queryKey: ['suggestions', checkId] }) // позиции изменились → пересчитать
  }, [qc, checkId])

  // Предугаданные позиции (Tai) — частые заказы клиента-резидента, которых ещё нет в чеке.
  const { data: suggestData } = useQuery({
    queryKey: ['suggestions', checkId],
    queryFn: () => api.get<{ suggestions: { itemId: string; name: string; price: string }[] }>(`/pos/checks/${checkId}/suggestions`),
    enabled: !!checkId,
  })
  const suggestions = suggestData?.suggestions ?? []

  const addItem = useMutation({
    mutationFn: (itemId: string) => api.post<{ check: CheckData }>(`/pos/checks/${checkId}/items`, { itemId, quantity: 1 }),
    onSuccess: writeCheck,
    onError: toastError,
  })

  // Подтверждение заказа гостя: позиции добавляются в чек (бэкенд возвращает чек).
  const confirmOrder = useMutation({
    mutationFn: (orderId: string) => api.post<{ check: CheckData }>(`/pos/orders/${orderId}/confirm`, {}),
    onSuccess: writeCheck,
    onError: toastError,
  })
  const rejectOrder = useMutation({
    mutationFn: (orderId: string) => api.post(`/pos/orders/${orderId}/reject`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['check', checkId] }),
    onError: toastError,
  })

  // Чат с гостем: лёгкий запрос для бейджа непрочитанных (общий ключ с CheckChat).
  const { data: chatMsgs } = useQuery({
    queryKey: ['chat', checkId],
    queryFn: () => api.get<{ messages: ChatMessage[] }>(`/pos/checks/${checkId}/chat`).then((r) => r.messages),
    // Чат идёт через планшет кабинки — у чека без зоны его нет, и опрашивать нечего.
    enabled: !!check?.spaceId,
    refetchInterval: 4000,
  })
  const chatUnread = chatOpen ? 0 : (chatMsgs ?? []).filter((m) => m.sender === 'guest' && new Date(m.createdAt).getTime() > chatSeenAt).length

  const updateQty = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      quantity === 0
        ? api.delete<{ check: CheckData }>(`/pos/checks/${checkId}/items/${id}`)
        : api.patch<{ check: CheckData }>(`/pos/checks/${checkId}/items/${id}`, { quantity }),
    onSuccess: writeCheck,
    onError: toastError,
  })

  // Редактирование времени аренды (начало/конец). spaceEndAt=null → снова живой счётчик.
  const updateRental = useMutation({
    mutationFn: (body: { spaceStartAt?: string; spaceEndAt?: string | null }) =>
      api.patch<{ check: CheckData }>(`/pos/checks/${checkId}`, body),
    onSuccess: (res) => { writeCheck(res); setShowRentalEdit(false) },
    onError: toastError,
  })

  // Редактирование мероприятия прямо из чека: плановые часы (почасовая) или
  // фикс-сумма. Сервер пересчитывает eventBaseAmount привязанного чека — поэтому
  // инвалидируем И сам чек ['check', checkId] (обновятся eventBase/итого), И событие.
  const updateEvent = useMutation({
    mutationFn: (body: { plannedHours: number } | { fixedAmount: number }) =>
      api.patch<{ event: LinkedEvent }>(`/events/${linkedEventId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['check', checkId] })
      qc.invalidateQueries({ queryKey: ['event', linkedEventId] })
      setEditEventAmount(false)
    },
    onError: toastError,
  })

  // Ручная скидка на чек (percent/fixed). Бэкенд пересчитывает total.
  const applyDiscount = useMutation({
    mutationFn: (body: { type: 'percent' | 'fixed'; value: number }) =>
      api.post<{ check: CheckData }>(`/pos/checks/${checkId}/discount`, {
        name: body.type === 'percent' ? `Скидка ${body.value}%` : `Скидка ${body.value} ₽`,
        type: body.type,
        value: body.value,
        target: 'check',
      }),
    onSuccess: (res) => { writeCheck(res); setShowDiscount(false); setDiscValue('') },
    onError: toastError,
  })
  const removeDiscount = useMutation({
    mutationFn: (discountId: string) => api.delete<{ check: CheckData }>(`/pos/checks/${checkId}/discount/${discountId}`),
    onSuccess: writeCheck,
    onError: toastError,
  })
  // Вернуть снятую авто/тир-скидку (по discountId из excludedDiscounts).
  const restoreDiscount = useMutation({
    mutationFn: (discountId: string) => api.post<{ check: CheckData }>(`/pos/checks/${checkId}/discount/${discountId}/restore`),
    onSuccess: writeCheck,
    onError: toastError,
  })

  // Привязать/сменить/снять плательщика (playerId). Работает и для чеков с арендой.
  const setPlayer = useMutation({
    mutationFn: (playerId: string | null) =>
      api.patch<{ check: CheckData }>(`/pos/checks/${checkId}`, { playerId }),
    onSuccess: (res) => { writeCheck(res); qc.invalidateQueries({ queryKey: ['checks', 'active'] }) },
    onError: toastError,
  })
  // Доп. люди в чеке (guestNames) — например, когда один платит за двоих.
  const setGuests = useMutation({
    mutationFn: (guestNames: string[]) =>
      api.patch<{ check: CheckData }>(`/pos/checks/${checkId}`, { guestNames }),
    onSuccess: (res) => { writeCheck(res); qc.invalidateQueries({ queryKey: ['checks', 'active'] }) },
    onError: toastError,
  })

  // Debounced-поиск клиентов в шторке (тот же эндпоинт, что и на кассе).
  useEffect(() => {
    if (!showClient) return
    if (clientTimerRef.current) clearTimeout(clientTimerRef.current)
    const q = clientQuery.trim()
    if (!q) { setClientResults([]); setClientSearching(false); return }
    setClientSearching(true)
    clientTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.get<{ players: { id: string; nickname: string; clientTier: string; photoUrl?: string | null }[] }>(`/pos/players/search?q=${encodeURIComponent(q)}`)
        setClientResults(res.players)
      } catch { setClientResults([]) }
      finally { setClientSearching(false) }
    }, 300)
    return () => { if (clientTimerRef.current) clearTimeout(clientTimerRef.current) }
  }, [clientQuery, showClient])

  // Предвыбор тарифа по СТАТУСУ клиента (тариф = статус, по key; фолбэк по имени).
  useEffect(() => {
    if (!tariffStep || !pendingPlayer) return
    const byKey = tariffItems.find(i => i.key && i.key === pendingPlayer.clientTier)
    const expected = TIER_TO_TARIFF_NAME[pendingPlayer.clientTier]
    const match = byKey ?? (expected ? tariffItems.find(i => i.name.toLowerCase() === expected.toLowerCase()) : undefined)
    setSelectedTariffId(match?.id ?? null)
  }, [tariffStep, pendingPlayer, tariffsData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Закрыть шторку клиента и сбросить тарифный шаг.
  const closeClient = () => {
    setShowClient(false); setTariffStep(false); setPendingPlayer(null)
    setSelectedTariffId(null); setClientQuery(''); setClientResults([]); setGuestNameInput('')
  }

  // Подтверждение тарифного шага: если добавляем доп. участника — сперва пишем его
  // имя в guestNames, затем (для всех) добавляем выбранный тариф позицией в чек.
  const confirmTariff = async () => {
    if (pendingPlayer?.asGuest) {
      const names = check?.guestNames ?? []
      if (!names.includes(pendingPlayer.nickname)) {
        try { await setGuests.mutateAsync([...names, pendingPlayer.nickname]) } catch { /* toastError */ }
      }
    }
    // selectedTariffId — id тарифа из /tariffs; в чек добавляем его backing itemId.
    const chosenTariff = tariffItems.find(t => t.id === selectedTariffId)
    if (chosenTariff?.itemId) { try { await addItem.mutateAsync(chosenTariff.itemId) } catch { /* toastError */ } }
    closeClient()
  }

  // Выбор клиента в шторке. Нет плательщика → он становится плательщиком; иначе —
  // доп. участник («один платит за двоих»). В обоих случаях показываем тарифный
  // шаг (как при открытии нового чека), тариф добавляется позицией в чек.
  const pickClient = (cl: { id: string; nickname: string; clientTier: string }) => {
    setClientQuery(''); setClientResults([])
    if (!check?.playerId) {
      setPlayer.mutate(cl.id)
      setPendingPlayer({ ...cl, asGuest: false })
    } else {
      if (cl.id === check.playerId) return
      setPendingPlayer({ nickname: cl.nickname, clientTier: cl.clientTier, asGuest: true })
    }
    setSelectedTariffId(null)
    setTariffStep(true)
  }
  // Доп. участник по имени (без профиля) — тоже через тарифный шаг.
  const addGuestName = () => {
    const name = guestNameInput.trim()
    if (!name) return
    setGuestNameInput('')
    setPendingPlayer({ nickname: name, clientTier: '', asGuest: true })
    setSelectedTariffId(null)
    setTariffStep(true)
  }
  const removeGuestName = (name: string) => {
    setGuests.mutate((check?.guestNames ?? []).filter(n => n !== name))
  }

  const pay = useMutation({
    mutationFn: (body: { payments: SplitPart[]; bonusAmount?: number; certificateCode?: string; playerId?: string }) =>
      api.post(`/pos/checks/${checkId}/pay`, body),
    onSuccess: () => {
      setIsPaid(true)
      setShowPayment(false)
      qc.invalidateQueries({ queryKey: ['checks', 'active'] })
      setTimeout(() => {
        if (onClose) onClose()
        else onBack()
      }, 1800)
    },
  })

  const cancelCheck = useMutation({
    mutationFn: () => api.delete(`/pos/checks/${checkId}`),
    onSuccess: () => {
      setConfirmCancel(false)
      qc.invalidateQueries({ queryKey: ['checks', 'active'] })
      // Список чеков кассы + сводка смены (карточка «Смена») — пересчитать сразу.
      qc.invalidateQueries({ queryKey: ['checks'] })
      qc.invalidateQueries({ queryKey: ['pos', 'shift-summary'] })
      if (onClose) onClose()
      else onBack()
    },
    onError: (e) => { setConfirmCancel(false); toastError(e) },
  })

  async function lookupCertificate() {
    if (!certCode.trim()) return
    setCertLoading(true)
    setCertError('')
    setCertInfo(null)
    let attempts = 0
    const delays = [500, 1000, 1500]
    while (attempts <= 2) {
      try {
        const res = await api.get<{ certificate: CertificateInfo }>(`/certificates/validate/${certCode.trim().toUpperCase()}`)
        setCertInfo(res.certificate)
        setCertLoading(false)
        return
      } catch (err) {
        attempts++
        if (attempts > 2) {
          setCertError((err as Error)?.message ?? 'Сертификат не найден')
          setCertLoading(false)
          return
        }
        await new Promise(r => setTimeout(r, delays[attempts - 1]))
      }
    }
  }

  function addSplitPart(part: SplitPart) {
    setSplitParts(prev => [...prev, part])
  }

  function removeSplitPart(idx: number) {
    setSplitParts(prev => prev.filter((_, i) => i !== idx))
  }

  function handleMethodClick(method: string) {
    if (method === 'bonus') {
      setPayScreen('bonus')
    } else if (method === 'deposit') {
      setPayScreen('deposit')
    } else if (method === 'transfer') {
      // СБП → сперва спросить про комиссию эквайринга 8%.
      setPayScreen('sbp_surcharge')
    } else if (method === 'split') {
      // «Раздельная» — открываем композитор tender'ов пустым (без авто-дампа).
      setSplitMethod('cash')
      setSplitAmtInput(String(remaining > 0 ? Math.round(remaining) : Math.round(total)))
      setPayScreen('split')
    } else {
      // Быстрый одиночный метод (Наличные / Перевод / Долг): добавить весь остаток,
      // на split-экране сумму можно отредактировать (удалить и добавить заново).
      addSplitPart({ method, amount: remaining > 0 ? remaining : total, label: METHOD_CONFIGS[method]?.label })
      setSplitMethod(method)
      setPayScreen('split')
    }
  }

  // Добавить tender из композитора (split-экран) с введённой суммой.
  function addComposerPart() {
    const amt = Math.round(parseFloat(splitAmtInput.replace(',', '.')) || 0)
    if (amt <= 0) return
    addSplitPart({ method: splitMethod, amount: amt, label: METHOD_CONFIGS[splitMethod]?.label })
    // Подготовить следующий ввод на оставшийся остаток (с учётом предоплаты).
    const nextRemaining = Math.max(0, due - (splitSum + amt))
    setSplitAmtInput(nextRemaining > 0 ? String(nextRemaining) : '')
  }

  async function finishPayment() {
    if (isProcessing || remaining > 0.01) return
    setIsProcessing(true)
    try {
      await pay.mutateAsync({
        payments: splitParts.map(p => ({ method: p.method, amount: p.amount })),
        bonusAmount: bonusAmount > 0 ? bonusAmount : undefined,
        certificateCode: certInfo?.code,
        playerId: check?.playerId ?? undefined,
      })
    } catch (err) {
      // Гонка с вебхуком Platega: чек мог быть уже закрыт оплатой по QR.
      // Если чек действительно закрыт — это успех, а не ошибка.
      if (err instanceof ApiError) {
        try {
          const { check: fresh } = await api.get<{ check: { status: string } }>(`/pos/checks/${checkId}`)
          if (fresh.status === 'closed') {
            markPaidAndClose()
            return
          }
        } catch {
          // не удалось свериться — показываем исходную ошибку
        }
        show(String((err.data as Record<string, unknown>)?.error ?? 'Не удалось провести оплату'), 'error')
      } else {
        show('Ошибка сети. Повторите попытку.', 'error')
      }
      setIsProcessing(false)
    }
  }

  if (isPaid) {
    const change = splitSum - due
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 88, height: 88, borderRadius: '50%', marginBottom: 20, marginLeft: 'auto', marginRight: 'auto',
            background: 'rgba(52,211,153,0.15)', border: '2px solid var(--success)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 32px rgba(52,211,153,0.3)',
          }}>
            <Icon name="check_circle" size={44} color="var(--success)" />
          </div>
          <h2 style={{ fontSize: 28, fontWeight: 900, textTransform: 'uppercase', color: 'var(--success)', marginBottom: 8 }}>
            ОПЛАЧЕНО!
          </h2>
          {change > 0 && (
            <p style={{ color: 'var(--on-surface-variant)', fontSize: 15 }}>
              Сдача: <span style={{ fontWeight: 800, color: 'var(--on-surface)', fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{change.toLocaleString('ru')} ₽</span>
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* Header */}
      <div className="glass-l1" style={{
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
        borderLeft: 'none', borderRight: 'none', borderTop: 'none', borderRadius: 0,
      }}>
        <button
          onClick={onBack}
          aria-label="Назад"
          style={{
            width: 44, height: 44, borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <Icon name="arrow_back" size={18} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
            background: player?.photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(76,215,246,0.3))',
            border: '1px solid rgba(139,92,246,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: '#A78BFA',
          }}>
            {player?.photoUrl
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={player.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : getInitials(displayName)}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </p>
            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: 0 }}>
              {check?.items.length ?? 0} позиций
            </p>
          </div>
        </div>

        {/* Tai знает этот чек: «добавь колу» — сюда. */}
        {check?.status === 'open' && <TaiButton context={{ screen: 'check', checkId }} />}

        {check?.spaceId && (
        <button
          onClick={() => { setChatSeenAt(Date.now()); setChatOpen(true); markReadByCheck({ checkId, types: ['chat_message'] }) }}
          aria-label="Чат с гостем"
          title="Чат с гостем"
          style={{
            position: 'relative', width: 38, height: 38, borderRadius: 10, border: '1px solid rgba(76,215,246,0.3)',
            cursor: 'pointer', background: 'rgba(76,215,246,0.08)', color: '#4cd7f6', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="chat" size={18} />
          {chatUnread > 0 && (
            <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: '#f43f5e', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{chatUnread}</span>
          )}
        </button>
        )}

        <button
          onClick={() => setConfirmCancel(true)}
          aria-label="Отменить чек"
          title="Отменить чек"
          style={{
            width: 38, height: 38, borderRadius: 10, border: '1px solid rgba(251,113,133,0.25)',
            cursor: 'pointer', background: 'rgba(251,113,133,0.08)',
            color: 'var(--danger)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name="delete" size={18} />
        </button>
      </div>
      {chatOpen && (
        <CheckChat checkId={checkId} as="staff" onClose={() => { setChatSeenAt(Date.now()); setChatOpen(false) }} />
      )}

      {/* Split layout */}
      <div
        style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', overflow: 'hidden' }}
        className="check-layout"
      >
        {/* Left: check items */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="check-items" style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {/* Входящие заказы гостя с планшета — подтвердить / отклонить */}
            {(check?.pendingOrders ?? []).map((ord) => {
              const sum = ord.items.reduce((s, it) => s + parseFloat(it.price) * it.quantity, 0)
              return (
                <div key={ord.id} style={{ borderRadius: 14, padding: '14px 16px', marginBottom: 12, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.4)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, color: '#F59E0B', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <Icon name="room_service" size={18} /> Новый заказ с планшета
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
                    {ord.items.map((it, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--on-surface)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name} × {it.quantity}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, marginLeft: 12 }}>{(parseFloat(it.price) * it.quantity).toLocaleString('ru')} ₽</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, marginTop: 4, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)' }}>
                      <span>Итого</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{sum.toLocaleString('ru')} ₽</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => confirmOrder.mutate(ord.id)} disabled={confirmOrder.isPending || rejectOrder.isPending} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#10B981,#34D399)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Icon name="check" size={18} /> Подтвердить
                    </button>
                    <button onClick={() => rejectOrder.mutate(ord.id)} disabled={confirmOrder.isPending || rejectOrder.isPending} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: '1px solid rgba(244,63,94,0.4)', cursor: 'pointer', background: 'rgba(244,63,94,0.08)', color: '#f43f5e', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      <Icon name="close" size={18} /> Отклонить
                    </button>
                  </div>
                </div>
              )
            })}

            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 60, borderRadius: 12, marginBottom: 8 }} />
            ))}

            {check?.items.map((ci) => (
              <SwipeableRow
                key={ci.checkItem.id}
                onDelete={() => updateQty.mutate({ id: ci.checkItem.id, quantity: 0 })}
              >
              <div
                className="glass-l2"
                style={{ borderRadius: 12, padding: '12px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--on-surface)' }}>
                    {ci.item?.name ?? '—'}
                  </p>
                  <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>
                    {parseFloat(ci.checkItem.priceAtTime).toLocaleString('ru')} ₽
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => updateQty.mutate({ id: ci.checkItem.id, quantity: ci.checkItem.quantity - 1 })}
                    disabled={updateQty.isPending}
                    aria-label={ci.checkItem.quantity === 1 ? 'Удалить позицию' : 'Уменьшить количество'}
                    style={{
                      width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
                      cursor: updateQty.isPending ? 'not-allowed' : 'pointer', background: 'rgba(255,255,255,0.04)',
                      color: ci.checkItem.quantity === 1 ? 'var(--danger)' : 'var(--on-surface-variant)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      opacity: updateQty.isPending ? 0.5 : 1,
                    }}
                  >
                    <Icon name={ci.checkItem.quantity === 1 ? 'delete' : 'remove'} size={16} />
                  </button>
                  <span style={{ width: 26, textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'var(--on-surface)' }}>
                    {ci.checkItem.quantity}
                  </span>
                  <button
                    onClick={() => updateQty.mutate({ id: ci.checkItem.id, quantity: ci.checkItem.quantity + 1 })}
                    disabled={updateQty.isPending}
                    aria-label="Увеличить количество"
                    style={{
                      width: 36, height: 36, borderRadius: 10, border: 'none',
                      cursor: updateQty.isPending ? 'not-allowed' : 'pointer', background: 'rgba(139,92,246,0.2)', color: '#A78BFA',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      opacity: updateQty.isPending ? 0.5 : 1,
                    }}
                  >
                    <Icon name="add" size={16} />
                  </button>
                </div>
                <p style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--on-surface)', width: 64, textAlign: 'right', margin: 0 }}>
                  {(parseFloat(ci.checkItem.priceAtTime) * ci.checkItem.quantity).toLocaleString('ru')} ₽
                </p>
              </div>
              </SwipeableRow>
            ))}

            {/* Предугаданные позиции (Tai) — частые заказы резидента. Полупрозрачные
                строки; тап добавляет позицию в чек. */}
            {suggestions.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 2px 6px' }}>
                  <TaiLogo size={16} animated={false} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tai предлагает</span>
                </div>
                {suggestions.map((s) => (
                  <button
                    key={`sug-${s.itemId}`}
                    onClick={() => addItem.mutate(s.itemId)}
                    disabled={addItem.isPending}
                    className="glass-l2"
                    style={{
                      width: '100%', borderRadius: 12, padding: '10px 14px', marginBottom: 8,
                      display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                      border: '1px dashed rgba(160,125,255,0.45)', background: 'transparent',
                      opacity: addItem.isPending ? 0.4 : 0.62, cursor: addItem.isPending ? 'default' : 'pointer',
                      transition: 'opacity .15s',
                    }}
                  >
                    <TaiLogo size={22} animated={false} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--on-surface)' }}>{s.name}</p>
                      <p style={{ fontSize: 11, color: '#a78bfa', margin: '2px 0 0' }}>предложено Tai · {parseFloat(String(s.price)).toLocaleString('ru')} ₽</p>
                    </div>
                    <span style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(139,92,246,0.2)', color: '#A78BFA', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="add" size={16} />
                    </span>
                  </button>
                ))}
              </>
            )}

            {check?.items.length === 0 && !isLoading && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--on-surface-variant)' }}>
                <Icon name="shopping_cart" size={40} style={{ display: 'block', marginBottom: 12, opacity: 0.4 }} />
                <p style={{ fontSize: 13 }}>Добавьте товары из меню →</p>
              </div>
            )}

            {/* База мероприятия — фикс/ручная сумма события (помимо позиций/аренды).
                Для привязанного мероприятия — inline-редактор планового времени /
                фикс-суммы (сервер пересчитывает eventBaseAmount чека). */}
            {linkedEventId && (eventBase > 0 || linkedEvent) && (
              <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 14, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.18)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--on-surface)', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <Icon name="event" size={15} color="#A78BFA" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {linkedEvent?.title || 'Мероприятие'}
                    </span>
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#A78BFA', flexShrink: 0 }}>
                    {eventBase.toLocaleString('ru')} ₽
                  </span>
                </div>

                {/* Почасовая: сетка кнопок 1ч..6ч (с ценами), активна текущая plannedHours. */}
                {isEditable && linkedEvent?.billingMode === 'hourly' && eventRates.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {eventRates.map(r => {
                      const active = linkedEvent.plannedHours === r.hours
                      return (
                        <button
                          key={r.hours}
                          type="button"
                          onClick={() => { if (!active) updateEvent.mutate({ plannedHours: r.hours }) }}
                          disabled={updateEvent.isPending}
                          style={{
                            flex: '1 0 auto', minWidth: 64, padding: '8px 10px', borderRadius: 10,
                            border: `1px solid ${active ? 'rgba(167,139,250,0.65)' : 'rgba(255,255,255,0.1)'}`,
                            background: active ? 'rgba(139,92,246,0.22)' : 'rgba(255,255,255,0.04)',
                            color: active ? '#A78BFA' : 'var(--on-surface-variant)',
                            cursor: updateEvent.isPending ? 'not-allowed' : 'pointer',
                            opacity: updateEvent.isPending ? 0.6 : 1,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 800 }}>{r.hours}ч</span>
                          <span style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{parseFloat(r.price).toLocaleString('ru')} ₽</span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Фикс: показать сумму с карандашом → числовой ввод + ОК. */}
                {isEditable && linkedEvent?.billingMode === 'amount' && (
                  editEventAmount ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <input
                        type="number" inputMode="decimal" min="0" autoFocus
                        value={eventAmountInput}
                        onChange={e => setEventAmountInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { const v = parseFloat(eventAmountInput); if (v >= 0) updateEvent.mutate({ fixedAmount: v }) } }}
                        placeholder="Сумма ₽"
                        className="glass-l2"
                        style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)', fontSize: 15, fontWeight: 700, background: 'rgba(255,255,255,0.04)', boxSizing: 'border-box' }}
                      />
                      <button
                        type="button"
                        onClick={() => { const v = parseFloat(eventAmountInput); if (v >= 0) updateEvent.mutate({ fixedAmount: v }) }}
                        disabled={updateEvent.isPending || !(parseFloat(eventAmountInput) >= 0)}
                        style={{ flexShrink: 0, padding: '0 16px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: (updateEvent.isPending || !(parseFloat(eventAmountInput) >= 0)) ? 0.5 : 1 }}
                      >ОК</button>
                      <button
                        type="button"
                        onClick={() => setEditEventAmount(false)}
                        disabled={updateEvent.isPending}
                        aria-label="Отмена"
                        style={{ flexShrink: 0, width: 38, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setEventAmountInput(linkedEvent.fixedAmount ?? String(eventBase || '')); setEditEventAmount(true) }}
                      style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, border: '1px solid rgba(167,139,250,0.35)', background: 'rgba(167,139,250,0.1)', color: '#A78BFA', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >
                      <Icon name="edit" size={14} /> Изменить сумму
                    </button>
                  )
                )}
              </div>
            )}

            {/* Списание на персонал/владельца (тумблер в разделе скидок) — плашка как у скидок. */}
            {check?.staffCompId && (
              <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 14, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#F59E0B', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="badge" size={14} color="#F59E0B" /> Списание на персонал
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#F59E0B' }}>−100% · бесплатно</span>
              </div>
            )}

            {/* Применённые скидки — все, и ручные, и авто/тир (видны на ПК и телефоне). */}
            {(check?.discounts?.length ?? 0) > 0 && (
              <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 14, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.18)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#34D399', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon name="sell" size={14} color="#34D399" />
                    Скидки
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#34D399' }}>
                    −{Math.round((check?.discounts ?? []).reduce((s, d) => s + parseFloat(d.amount), 0)).toLocaleString('ru')} ₽
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(check?.discounts ?? []).map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontSize: 13, color: 'var(--on-surface)' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                        {d.discountId !== null && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', flexShrink: 0, padding: '1px 5px', borderRadius: 5, background: 'rgba(167,139,250,0.15)' }}>авто</span>
                        )}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#34D399' }}>
                          −{Math.round(parseFloat(d.amount)).toLocaleString('ru')} ₽
                        </span>
                        <button type="button" onClick={() => removeDiscount.mutate(d.id)} disabled={removeDiscount.isPending} aria-label="Снять скидку" style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid rgba(244,63,94,0.2)', background: 'rgba(244,63,94,0.08)', color: '#F87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon name="close" size={14} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Payment footer — на телефоне превращается в плавающий «остров»
              с точными размерами/позицией нижней навигации (см. <style> ниже). */}
          <div className="check-pay-bar glass-l1" style={{ padding: 16, paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', borderRadius: 0 }}>
            <div className="check-pay-row">
              <div className="check-pay-money">
                <p className="check-pay-label" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)', margin: '0 0 4px' }}>
                  Итого
                </p>
                <p className="check-pay-amount" style={{ fontSize: 28, fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: 0, color: 'var(--on-surface)', fontFamily: "'JetBrains Mono',monospace" }}>
                  {total.toLocaleString('ru')} ₽
                </p>
              </div>
              <div className="check-pay-actions" style={{ display: 'flex', gap: 10 }}>
                {check?.spaceId && (
                  <button
                    onClick={openRentalEdit}
                    className="check-pay-timer"
                    aria-label="Аренда — редактировать время"
                    title={check.spaceEndAt ? 'Аренда (фикс.)' : 'Аренда (живой счётчик)'}
                    style={{
                      padding: '14px 14px', borderRadius: 16, border: '1px solid rgba(167,139,250,0.35)',
                      cursor: 'pointer', background: 'rgba(167,139,250,0.1)', color: '#A78BFA',
                      fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0,
                    }}
                  >
                    <Icon name={check.spaceEndAt ? 'schedule' : 'timer'} size={18} />
                    {spaceRental.toLocaleString('ru')} ₽
                  </button>
                )}
                <button
                  onClick={() => setShowMenuDrawer(true)}
                  className="check-pay-add"
                  style={{
                    padding: '14px 20px', borderRadius: 16, border: '1px solid rgba(139,92,246,0.35)',
                    cursor: 'pointer', background: 'rgba(139,92,246,0.1)',
                    color: '#A78BFA', fontSize: 13, fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.06em',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                >
                  <Icon name="add" size={18} />
                  <span className="check-pay-add-label">Добавить</span>
                </button>
                <button
                  onClick={() => { setDiscType('percent'); setDiscValue(''); setShowDiscount(true) }}
                  className="check-pay-add"
                  aria-label="Добавить скидку"
                  title="Скидка"
                  style={{
                    padding: '14px 16px', borderRadius: 16, border: '1px solid rgba(52,211,153,0.35)',
                    cursor: 'pointer', background: 'rgba(52,211,153,0.1)', color: '#34D399',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Icon name="sell" size={18} />
                </button>
                {/* Клиент в чеке: привязать плательщика (в т.ч. при аренде) и добавить
                    доп. людей (один платит за двоих). Бейдж = число людей в чеке. */}
                <button
                  onClick={() => setShowClient(true)}
                  className="check-pay-add"
                  aria-label="Добавить клиента"
                  title="Клиент в чеке"
                  style={{
                    position: 'relative',
                    padding: '14px 16px', borderRadius: 16, border: '1px solid rgba(56,189,248,0.35)',
                    cursor: 'pointer', background: 'rgba(56,189,248,0.1)', color: '#38BDF8',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Icon name="person_add" size={18} />
                  {(() => {
                    const ppl = (check?.playerId ? 1 : 0) + (check?.guestNames?.length ?? 0)
                    return ppl > 1 ? (
                      <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9, background: '#38BDF8', color: '#0D1526', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>{ppl}</span>
                    ) : null
                  })()}
                </button>
                {/* Сертификат — только для чеков мероприятия (вход в существующий cert-флоу). */}
                {check?.linkedEventId && (
                  <button
                    onClick={() => { openPaymentDrawer(); setPayScreen('certificate') }}
                    className="check-pay-add"
                    aria-label="Оплата сертификатом"
                    title="Сертификат"
                    style={{
                      padding: '14px 16px', borderRadius: 16, border: '1px solid rgba(251,191,36,0.35)',
                      cursor: 'pointer', background: 'rgba(251,191,36,0.1)', color: '#fbbf24',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <Icon name="card_membership" size={18} />
                  </button>
                )}
              </div>
              <button
                // При total=0 (например, скидка обнулила сумму) платить нечего —
                // закрываем чек напрямую пустым набором платежей (бэкенд проводит 0₽).
                onClick={total <= 0 ? () => pay.mutate({ payments: [], playerId: check?.playerId ?? undefined }) : openPaymentDrawer}
                disabled={pay.isPending}
                className="check-pay-go"
                style={{
                  padding: '14px 28px', borderRadius: 16, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)',
                  color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
                  boxShadow: '0 4px 20px rgba(139,92,246,0.35)', opacity: pay.isPending ? 0.5 : 1, whiteSpace: 'nowrap',
                }}
              >
                {total <= 0 ? (pay.isPending ? 'ЗАКРЫВАЕМ…' : 'ЗАКРЫТЬ · 0 ₽') : 'К ОПЛАТЕ'}
              </button>
            </div>
          </div>
        </div>

      </div>

      {/* Menu Drawer */}
      {showMenuDrawer && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShowMenuDrawer(false)}
            style={{
              position: 'absolute', inset: 0, zIndex: 40,
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }}
          />
          {/* Sheet */}
          <div style={{
            position: 'absolute', bottom: kbInset, left: 0, right: 0, zIndex: 41,
            background: 'rgba(21,18,27,0.98)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
            borderRadius: '20px 20px 0 0',
            border: '1px solid rgba(255,255,255,0.08)',
            borderBottom: 'none',
            boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
            height: sheetH ? `${sheetH}px` : '70%',
            transition: sheetDragging ? 'none' : 'height 0.25s ease, bottom 0.2s ease',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Handle + header — зона перетаскивания (тянем панель за палец) */}
            <div
              onTouchStart={onSheetDragStart}
              onTouchMove={onSheetDragMove}
              onTouchEnd={onSheetDragEnd}
              style={{ padding: '12px 16px 0', flexShrink: 0, touchAction: 'none', cursor: 'grab' }}
            >
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', margin: '0 auto 12px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Добавить позицию</h3>
                <button
                  onClick={() => setShowMenuDrawer(false)}
                  style={{ width: 32, height: 32, borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-surface-variant)' }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            </div>
            {/* Search + категории (вне зоны перетаскивания, чтобы не мешать вводу) */}
            <div style={{ padding: '0 16px', flexShrink: 0 }}>
              {/* Search */}
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <Icon name="search" size={16} color="var(--on-surface-variant)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onFocus={expandSheetFull}
                  placeholder="Поиск..."
                  className="glass-l2"
                  style={{ width: '100%', padding: '9px 12px 9px 36px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', color: 'var(--on-surface)', fontSize: 13, outline: 'none', background: 'none', boxSizing: 'border-box' }}
                />
              </div>
              {/* Category pills — иконки + цвета категории (как на планшете) */}
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 10 }}>
                <button onClick={() => setActiveCat(null)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 9999, border: !activeCat ? 'none' : '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: !activeCat ? 'linear-gradient(135deg, #8B5CF6, #6D28D9)' : 'rgba(255,255,255,0.06)', color: !activeCat ? '#fff' : 'var(--on-surface-variant)', boxShadow: !activeCat ? '0 2px 12px rgba(139,92,246,0.3)' : 'none' }}>
                  <Icon name="grid_view" size={14} /> Все
                </button>
                {orderedCats.map(cat => {
                  const isActive = activeCat === cat.id
                  const cc = catColor(cat.color)
                  return (
                    <button key={cat.id} onClick={() => setActiveCat(cat.id)} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 9999, border: `1px solid ${isActive ? cc.hex : cc.border}`, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: isActive ? cc.hex : cc.light, color: isActive ? '#fff' : cc.text, boxShadow: isActive ? `0 2px 12px ${cc.border}` : 'none' }}>
                      <CategoryIcon icon={cat.icon} size={14} color={isActive ? '#fff' : cc.text} />
                      {cat.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Items — карточки с иконкой и цветом категории (как на планшете).
                «Все» (без поиска/фильтра) — секции по категориям в порядке меню,
                тарифы в конце; иначе — плоская сетка отфильтрованных позиций. */}
            {groupedSections ? (
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                {groupedSections.map(sec => {
                  const cc = catColor(sec.cat?.color)
                  return (
                    <div key={sec.key}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 10px', paddingBottom: 6, borderBottom: `1px solid ${sec.cat ? cc.border : 'rgba(255,255,255,0.08)'}` }}>
                        <CategoryIcon icon={sec.cat?.icon ?? 'inventory_2'} size={16} color={sec.cat ? cc.hex : 'var(--on-surface-variant)'} />
                        <span style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: sec.cat ? cc.text : 'var(--on-surface-variant)' }}>{sec.cat?.name ?? 'Прочее'}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--on-surface-variant)' }}>{sec.items.length}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 12, alignContent: 'start' }}>
                        {sec.items.map(renderItemCard)}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 12, alignContent: 'start' }}>
                {filteredItems.map(renderItemCard)}
              </div>
            )}
          </div>
        </>
      )}

      {/* Manual discount editor */}
      {showDiscount && (
        <div
          onClick={e => { if (e.target === e.currentTarget && !applyDiscount.isPending) setShowDiscount(false) }}
          style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,21,38,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', padding: 16 }}
        >
          <div className="glass-l1" style={{ borderRadius: 24, padding: 24, width: 'min(420px,100%)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <Icon name="sell" size={22} color="#34D399" />
              <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Скидка на чек</h2>
            </div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button type="button" onClick={() => setDiscType('percent')} style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: `1px solid ${discType === 'percent' ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.1)'}`, background: discType === 'percent' ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)', color: discType === 'percent' ? '#34D399' : 'var(--on-surface-variant)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Процент %</button>
              <button type="button" onClick={() => setDiscType('fixed')} style={{ flex: 1, padding: '12px 0', borderRadius: 12, border: `1px solid ${discType === 'fixed' ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.1)'}`, background: discType === 'fixed' ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)', color: discType === 'fixed' ? '#34D399' : 'var(--on-surface-variant)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Сумма ₽</button>
            </div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', marginBottom: 6 }}>{discType === 'percent' ? 'Процент скидки' : 'Сумма скидки (₽)'}</label>
            <input
              type="number" inputMode="decimal" min="0" max={discType === 'percent' ? '100' : undefined} autoFocus
              value={discValue} onChange={e => setDiscValue(e.target.value)}
              placeholder={discType === 'percent' ? 'например 10' : 'например 200'}
              className="glass-l2"
              style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)', fontSize: 18, fontWeight: 700, background: 'rgba(255,255,255,0.04)', boxSizing: 'border-box', marginBottom: 18 }}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setShowDiscount(false)} disabled={applyDiscount.isPending} style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Отмена</button>
              <button
                type="button"
                onClick={() => { const v = parseFloat(discValue); if (v > 0) applyDiscount.mutate({ type: discType, value: discType === 'percent' ? Math.min(v, 100) : v }) }}
                disabled={applyDiscount.isPending || !(parseFloat(discValue) > 0)}
                style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #34D399, #10B981)', color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', opacity: (applyDiscount.isPending || !(parseFloat(discValue) > 0)) ? 0.5 : 1 }}
              >{applyDiscount.isPending ? '...' : 'Применить'}</button>
            </div>

            {/* Снятые авто/тир-скидки — отдельным блoком, можно вернуть. */}
            {(check?.excludedDiscounts?.length ?? 0) > 0 && (
              <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="undo" size={14} />
                  Снятые скидки
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(check?.excludedDiscounts ?? []).map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <span style={{ fontSize: 13, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {d.name}
                        <span style={{ color: 'var(--on-surface-variant)', marginLeft: 6 }}>
                          {d.type === 'percent' ? `${parseFloat(d.value)}%` : `${parseFloat(d.value).toLocaleString('ru')} ₽`}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => restoreDiscount.mutate(d.id)}
                        disabled={restoreDiscount.isPending}
                        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 10, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.1)', color: '#34D399', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: restoreDiscount.isPending ? 0.5 : 1 }}
                      >
                        <Icon name="undo" size={14} /> Вернуть
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Клиент в чеке: плательщик + доп. люди */}
      {showClient && (
        <div
          onClick={e => { if (e.target === e.currentTarget) closeClient() }}
          style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,21,38,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', padding: 16 }}
        >
          <div className="glass-l1" style={{ borderRadius: 24, padding: 24, width: 'min(440px,100%)', maxHeight: '90%', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
            {!tariffStep && (<>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <Icon name="group" size={22} color="#38BDF8" />
              <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Клиенты в чеке</h2>
            </div>

            {/* Плательщик */}
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', margin: '0 0 8px' }}>Плательщик</p>
            {check?.playerId ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 14px', borderRadius: 14, background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.3)', marginBottom: 16 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <Icon name="person" size={18} color="#38BDF8" />
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{check.guestName || 'Клиент'}</span>
                </span>
                <button type="button" onClick={() => setPlayer.mutate(null)} disabled={setPlayer.isPending} aria-label="Снять плательщика"
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, padding: '7px 10px', borderRadius: 10, border: '1px solid rgba(244,63,94,0.35)', background: 'rgba(244,63,94,0.1)', color: '#f43f5e', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  <Icon name="close" size={14} /> Снять
                </button>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: '0 0 16px' }}>Не выбран — найдите клиента ниже, первый станет плательщиком.</p>
            )}

            {/* Доп. люди */}
            {(check?.guestNames?.length ?? 0) > 0 && (
              <>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', margin: '0 0 8px' }}>Ещё в чеке</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {(check?.guestNames ?? []).map((name, i) => (
                    <div key={`${name}-${i}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <Icon name="person" size={16} color="var(--on-surface-variant)" />
                        <span style={{ fontSize: 14, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      </span>
                      <button type="button" onClick={() => removeGuestName(name)} disabled={setGuests.isPending} aria-label="Убрать"
                        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '6px 8px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface-variant)', cursor: 'pointer' }}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Поиск клиента */}
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', marginBottom: 6 }}>{check?.playerId ? 'Добавить человека' : 'Найти клиента'}</label>
            <input
              type="text" autoFocus value={clientQuery} onChange={e => setClientQuery(e.target.value)}
              placeholder="Имя или ник клиента"
              className="glass-l2"
              style={{ width: '100%', padding: '14px 16px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)', fontSize: 16, fontWeight: 600, background: 'rgba(255,255,255,0.04)', boxSizing: 'border-box', marginBottom: 10 }}
            />
            {clientSearching && <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '0 0 10px' }}>Поиск…</p>}
            {clientResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, maxHeight: 220, overflowY: 'auto' }}>
                {clientResults.filter(r => r.id !== check?.playerId).map(r => (
                  <button key={r.id} type="button" onClick={() => pickClient(r)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
                    {r.photoUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={r.photoUrl} alt="" width={24} height={24} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      : <Icon name="person" size={16} color="#38BDF8" />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nickname}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Добавить по имени (без профиля) */}
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', margin: '8px 0 6px' }}>Или добавить по имени</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <input
                type="text" value={guestNameInput} onChange={e => setGuestNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addGuestName() } }}
                placeholder="Имя гостя"
                className="glass-l2"
                style={{ flex: 1, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)', fontSize: 15, fontWeight: 600, background: 'rgba(255,255,255,0.04)', boxSizing: 'border-box' }}
              />
              <button type="button" onClick={addGuestName} disabled={setGuests.isPending || !guestNameInput.trim()}
                style={{ flexShrink: 0, padding: '0 16px', borderRadius: 12, border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.1)', color: '#38BDF8', fontSize: 13, fontWeight: 800, cursor: 'pointer', opacity: (setGuests.isPending || !guestNameInput.trim()) ? 0.5 : 1 }}>
                Добавить
              </button>
            </div>

            <button type="button" onClick={closeClient}
              style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #38BDF8, #0EA5E9)', color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer' }}>
              Готово
            </button>
            </>)}

            {/* Тарифный шаг — как при открытии нового чека на кассе */}
            {tariffStep && pendingPlayer && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                  <button type="button" onClick={() => setTariffStep(false)}
                    style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Тариф</h2>
                    <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)', margin: '3px 0 0' }}>Выберите тариф</p>
                  </div>
                </div>

                <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14, marginBottom: 18, border: '1px solid rgba(56,189,248,0.25)' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: pendingPlayer.photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(56,189,248,0.35), rgba(76,215,246,0.35))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#38BDF8' }}>
                    {pendingPlayer.photoUrl
                      ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={pendingPlayer.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : getInitials(pendingPlayer.nickname)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--on-surface)' }}>{pendingPlayer.nickname}</p>
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>{pendingPlayer.asGuest ? 'Доп. участник' : (TIER_LABELS[pendingPlayer.clientTier] ?? pendingPlayer.clientTier)}</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {tariffItems.map((item, idx) => {
                    const price = parseFloat(String(item.price)) || 0
                    const isSelected = selectedTariffId === item.id
                    const pal = TARIFF_PALETTE[idx % TARIFF_PALETTE.length]
                    return (
                      <button key={item.id} type="button" onClick={() => setSelectedTariffId(isSelected ? null : item.id)} disabled={addItem.isPending} className="glass-l2"
                        style={{ padding: '16px 14px', borderRadius: 16, border: isSelected ? `1px solid ${pal.selBorder}` : '1px solid rgba(255,255,255,0.08)', background: isSelected ? pal.selBg : 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, opacity: addItem.isPending ? 0.6 : 1 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: isSelected ? `${pal.color}44` : pal.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="confirmation_number" size={18} color={pal.color} />
                        </div>
                        <div>
                          <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: isSelected ? '#fff' : 'var(--on-surface)' }}>{item.name}</p>
                          <p style={{ fontSize: 16, fontWeight: 900, margin: '4px 0 0', color: pal.color, fontVariantNumeric: 'tabular-nums' }}>{price.toLocaleString('ru')} ₽</p>
                        </div>
                      </button>
                    )
                  })}

                  <button type="button" onClick={() => setSelectedTariffId(null)} disabled={addItem.isPending}
                    style={{ gridColumn: '1 / -1', padding: '14px 18px', borderRadius: 16, border: selectedTariffId === null ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.06)', background: selectedTariffId === null ? 'rgba(255,255,255,0.06)' : 'transparent', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, opacity: addItem.isPending ? 0.6 : 1 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="block" size={18} color="var(--on-surface-variant)" />
                    </div>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 600, color: selectedTariffId === null ? 'var(--on-surface)' : 'var(--on-surface-variant)' }}>Без тарифа</span>
                      <p style={{ fontSize: 11, color: 'rgba(204,195,216,0.4)', margin: '2px 0 0' }}>Не добавлять позицию</p>
                    </div>
                  </button>

                  <button type="button" onClick={confirmTariff} disabled={addItem.isPending || setGuests.isPending}
                    style={{ gridColumn: '1 / -1', marginTop: 4, width: '100%', padding: '15px 0', borderRadius: 16, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #38BDF8, #0EA5E9)', color: '#fff', fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: (addItem.isPending || setGuests.isPending) ? 0.7 : 1 }}>
                    {(addItem.isPending || setGuests.isPending) ? 'Добавляем…' : 'Готово'}
                  </button>
                </div>

                {tariffItems.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', textAlign: 'center', margin: '12px 0 0' }}>Тарифы не настроены — клиент привязан без тарифа.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Rental time editor */}
      {showRentalEdit && (
        <div
          onClick={e => { if (e.target === e.currentTarget && !updateRental.isPending) setShowRentalEdit(false) }}
          style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,21,38,0.8)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', padding: 16 }}
        >
          <div className="glass-l1" style={{ borderRadius: 24, padding: 24, width: 'min(420px,100%)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <Icon name="meeting_room" size={22} color="#A78BFA" />
              <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0 }}>Время аренды</h2>
            </div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', marginBottom: 6 }}>Начало</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input type="date" value={editStart.slice(0, 10)} onChange={e => setEditStart(e.target.value ? `${e.target.value}T${editStart.slice(11, 16) || '00:00'}` : '')} className="glass-l2" style={{ flex: 1, minWidth: 0, padding: '12px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)', fontSize: 14, background: 'rgba(29,26,36,0.9)', boxSizing: 'border-box' }} />
              <TimeInput24 value={editStart.slice(11, 16)} onChange={t => setEditStart(`${editStart.slice(0, 10) || new Date().toISOString().slice(0, 10)}T${t}`)} style={{ flex: 1 }} />
            </div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', marginBottom: 6 }}>Конец</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="date" value={editEnd.slice(0, 10)} onChange={e => setEditEnd(e.target.value ? `${e.target.value}T${editEnd.slice(11, 16) || '00:00'}` : '')} className="glass-l2" style={{ flex: 1, minWidth: 0, padding: '12px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)', fontSize: 14, background: 'rgba(29,26,36,0.9)', boxSizing: 'border-box' }} />
              <TimeInput24 value={editEnd.slice(11, 16)} onChange={t => setEditEnd(`${editEnd.slice(0, 10) || editStart.slice(0, 10) || new Date().toISOString().slice(0, 10)}T${t}`)} style={{ flex: 1 }} />
            </div>
            <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '0 0 14px' }}>
              {editEnd
                ? <button type="button" onClick={() => setEditEnd('')} style={{ background: 'none', border: 'none', color: '#A78BFA', fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Сбросить конец → живой счётчик до оплаты</button>
                : 'Пусто = живой счётчик до момента оплаты'}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setShowRentalEdit(false)} disabled={updateRental.isPending} style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Отмена</button>
              <button type="button" onClick={saveRental} disabled={updateRental.isPending || !editStart} style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)', color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', opacity: (updateRental.isPending || !editStart) ? 0.5 : 1 }}>{updateRental.isPending ? '...' : 'Сохранить'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Full Payment Drawer */}
      {showPayment && (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(13,21,38,0.80)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowPayment(false) }}
        >
          <div
            className="glass-l1"
            style={{
              borderRadius: 32, maxWidth: 560, width: '100%',
              maxHeight: '92dvh', overflowY: 'auto',
              boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }}
          >
            {/* ===== SCREEN: METHODS ===== */}
            {payScreen === 'methods' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
                  <div style={{
                    width: 56, height: 56, borderRadius: 16, flexShrink: 0,
                    background: '#8B5CF6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 4px 20px rgba(139,92,246,0.35)',
                  }}>
                    <Icon name="payments" size={28} color="#fff" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>ОПЛАТА</h2>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>
                      ВЫБЕРИТЕ МЕТОД
                    </p>
                  </div>
                  <button
                    onClick={() => setShowPayment(false)}
                    style={{ width: 32, height: 32, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>

                {player && (
                  <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, marginBottom: 16, border: '1px solid rgba(139,92,246,0.2)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: player.photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(76,215,246,0.35))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#A78BFA' }}>
                      {player.photoUrl
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={player.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : getInitials(player.nickname)}
                    </div>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: 'var(--on-surface)' }}>{player.nickname}</span>
                    {playerDebt > 0 ? (
                      <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '3px 8px', background: 'rgba(244,63,94,0.1)', color: 'var(--danger)' }}>
                        Долг {playerDebt.toLocaleString('ru')} ₽
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '3px 8px', background: 'rgba(6,182,212,0.1)', color: 'var(--pay-deposit)' }}>
                        Депозит {availableDeposit.toLocaleString('ru')} ₽
                      </span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 6, padding: '3px 8px', background: 'rgba(245,158,11,0.1)', color: 'var(--pay-bonus)' }}>
                      ★ {playerBonus.toLocaleString('ru')}
                    </span>
                  </div>
                )}

                <div style={{
                  textAlign: 'center', padding: '16px 0',
                  borderRadius: 16,
                  background: 'rgba(139,92,246,0.06)',
                  border: '1px solid rgba(139,92,246,0.15)',
                  marginBottom: 20,
                }}>
                  <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', margin: '0 0 4px' }}>
                    ИТОГО К ОПЛАТЕ:
                  </p>
                  <p style={{ fontSize: 36, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: '#A78BFA', margin: 0 }}>
                    {total.toLocaleString('ru')} ₽
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {Object.entries(METHOD_CONFIGS).map(([id, cfg]) => {
                    // «Депозит» доступен только при положительном депозите (не при долге).
                    const disabled = (id === 'debt' && !check?.playerId) || (id === 'deposit' && availableDeposit <= 0)
                    const wide = id === 'split' // «Раздельная» — широкая плитка во всю строку
                    return (
                      <button
                        key={id}
                        onClick={() => !disabled && handleMethodClick(id)}
                        disabled={disabled}
                        className="glass-l2"
                        style={{
                          gridColumn: wide ? '1 / -1' : undefined,
                          minHeight: 96, padding: '14px 12px', borderRadius: 16, border: 'none',
                          cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left',
                          background: `rgba(${cfg.rgb},0.06)`,
                          boxShadow: `inset 0 0 0 1px rgba(${cfg.rgb},0.18)`,
                          transition: 'all 0.18s',
                          display: 'flex',
                          flexDirection: wide ? 'row' : 'column',
                          alignItems: wide ? 'center' : 'flex-start',
                          justifyContent: wide ? 'center' : 'space-between',
                          gap: wide ? 10 : 8,
                          opacity: disabled ? 0.35 : 1,
                        }}
                        onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = `rgba(${cfg.rgb},0.16)`; e.currentTarget.style.boxShadow = `0 0 22px rgba(${cfg.rgb},0.22), inset 0 0 0 1px rgba(${cfg.rgb},0.45)` } }}
                        onMouseLeave={e => { e.currentTarget.style.background = `rgba(${cfg.rgb},0.06)`; e.currentTarget.style.boxShadow = `inset 0 0 0 1px rgba(${cfg.rgb},0.18)` }}
                      >
                        <div style={{
                          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                          background: `rgba(${cfg.rgb},0.16)`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon name={cfg.icon} size={22} color={cfg.color} />
                        </div>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--on-surface)', margin: 0 }}>{cfg.label}</p>
                          {id === 'bonus' && player && <p style={{ fontSize: 10, color: 'var(--pay-bonus)', margin: '2px 0 0', fontVariantNumeric: 'tabular-nums' }}>{playerBonus.toLocaleString('ru')} б.</p>}
                          {id === 'deposit' && player && <p style={{ fontSize: 10, color: 'var(--pay-deposit)', margin: '2px 0 0', fontVariantNumeric: 'tabular-nums' }}>{availableDeposit.toLocaleString('ru')} ₽</p>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ===== SCREEN: BONUS ===== */}
            {payScreen === 'bonus' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <button onClick={() => setPayScreen('methods')} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>БОНУСНАЯ ОПЛАТА</h2>
                </div>

                {player && (
                  <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, marginBottom: 20, border: '1px solid rgba(245,158,11,0.2)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: player.photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(76,215,246,0.35))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#A78BFA' }}>
                      {player.photoUrl
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={player.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : getInitials(player.nickname)}
                    </div>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: 'var(--on-surface)' }}>{player.nickname}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pay-bonus)' }}>★ {playerBonus.toLocaleString('ru')} бонусов</span>
                  </div>
                )}

                {(() => {
                  const maxBonus = Math.min(playerBonus, Math.floor(total * (bonusMaxSpendPct / 100)))
                  const step = Math.max(10, Math.round(maxBonus / 20) * 10) || 10
                  const bonusRemainder = total - bonusAmount
                  return (
                    <>
                      <div style={{ marginBottom: 16 }}>
                        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--on-surface-variant)', marginBottom: 8 }}>
                          Сумма бонусов (макс. {maxBonus.toLocaleString('ru')})
                        </p>
                        <input type="range" min={0} max={maxBonus} step={step} value={bonusAmount} onChange={e => setBonusAmount(Number(e.target.value))} style={{ width: '100%', accentColor: '#f59e0b' }} />
                        <p style={{ fontSize: 28, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: 'var(--pay-bonus)', textAlign: 'center', margin: '8px 0' }}>
                          {bonusAmount.toLocaleString('ru')} бонусов
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                        {[0.25, 0.5, 0.75, 1].map(pct => (
                          <button key={pct} onClick={() => setBonusAmount(Math.min(maxBonus, Math.round(maxBonus * pct / step) * step))} className="glass-l2" style={{ flex: 1, padding: '8px 0', borderRadius: 10, border: '1px solid rgba(245,158,11,0.2)', cursor: 'pointer', color: 'var(--pay-bonus)', fontSize: 12, fontWeight: 700 }}>
                            {Math.round(pct * 100)}%
                          </button>
                        ))}
                      </div>
                      {bonusRemainder > 0.01 && (
                        <div className="glass-l2" style={{ padding: '12px 14px', borderRadius: 12, marginBottom: 16, border: '1px solid rgba(255,255,255,0.07)' }}>
                          <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: '0 0 4px' }}>Остаток к доплате:</p>
                          <p style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--on-surface)', margin: 0 }}>{bonusRemainder.toLocaleString('ru')} ₽</p>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          if (bonusAmount > 0) {
                            addSplitPart({ method: 'bonus', amount: bonusAmount, label: 'Бонусы' })
                            if (bonusRemainder > 0.01) addSplitPart({ method: 'cash', amount: bonusRemainder, label: 'Наличные (остаток)' })
                          }
                          setPayScreen('split')
                        }}
                        disabled={bonusAmount === 0}
                        style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: bonusAmount === 0 ? 0.5 : 1 }}
                      >
                        ПРИМЕНИТЬ
                      </button>
                    </>
                  )
                })()}
              </div>
            )}

            {/* ===== SCREEN: DEPOSIT ===== */}
            {payScreen === 'deposit' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <button onClick={() => setPayScreen('methods')} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>ОПЛАТА ДЕПОЗИТОМ</h2>
                </div>
                {player && (
                  <div className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, marginBottom: 20, border: '1px solid rgba(6,182,212,0.2)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, overflow: 'hidden', background: player.photoUrl ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(76,215,246,0.35))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#A78BFA' }}>
                      {player.photoUrl
                        ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={player.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : getInitials(player.nickname)}
                    </div>
                    <span style={{ flex: 1, fontWeight: 700, fontSize: 14, color: 'var(--on-surface)' }}>{player.nickname}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pay-deposit)' }}>{availableDeposit.toLocaleString('ru')} ₽</span>
                  </div>
                )}
                {(() => {
                  const maxDeposit = Math.min(Math.max(0, playerBalance), total)
                  return (
                    <>
                      <div style={{ marginBottom: 16 }}>
                        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--on-surface-variant)', marginBottom: 8 }}>Сумма депозита (макс. {maxDeposit.toLocaleString('ru')} ₽)</p>
                        <input type="range" min={0} max={maxDeposit} step={10} value={depositAmt} onChange={e => setDepositAmt(Number(e.target.value))} style={{ width: '100%', accentColor: '#06b6d4' }} />
                        <p style={{ fontSize: 28, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: 'var(--pay-deposit)', textAlign: 'center', margin: '8px 0' }}>{depositAmt.toLocaleString('ru')} ₽</p>
                      </div>
                      <button onClick={() => { if (depositAmt > 0) addSplitPart({ method: 'deposit', amount: depositAmt, label: 'Депозит' }); setPayScreen('split') }} disabled={depositAmt === 0} style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #06b6d4, #0891b2)', color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: depositAmt === 0 ? 0.5 : 1 }}>
                        ПРИМЕНИТЬ
                      </button>
                    </>
                  )
                })()}
              </div>
            )}

            {/* ===== SCREEN: CERTIFICATE ===== */}
            {payScreen === 'certificate' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <button onClick={() => setPayScreen('methods')} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>СЕРТИФИКАТ</h2>
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <input value={certCode} onChange={e => { setCertCode(e.target.value.toUpperCase()); setCertInfo(null); setCertError('') }} placeholder="КОД СЕРТИФИКАТА" className="glass-l2" style={{ flex: 1, padding: '14px 16px', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', color: 'var(--on-surface)', fontSize: 15, fontWeight: 700, letterSpacing: '0.05em', outline: 'none', background: 'none' }} />
                  <button onClick={lookupCertificate} disabled={certLoading || !certCode.trim()} style={{ padding: '14px 20px', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'rgba(139,92,246,0.2)', color: '#A78BFA', fontSize: 13, fontWeight: 700, opacity: (certLoading || !certCode.trim()) ? 0.5 : 1 }}>
                    {certLoading ? '...' : 'НАЙТИ'}
                  </button>
                </div>
                {certError && <p style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 12 }}>{certError}</p>}
                {certInfo && (
                  <>
                    <div className="glass-l2" style={{ padding: '14px 16px', borderRadius: 14, marginBottom: 16, border: '1px solid rgba(251,191,36,0.2)' }}>
                      <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '0 0 4px' }}>Сертификат {certInfo.code}</p>
                      <p style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: 'var(--pay-cert, #fbbf24)', margin: 0 }}>{parseFloat(certInfo.balance).toLocaleString('ru')} ₽</p>
                      <p style={{ fontSize: 10, color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>Номинал: {parseFloat(certInfo.nominal).toLocaleString('ru')} ₽</p>
                    </div>
                    <button onClick={() => { const certBal = parseFloat(certInfo.balance); const certUsed = Math.min(certBal, total); addSplitPart({ method: 'certificate', amount: certUsed, label: `Сертификат ${certInfo.code}` }); setPayScreen('split') }} style={{ width: '100%', padding: '14px 0', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #fbbf24, #d97706)', color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      ПРИМЕНИТЬ
                    </button>
                  </>
                )}
              </div>
            )}

            {/* ===== SCREEN: SBP SURCHARGE (8% эквайринг) ===== */}
            {payScreen === 'sbp_surcharge' && (() => {
              const sbpBase = remaining > 0 ? remaining : total
              const sbpWith = Math.round(sbpBase * 1.08)
              return (
                <div style={{ padding: '28px 28px 32px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    <button onClick={() => setPayScreen('methods')} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name="arrow_back" size={18} />
                    </button>
                    <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>СБП — ЭКВАЙРИНГ</h2>
                  </div>

                  <div className="glass-l2" style={{ textAlign: 'center', padding: '20px 16px', borderRadius: 16, marginBottom: 20, border: '1px solid rgba(139,92,246,0.2)' }}>
                    <Icon name="qr_code_2" size={32} color="#A78BFA" style={{ marginBottom: 8 }} />
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--on-surface)', margin: '0 0 6px' }}>Добавить комиссию эквайринга 8%?</p>
                    <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>
                      Без комиссии: {sbpBase.toLocaleString('ru')} ₽ · С комиссией: {sbpWith.toLocaleString('ru')} ₽
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => startQrPayment(false)}
                      className="glass-l2"
                      style={{ flex: 1, padding: '16px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}
                    >
                      Нет
                    </button>
                    <button
                      onClick={() => startQrPayment(true)}
                      style={{ flex: 1, padding: '16px 0', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)', color: '#fff', fontSize: 14, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', boxShadow: '0 4px 20px rgba(139,92,246,0.35)' }}
                    >
                      Да (+8%)
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* ===== SCREEN: QR (Platega SBP) ===== */}
            {payScreen === 'qr' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <button
                    onClick={() => { setPayScreen('methods'); setQrTransactionId(null); setQrDataUrl(null); setQrStatus('pending'); setQrError('') }}
                    style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>СБП / QR-ОПЛАТА</h2>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>
                      {qrAmount.toLocaleString('ru')} ₽
                    </p>
                  </div>
                </div>

                {qrLoading && (
                  <div style={{ textAlign: 'center', padding: '60px 0' }}>
                    <div style={{ width: 48, height: 48, borderRadius: '50%', border: '3px solid rgba(139,92,246,0.2)', borderTopColor: '#8B5CF6', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
                    <p style={{ color: 'var(--on-surface-variant)', fontSize: 13 }}>Генерируем QR-код...</p>
                  </div>
                )}

                {qrError && (
                  <div className="glass-l2" style={{ padding: '16px', borderRadius: 14, border: '1px solid rgba(244,63,94,0.25)', marginBottom: 16 }}>
                    <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon name="error" size={18} color="var(--danger)" />
                      {qrError}
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => startQrPayment(qrSurcharge8)}
                        style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(139,92,246,0.2)', color: '#A78BFA', fontSize: 12, fontWeight: 700 }}
                      >
                        Попробовать снова
                      </button>
                      {qrRedirectUrl && (
                        <a
                          href={qrRedirectUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', cursor: 'pointer', background: 'transparent', color: 'var(--on-surface-variant)', fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                          <Icon name="open_in_new" size={14} />
                          Открыть страницу оплаты
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {!qrError && !qrDataUrl && qrRedirectUrl && qrStatus === 'pending' && (
                  <div className="glass-l2" style={{ padding: '18px 16px', borderRadius: 14, marginBottom: 16, border: '1px solid rgba(139,92,246,0.2)', textAlign: 'center' }}>
                    <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: '0 0 12px' }}>
                      QR пока недоступен — откройте страницу оплаты. Подтверждение придёт автоматически.
                    </p>
                    <a
                      href={qrRedirectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 12, background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
                    >
                      <Icon name="open_in_new" size={16} />
                      Открыть страницу оплаты
                    </a>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--on-surface-variant)', fontSize: 13, marginTop: 16 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8B5CF6', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      Ожидаем подтверждение оплаты...
                    </div>
                  </div>
                )}

                {qrDataUrl && qrStatus === 'pending' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
                      <div style={{
                        padding: 12, borderRadius: 20,
                        background: '#fff',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                      }}>
                        <img src={qrDataUrl} alt="QR для оплаты" style={{ width: 240, height: 240, display: 'block' }} />
                      </div>
                    </div>

                    <div className="glass-l2" style={{ padding: '14px 16px', borderRadius: 14, marginBottom: 16, border: '1px solid rgba(139,92,246,0.2)', textAlign: 'center' }}>
                      <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: '0 0 4px' }}>
                        Отсканируйте в приложении банка
                      </p>
                      <p style={{ fontSize: 24, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: '#A78BFA', margin: 0 }}>
                        {qrAmount.toLocaleString('ru')} ₽
                      </p>
                      {qrSurcharge8 && (
                        <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '6px 0 0' }}>
                          Сумма с комиссией 8%: {qrAmount.toLocaleString('ru')} ₽ (товары {qrBaseAmount.toLocaleString('ru')} ₽)
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--on-surface-variant)', fontSize: 13 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#8B5CF6', animation: 'pulse 1.5s ease-in-out infinite' }} />
                      Ожидаем оплату...
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ===== SCREEN: SPLIT ===== */}
            {payScreen === 'split' && (
              <div style={{ padding: '28px 28px 32px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                  <button onClick={() => setPayScreen('methods')} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="arrow_back" size={18} />
                  </button>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 900, textTransform: 'uppercase', margin: 0, color: 'var(--on-surface)' }}>ПОДТВЕРЖДЕНИЕ</h2>
                    <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', margin: '4px 0 0' }}>
                      ИТОГО: {total.toLocaleString('ru')} ₽
                    </p>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ height: 10, borderRadius: 9999, background: 'rgba(255,255,255,0.05)', overflow: 'hidden', display: 'flex' }}>
                    {splitParts.map((p, i) => (
                      <div key={i} style={{ height: '100%', width: `${Math.min(100, (p.amount / total) * 100)}%`, background: methodColor(p.method), opacity: 0.85 }} />
                    ))}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
                    <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>ОПЛАЧЕНО: {splitSum.toLocaleString('ru')} ₽</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: remaining > 0.01 ? '#8B5CF6' : 'var(--success)' }}>
                      {remaining > 0.01 ? `ОСТАТОК: ${remaining.toLocaleString('ru')} ₽` : '✓ ПОЛНОСТЬЮ'}
                    </span>
                  </div>
                  {prepaidAmount > 0.01 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(236,72,153,0.1)' }}>
                      <span style={{ fontSize: 11, color: '#EC4899', fontWeight: 700 }}>Предоплата участия: {prepaidAmount.toLocaleString('ru')} ₽</span>
                      <span style={{ fontSize: 11, color: 'var(--on-surface-variant)' }}>итог {total.toLocaleString('ru')} ₽ · к оплате {due.toLocaleString('ru')} ₽</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {splitParts.map((part, idx) => (
                    <div key={idx} className="glass-l2" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                      <Icon name={methodIcon(part.method)} size={18} color={methodColor(part.method)} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>{part.label ?? methodLabel(part.method)}</span>
                      <span style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: methodColor(part.method) }}>{part.amount.toLocaleString('ru')} ₽</span>
                      <button onClick={() => removeSplitPart(idx)} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(244,63,94,0.1)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Композитор tender'ов: метод + сумма + «Добавить». Показываем пока есть остаток. */}
                {remaining > 0.01 && (
                  <div className="glass-l2" style={{ padding: '14px', borderRadius: 16, marginBottom: 16, border: '1px solid rgba(255,255,255,0.08)' }}>
                    <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--on-surface-variant)', margin: '0 0 10px' }}>
                      Добавить оплату · остаток {remaining.toLocaleString('ru')} ₽
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(72px, 1fr))', gap: 6, marginBottom: 10 }}>
                      {SPLIT_MANUAL_METHODS.map(m => {
                        const cfg = METHOD_CONFIGS[m]
                        const mDisabled = (m === 'debt' && !check?.playerId) || (m === 'deposit' && availableDeposit <= 0)
                        const selected = splitMethod === m
                        return (
                          <button
                            key={m}
                            onClick={() => !mDisabled && setSplitMethod(m)}
                            disabled={mDisabled}
                            style={{
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                              padding: '8px 4px', borderRadius: 10, cursor: mDisabled ? 'not-allowed' : 'pointer',
                              border: `1px solid ${selected ? `rgba(${cfg.rgb},0.5)` : 'rgba(255,255,255,0.08)'}`,
                              background: selected ? `rgba(${cfg.rgb},0.14)` : 'rgba(255,255,255,0.03)',
                              opacity: mDisabled ? 0.35 : 1,
                            }}
                          >
                            <Icon name={cfg.icon} size={18} color={cfg.color} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: selected ? 'var(--on-surface)' : 'var(--on-surface-variant)' }}>{cfg.label}</span>
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="number" inputMode="decimal" min="0"
                        value={splitAmtInput}
                        onChange={e => setSplitAmtInput(e.target.value)}
                        placeholder={`${Math.round(remaining)}`}
                        className="glass-l2"
                        style={{ flex: 1, minWidth: 0, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', color: 'var(--on-surface)', fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', background: 'rgba(255,255,255,0.04)', boxSizing: 'border-box', outline: 'none' }}
                      />
                      <button
                        onClick={() => setSplitAmtInput(String(Math.round(remaining)))}
                        className="glass-l2"
                        style={{ padding: '0 14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface-variant)', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}
                      >
                        Весь
                      </button>
                      <button
                        onClick={addComposerPart}
                        disabled={!(parseFloat((splitAmtInput || '').replace(',', '.')) > 0)}
                        style={{ padding: '0 18px', borderRadius: 12, border: 'none', cursor: 'pointer', background: 'rgba(139,92,246,0.2)', color: '#A78BFA', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', opacity: !(parseFloat((splitAmtInput || '').replace(',', '.')) > 0) ? 0.5 : 1 }}
                      >
                        Добавить
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setPayScreen('methods')} className="glass-l2" style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', color: 'var(--on-surface-variant)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    НАЗАД
                  </button>
                  <button
                    onClick={finishPayment}
                    disabled={remaining > 0.01 || splitParts.length === 0 || isProcessing || pay.isPending}
                    style={{ flex: 2, padding: '13px 0', borderRadius: 14, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #8B5CF6, #4cd7f6)', color: '#fff', fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', boxShadow: '0 4px 20px rgba(139,92,246,0.35)', opacity: (remaining > 0.01 || splitParts.length === 0 || isProcessing || pay.isPending) ? 0.5 : 1 }}
                  >
                    {pay.isPending || isProcessing ? 'ПРОВОДИМ...' : 'ЗАВЕРШИТЬ ОПЛАТУ'}
                  </button>
                </div>
                {pay.isError && (
                  <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 10, textAlign: 'center' }}>
                    {(pay.error as Error)?.message ?? 'Ошибка оплаты'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Responsive CSS */}
      <style>{`
        .check-layout {
          position: relative;
        }
        /* ПК: сумма слева (margin-right:auto), инструменты + «К оплате» справа. */
        .check-pay-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .check-pay-money { margin-right: auto; }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* ── Плашка оплаты как плавающий «остров» навигации (телефон/планшет) ──
           Точные размеры и позиция нижней панели: fixed, left/right 14,
           bottom = safe + 6 (+ standalone-смещение), радиус 28, то же стекло. */
        @media (max-width: 1023px) {
          /* Двухуровневый «остров»: та же ширина/позиция/радиус, что у нав-панели
             (left/right 14, bottom safe+6, radius 28), высотой ~2 уровня нав-панели.
             Верх — инструменты (таймер/скидка/+), низ — сумма + «К оплате». */
          .check-pay-bar {
            position: fixed !important;
            left: 14px !important;
            right: 14px !important;
            bottom: calc(env(safe-area-inset-bottom) + 6px) !important;
            z-index: 30 !important;
            padding: 10px 14px !important;
            border: 1px solid rgba(255,255,255,0.12) !important;
            border-radius: 28px !important;
            background: rgba(24,20,32,0.6) !important;
            backdrop-filter: blur(26px) saturate(180%) !important;
            -webkit-backdrop-filter: blur(24px) saturate(180%) !important;
            box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.25) !important;
          }
          /* Скидки показаны секцией в теле чека (видны на ПК и телефоне), а не в
             компактном островке — он остаётся двухуровневым. */
          /* Грид: row 1 — инструменты, row 2 — сумма + оплата. */
          .check-pay-row {
            display: grid !important;
            grid-template-columns: 1fr auto !important;
            grid-template-areas: "tools tools" "money go" !important;
            align-items: center !important;
            gap: 8px 10px !important;
          }
          .check-pay-actions {
            grid-area: tools !important;
            display: flex !important; gap: 8px !important;
            justify-content: flex-start !important;
          }
          .check-pay-money { grid-area: money !important; margin: 0 !important; }
          .check-pay-go { grid-area: go !important; }
          .check-pay-label { font-size: 9px !important; letter-spacing: 0.06em !important; margin: 0 0 1px !important; }
          .check-pay-amount { font-size: 22px !important; }
          /* «Добавить» и «Скидка» → круглые иконки-кнопки (как FAB у навигации). */
          .check-pay-add {
            width: 44px !important; height: 44px !important;
            padding: 0 !important; border-radius: 50% !important; gap: 0 !important; flex-shrink: 0 !important;
          }
          .check-pay-add-label { display: none !important; }
          /* Кнопка-таймер аренды: капсула с иконкой+суммой (сумма видна). */
          .check-pay-timer {
            height: 44px !important; padding: 0 12px !important;
            font-size: 12px !important; border-radius: 14px !important; gap: 5px !important;
          }
          .check-pay-go {
            height: 46px !important; padding: 0 22px !important;
            display: flex !important; align-items: center !important; justify-content: center !important;
            font-size: 13px !important; border-radius: 16px !important; flex-shrink: 0 !important;
            white-space: nowrap !important;
          }
          /* Контент чека докручивается выше плавающей плашки (выше из-за 2 уровней). */
          .check-items { padding-bottom: var(--bottom-nav-clear, 96px) !important; }
        }
        /* iOS standalone: опускаем остров ровно как нав-панель (см. globals.css). */
        @media (display-mode: standalone) and (max-width: 1023px) {
          .check-pay-bar {
            bottom: calc(env(safe-area-inset-bottom) + 6px + (100svh - 100lvh)) !important;
          }
        }
      `}</style>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancelCheck.mutate()}
        title="Отменить чек?"
        message="Чек будет отменён без оплаты. Действие необратимо."
        confirmLabel="Отменить чек"
        cancelLabel="Назад"
        danger
        loading={cancelCheck.isPending}
      />
    </div>
  )
}
