'use client'
/**
 * Публичный конструктор бронирования (без авторизации, клуб по Host).
 *
 * Поток: локация (Штаб Titan / выезд) → кабинка|адрес → тариф (часы + бейдж
 * экономии) → дата/время → контакт → отправка. Гость «узнаётся» по claim-токенам в
 * localStorage: при повторном открытии показываем его брони со статусом и правками.
 * Стиль — «тихая роскошь»: тёмный фон, единый violet-акцент, glass-карточки.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'

interface Cabin { id: string; name: string; capacity: number | null; hourlyRate: string }
interface Tariff { hours: number; price: string }
interface Config { enabled: boolean; clubName?: string; venueAddress?: string; hoursOpen?: string; hoursClose?: string; cabins?: Cabin[]; tariffs?: Tariff[] }
interface MyBooking {
  id: string; status: string; event_status: string | null; location: string | null; address: string | null; zone_name: string | null
  tariff_hours: number | null; guests: number | null; starts_at: string; name?: string; phone?: string; comment?: string | null
}
// token = null — бронь найдена только по телефону (lookup): показываем без правок.
interface MineItem { token: string | null; b: MyBooking }

const TOKENS_KEY = 'titan_book_tokens'
const VIOLET = '#8B5CF6'

const STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  new: { label: 'Ожидает подтверждения', color: '#F59E0B', icon: 'schedule' },
  clarify: { label: 'Требует уточнения', color: '#FB923C', icon: 'info' },
  confirmed: { label: 'Подтверждена', color: '#10B981', icon: 'check_circle' },
  cancelled: { label: 'Отменена', color: '#94A3B8', icon: 'close' },
  done: { label: 'Завершена', color: '#8B5CF6', icon: 'check_circle' },
}

// Актуальный статус для клиента: пока бронь не подтверждена — её статус; после
// подтверждения отражаем состояние связанного мероприятия (уточнение/отмена/завершение).
function effStatus(b: MyBooking): string {
  if (b.status === 'new') return 'new'
  if (b.status === 'cancelled') return 'cancelled'
  const es = b.event_status
  if (es === 'cancelled') return 'cancelled'
  if (es === 'completed') return 'done'
  if (es === 'needs_clarification') return 'clarify'
  if (es === 'active' || es === 'planned') return 'confirmed'
  return b.status === 'done' ? 'done' : 'confirmed'
}

const money = (v: string | number) => `${Math.round(Number(v)).toLocaleString('ru-RU')} ₽`
function mskToday(): string { return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10) }
function fmtWhen(iso: string): string {
  try { return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}
function loadTokens(): string[] { try { return JSON.parse(localStorage.getItem(TOKENS_KEY) || '[]') } catch { return [] } }
function saveToken(t: string) { try { const a = loadTokens(); if (!a.includes(t)) localStorage.setItem(TOKENS_KEY, JSON.stringify([t, ...a])) } catch { /* */ } }
const PHONE_KEY = 'titan_book_phone'
function savePhone(p: string) { try { if (p) localStorage.setItem(PHONE_KEY, p) } catch { /* */ } }

// ── shared styles ──
const wrap: React.CSSProperties = { minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 'max(18px, env(safe-area-inset-top)) 16px calc(96px + env(safe-area-inset-bottom))' }
const shell: React.CSSProperties = { width: '100%', maxWidth: 460 }
const glass: React.CSSProperties = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(20px)', borderRadius: 22 }
const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 13, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', color: 'var(--on-surface)', fontSize: 16 }
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, color: 'var(--on-surface-variant)', margin: '14px 0 6px', display: 'block' }
const optCard = (active: boolean): React.CSSProperties => ({
  ...glass, padding: 16, cursor: 'pointer', textAlign: 'left', width: '100%', color: 'var(--on-surface)',
  border: active ? `1.5px solid ${VIOLET}` : '1px solid rgba(255,255,255,0.1)',
  boxShadow: active ? `0 0 0 3px ${VIOLET}22` : 'none', transition: 'transform .12s, border-color .15s', display: 'block',
})

export default function BookPage() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [loading, setLoading] = useState(true)
  const [mine, setMine] = useState<MineItem[]>([])
  const [view, setView] = useState<'phone' | 'mine' | 'wizard'>('phone')
  const [entryPhone, setEntryPhone] = useState('')

  const [fixedLoc, setFixedLoc] = useState<'titan' | 'exit' | null>(null)
  const [step, setStep] = useState(0)
  const [location, setLocation] = useState<'titan' | 'exit' | ''>('')
  const [title, setTitle] = useState('')
  const [address, setAddress] = useState('')
  const [cabinId, setCabinId] = useState('')
  const [hours, setHours] = useState<number | null>(null)
  const [dd, setDd] = useState(''); const [mm, setMm] = useState(''); const [yyyy, setYyyy] = useState('')
  const [hh, setHh] = useState(''); const [mi, setMi] = useState('')
  const [guests, setGuests] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Дата/время собираются из полей ввода (ДД ММ ГГГГ / ЧЧ ММ, 24ч) — не нативный пикер.
  const date = dd.length === 2 && mm.length === 2 && yyyy.length === 4 ? `${yyyy}-${mm}-${dd}` : ''
  const time = hh.length === 2 && mi.length === 2 ? `${hh}:${mi}` : ''

  // Узнавание клиента: по токенам localStorage (то же устройство — бронь можно править)
  // + по телефону (кросс-устройство, lookup). Lookup токен управления не отдаёт
  // (безопасность: знание номера не даёт права менять чужую бронь), поэтому брони,
  // найденные только по телефону, показываем без правок (token = null).
  const recognize = async (rawPhone: string): Promise<MineItem[]> => {
    const list: MineItem[] = []
    const seen = new Set<string>()
    for (const t of loadTokens()) {
      const b = await api.get<{ booking: MyBooking }>(`/bookings/public/${t}`).then((r) => r.booking).catch(() => null)
      if (b && !seen.has(b.id)) { list.push({ token: t, b }); seen.add(b.id) }
    }
    if (rawPhone.replace(/\D/g, '').length >= 10) {
      try {
        const r = await api.get<{ bookings: MyBooking[] }>(`/bookings/public/lookup?phone=${encodeURIComponent(rawPhone)}`)
        for (const b of r.bookings ?? []) if (!seen.has(b.id)) { list.push({ token: null, b }); seen.add(b.id) }
      } catch { /* */ }
    }
    list.sort((x, y) => Date.parse(y.b.starts_at) - Date.parse(x.b.starts_at))
    if (rawPhone) savePhone(rawPhone)
    return list
  }

  useEffect(() => {
    (async () => {
      try {
        const c = await api.get<Config>('/bookings/public/config'); setCfg(c)
        const params = new URLSearchParams(window.location.search)
        const p = params.get('loc'); if (p === 'titan' || p === 'exit') { setFixedLoc(p); setLocation(p); setStep(1) }
        const savedPhone = params.get('phone') || localStorage.getItem(PHONE_KEY) || ''
        if (savedPhone) { setEntryPhone(savedPhone); setPhone(savedPhone) }
        const list = await recognize(savedPhone)
        if (list.length) { setMine(list); setView('mine') } else setView('phone')
      } catch { setCfg({ enabled: false }); setView('phone') } finally { setLoading(false) }
    })()
  }, [])

  const continueFromPhone = async () => {
    const ph = entryPhone.trim()
    setPhone(ph)
    const list = await recognize(ph)
    setMine(list)
    setView(list.length ? 'mine' : 'wizard')
  }

  const tariffs = cfg?.tariffs ?? []
  const cabins = cfg?.cabins ?? []
  const cabin = cabins.find((x) => x.id === cabinId)

  // Экономия: %% против самой дорогой ставки за час среди тарифов.
  const savings = useMemo(() => {
    const m = new Map<number, number>()
    if (tariffs.length < 2) return m
    const maxPerHour = Math.max(...tariffs.map((t) => Number(t.price) / t.hours))
    for (const t of tariffs) {
      const s = Math.round((1 - (Number(t.price) / t.hours) / maxPerHour) * 100)
      if (s > 0) m.set(t.hours, s)
    }
    return m
  }, [tariffs])

  const refreshMine = async () => {
    setMine(await recognize(entryPhone || phone))
  }

  const resetWizard = () => { setStep(fixedLoc ? 1 : 0); setLocation(fixedLoc ?? ''); setTitle(''); setAddress(''); setCabinId(''); setHours(null); setDd(''); setMm(''); setYyyy(''); setHh(''); setMi(''); setGuests(''); setComment(''); setError('') }

  const canNext = (): boolean => {
    if (step === 0) return !!location
    if (step === 1) return location === 'exit' ? address.trim().length > 3 : (cabins.length === 0 || !!cabinId)
    if (step === 2) return hours != null
    if (step === 3) return !!date && !!time
    if (step === 4) return name.trim().length > 0 && phone.replace(/\D/g, '').length >= 10
    return true
  }

  const submit = async () => {
    setError(''); setSubmitting(true)
    try {
      const r = await api.post<{ token: string | null }>('/bookings/public', {
        location, title: title.trim() || undefined,
        address: location === 'exit' ? address.trim() : undefined,
        spaceId: location === 'titan' ? (cabinId || undefined) : undefined,
        tariffHours: hours ?? undefined,
        guests: guests ? Number(guests) : undefined,
        date, time, name: name.trim(), phone: phone.trim(), comment: comment.trim() || undefined,
      })
      // token = null — повторная отправка той же заявки (сервер вернул уже созданную).
      if (r.token) saveToken(r.token)
      await refreshMine()
      resetWizard(); setView('mine')
    } catch (e: any) { setError(e?.message || 'Не удалось отправить заявку') } finally { setSubmitting(false) }
  }

  if (loading) return <div style={{ ...wrap, justifyContent: 'center' }}><div style={{ color: 'var(--on-surface-variant)' }}>Загрузка…</div></div>
  if (!cfg?.enabled) return (
    <div style={{ ...wrap, justifyContent: 'center' }}><div style={{ ...glass, padding: 24, textAlign: 'center', ...shell }}>
      <p style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>Онлайн-бронирование недоступно</p>
      <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', marginTop: 8 }}>Свяжитесь с заведением напрямую.</p>
    </div></div>
  )

  // ── Экран ввода телефона (первый шаг) ──
  if (view === 'phone') return (
    <div style={{ ...wrap, justifyContent: 'center' }}><div style={shell}>
      <Header clubName={cfg.clubName} sub={fixedLoc === 'exit' ? 'Бронь выезда' : fixedLoc === 'titan' ? 'Бронь в Штабе' : 'Бронирование'} />
      <div style={{ ...glass, padding: 20, marginTop: 18 }}>
        <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', margin: '0 0 14px', lineHeight: 1.55 }}>
          Введите номер телефона — продолжим бронь и покажем ваши прошлые заявки, если они есть.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); if (entryPhone.replace(/\D/g, '').length >= 10) continueFromPhone() }}>
          <input style={{ ...inp, fontSize: 19, textAlign: 'center', letterSpacing: '0.02em' }}
            type="tel" inputMode="tel" autoComplete="tel" name="phone" enterKeyHint="go"
            value={entryPhone} onChange={(e) => setEntryPhone(e.target.value)} placeholder="+7 (___) ___-__-__" maxLength={30} autoFocus />
          <button type="submit" disabled={entryPhone.replace(/\D/g, '').length < 10}
            style={{ ...cta(), marginTop: 16, opacity: entryPhone.replace(/\D/g, '').length < 10 ? 0.4 : 1 }}>Продолжить</button>
        </form>
        <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', textAlign: 'center', margin: '12px 0 0', lineHeight: 1.5 }}>
          По номеру вы сможете открыть свои брони с любого устройства.
        </p>
      </div>
    </div></div>
  )

  // ── Экран «Мои брони» ──
  if (view === 'mine') return (
    <div style={wrap}><div style={shell}>
      <Header clubName={cfg.clubName} sub="Ваши брони" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {mine.map(({ token, b }) => <MineCard key={b.id} token={token} b={b} cfg={cfg} onChanged={refreshMine} />)}
      </div>
      <button onClick={() => { resetWizard(); setView('wizard') }}
        style={{ ...cta(), marginTop: 16, background: 'rgba(139,92,246,0.16)', color: '#c4b5fd' }}>
        <Icon name="add" size={18} color="#c4b5fd" /> Новая бронь
      </button>
    </div></div>
  )

  // ── Мастер ──
  const firstStep = fixedLoc ? 1 : 0
  return (
    <div style={wrap}><div style={shell}>
      <Header clubName={cfg.clubName} sub={fixedLoc === 'exit' ? 'Бронь выезда' : fixedLoc === 'titan' ? 'Бронь в Штабе' : 'Бронирование'} />

      {/* Прогресс */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 18px' }}>
        {step > firstStep && (
          <button onClick={() => setStep((s) => s - 1)} aria-label="Назад"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-variant)', padding: 0, display: 'flex' }}>
            <Icon name="chevron_left" size={22} />
          </button>
        )}
        <div style={{ flex: 1, display: 'flex', gap: 5 }}>
          {Array.from({ length: 6 - firstStep }).map((_, i) => {
            const s = firstStep + i
            return <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: s <= step ? VIOLET : 'rgba(255,255,255,0.12)', transition: 'background .25s' }} />
          })}
        </div>
        {mine.length > 0 && (
          <button onClick={() => setView('mine')} aria-label="Мои брони"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-variant)', padding: 0, display: 'flex' }}>
            <Icon name="close" size={22} />
          </button>
        )}
      </div>

      {/* Шаг 0 — локация */}
      {step === 0 && (
        <Step title="Где провести?" hint="Выберите формат мероприятия">
          <button style={{ ...optCard(location === 'titan'), marginBottom: 12 }} onClick={() => setLocation('titan')}>
            <Row icon="location_on" title="Штаб Titan" sub="У нас — кабинки и пространства, почасовая аренда" active={location === 'titan'} />
          </button>
          <button style={optCard(location === 'exit')} onClick={() => setLocation('exit')}>
            <Row icon="local_shipping" title="Моя локация (выезд)" sub="Проведём мероприятие на вашей площадке" active={location === 'exit'} />
          </button>
        </Step>
      )}

      {/* Шаг 1 — адрес (выезд) или кабинка (Titan) */}
      {step === 1 && location === 'exit' && (
        <Step title="Локация и название" hint="Куда выезжаем и как назвать мероприятие">
          <label style={lbl}>Название локации / мероприятия</label>
          <input style={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Напр.: День рождения Алексея" maxLength={160} />
          <label style={lbl}>Адрес проведения</label>
          <AddressAutocomplete value={address} onChange={setAddress} placeholder="Город, улица, дом" maxLength={300} style={inp} />
          {cfg.venueAddress && <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', marginTop: 10 }}>Наш штаб: {cfg.venueAddress}</p>}
        </Step>
      )}
      {step === 1 && location === 'titan' && (
        <Step title="Кабинка / пространство" hint="Аренда почасовая — итог по факту в конце вечера">
          <label style={{ ...lbl, marginTop: 0 }}>Название мероприятия</label>
          <input style={{ ...inp, marginBottom: 14 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Напр.: Игра с друзьями" maxLength={160} />
          {cabins.length === 0 ? (
            <p style={{ color: 'var(--on-surface-variant)', fontSize: 14 }}>Подберём пространство при подтверждении.</p>
          ) : cabins.map((cb) => (
            <button key={cb.id} style={{ ...optCard(cabinId === cb.id), marginBottom: 10 }} onClick={() => setCabinId(cb.id)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <p style={{ fontSize: 15.5, fontWeight: 700, margin: 0 }}>{cb.name}</p>
                  {cb.capacity ? <p style={{ fontSize: 12.5, color: 'var(--on-surface-variant)', margin: '3px 0 0' }}>до {cb.capacity} гостей</p> : null}
                </div>
                {Number(cb.hourlyRate) > 0 && (
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 800, margin: 0, color: '#c4b5fd' }}>{money(cb.hourlyRate)}</p>
                    <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '2px 0 0' }}>в час</p>
                  </div>
                )}
              </div>
            </button>
          ))}
          <InfoNote text="Оплата почасовая: итоговая сумма считается в конце вечера по фактическому времени." />
        </Step>
      )}

      {/* Шаг 2 — тариф/часы */}
      {step === 2 && (
        <Step title={location === 'titan' ? 'Сколько примерно часов?' : 'Выберите тариф'} hint={location === 'titan' ? 'Поможет нам спланировать вечер (оплата — по факту)' : 'Чем дольше — тем выгоднее час'}>
          {tariffs.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tariffs.map((t) => {
                const sv = savings.get(t.hours)
                const active = hours === t.hours
                return (
                  <button key={t.hours} style={optCard(active)} onClick={() => setHours(t.hours)}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 17, fontWeight: 800 }}>{t.hours} ч</span>
                        {sv ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11.5, fontWeight: 800, color: '#34d399', background: 'rgba(16,185,129,0.14)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: 8, padding: '2px 8px' }}>
                            <Icon name="savings" size={12} color="#34d399" /> выгода {sv}%
                          </span>
                        ) : null}
                      </div>
                      {location === 'exit' && Number(t.price) > 0 && <span style={{ fontSize: 16, fontWeight: 800, color: '#c4b5fd' }}>{money(t.price)}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[1, 2, 3, 4, 5, 6, 8].map((h) => (
                <button key={h} onClick={() => setHours(h)}
                  style={{ ...glass, padding: '12px 16px', cursor: 'pointer', color: hours === h ? '#fff' : 'var(--on-surface)', border: hours === h ? `1.5px solid ${VIOLET}` : '1px solid rgba(255,255,255,0.1)', background: hours === h ? 'rgba(139,92,246,0.2)' : glass.background, fontWeight: 800, fontSize: 15 }}>
                  {h} ч
                </button>
              ))}
            </div>
          )}
          {location === 'titan' && cabin && Number(cabin.hourlyRate) > 0 && hours != null && (
            <InfoNote text={`Ориентировочно ≈ ${money(Number(cabin.hourlyRate) * hours)} за ${hours} ч. Точный итог — по факту в конце вечера.`} />
          )}
        </Step>
      )}

      {/* Шаг 3 — дата/время */}
      {step === 3 && (
        <Step title="Когда?">
          <label style={lbl}>Дата</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NumBox value={dd} onChange={setDd} max={2} ph="ДД" w={56} hi={31} />
            <span style={{ color: 'var(--on-surface-variant)' }}>/</span>
            <NumBox value={mm} onChange={setMm} max={2} ph="ММ" w={56} hi={12} />
            <span style={{ color: 'var(--on-surface-variant)' }}>/</span>
            <NumBox value={yyyy} onChange={setYyyy} max={4} ph="ГГГГ" w={84} />
          </div>
          <label style={lbl}>Время начала (24ч)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <NumBox value={hh} onChange={setHh} max={2} ph="ЧЧ" w={56} hi={23} />
            <span style={{ color: 'var(--on-surface-variant)', fontWeight: 800 }}>:</span>
            <NumBox value={mi} onChange={setMi} max={2} ph="ММ" w={56} hi={59} />
          </div>
          <label style={lbl}>{location === 'exit' ? 'На сколько человек состоится мероприятие' : 'Гостей (необязательно)'}</label>
          <input style={inp} type="number" min={1} inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="Например, 6" />
        </Step>
      )}

      {/* Шаг 4 — контакт */}
      {step === 4 && (
        <Step title="Как с вами связаться?" hint="Для подтверждения брони">
          <label style={lbl}>Имя</label>
          <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ваше имя" maxLength={120} />
          <label style={lbl}>Телефон</label>
          <input style={inp} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 999 123-45-67" maxLength={30} />
          <label style={lbl}>Комментарий (необязательно)</label>
          <textarea style={{ ...inp, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Повод, пожелания…" maxLength={500} />
        </Step>
      )}

      {/* Шаг 5 — ревью */}
      {step === 5 && (
        <Step title="Проверьте заявку" hint="Всё верно?">
          <div style={{ ...glass, padding: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Sum k="Формат" v={location === 'exit' ? 'Выезд' : 'Штаб Titan'} />
            {title && <Sum k="Название" v={title} />}
            {location === 'exit' && address && <Sum k="Адрес" v={address} />}
            {location === 'titan' && cabin && <Sum k="Кабинка" v={cabin.name} />}
            {hours != null && <Sum k="Время" v={`${hours} ч`} />}
            <Sum k="Когда" v={date && time ? fmtWhen(`${date}T${time}:00+03:00`) : '—'} />
            {guests && <Sum k="Гостей" v={guests} />}
            <Sum k="Имя" v={name} />
            <Sum k="Телефон" v={phone} />
            {comment && <Sum k="Комментарий" v={comment} />}
          </div>
          {location === 'titan' && <InfoNote text="Аренда почасовая — итоговая сумма по факту в конце вечера." />}
          {error && <p style={{ color: '#f87171', fontSize: 13.5, marginTop: 12 }}>{error}</p>}
        </Step>
      )}

      {/* Нижняя CTA */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', background: 'linear-gradient(to top, rgba(21,18,27,0.98), rgba(21,18,27,0))' }}>
        <div style={{ ...shell, margin: '0 auto' }}>
          {step < 5 ? (
            <button onClick={() => canNext() && setStep((s) => s + 1)} disabled={!canNext()} style={{ ...cta(), opacity: canNext() ? 1 : 0.4 }}>Далее</button>
          ) : (
            <button onClick={submit} disabled={submitting} style={{ ...cta(), opacity: submitting ? 0.7 : 1 }}>{submitting ? 'Отправляем…' : 'Отправить заявку'}</button>
          )}
        </div>
      </div>
    </div></div>
  )
}

// ── вспомогательные компоненты ──
function Header({ clubName, sub }: { clubName?: string; sub: string }) {
  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: 0 }}>{clubName}</p>
      <h1 style={{ fontSize: 25, fontWeight: 800, margin: '2px 0 0', letterSpacing: '-0.02em' }}>{sub}</h1>
    </div>
  )
}
function Step({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>{title}</h2>
      {hint && <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: '5px 0 16px', lineHeight: 1.5 }}>{hint}</p>}
      {!hint && <div style={{ height: 16 }} />}
      {children}
    </div>
  )
}
function Row({ icon, title, sub, active }: { icon: string; title: string; sub: string; active: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
      <div style={{ width: 44, height: 44, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: active ? 'rgba(139,92,246,0.22)' : 'rgba(255,255,255,0.06)' }}>
        <Icon name={icon} size={22} color={active ? '#c4b5fd' : 'var(--on-surface-variant)'} />
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{title}</p>
        <p style={{ fontSize: 13, color: 'var(--on-surface-variant)', margin: '3px 0 0', lineHeight: 1.4 }}>{sub}</p>
      </div>
      {active && <Icon name="check_circle" size={20} color={VIOLET} />}
    </div>
  )
}
function InfoNote({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 14, padding: '11px 13px', borderRadius: 13, background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.22)' }}>
      <Icon name="info" size={16} color="#a78bfa" style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 12.5, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>{text}</span>
    </div>
  )
}
function Sum({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span style={{ fontSize: 13, color: 'var(--on-surface-variant)' }}>{k}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, textAlign: 'right' }}>{v}</span>
    </div>
  )
}
function cta(): React.CSSProperties {
  return { width: '100%', padding: '15px 0', borderRadius: 15, border: 'none', cursor: 'pointer', fontSize: 16, fontWeight: 800, background: VIOLET, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }
}
// Числовое поле даты/времени (ДД/ММ/ГГГГ, ЧЧ/ММ) — ввод цифрами, не нативный пикер.
function NumBox({ value, onChange, max, ph, w, hi }: { value: string; onChange: (v: string) => void; max: number; ph: string; w: number; hi?: number }) {
  const box: React.CSSProperties = { width: w, textAlign: 'center', padding: '13px 4px', borderRadius: 13, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', color: 'var(--on-surface)', fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', outline: 'none', boxSizing: 'border-box' }
  return (
    <input style={box} value={value} inputMode="numeric" placeholder={ph} maxLength={max}
      onChange={(e) => { let v = e.target.value.replace(/\D/g, '').slice(0, max); if (hi != null && v.length === max && Number(v) > hi) v = String(hi).padStart(max, '0'); onChange(v) }}
      onBlur={(e) => { let v = e.target.value; if (max === 2 && v.length === 1) v = '0' + v; if (v !== value) onChange(v) }} />
  )
}

// ── карточка брони в «Мои брони» (статус + правки) ──
function MineCard({ token, b, cfg, onChanged }: { token: string | null; b: MyBooking; cfg: Config; onChanged: () => void }) {
  const st = STATUS_META[effStatus(b)] ?? { label: b.status, color: '#94A3B8', icon: 'info' }
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const cur = (() => { try { const d = new Date(new Date(b.starts_at).getTime() + 3 * 3600 * 1000); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) } } catch { return { date: '', time: '' } } })()
  const [date, setDate] = useState(cur.date)
  const [time, setTime] = useState(cur.time)
  const [hours, setHours] = useState<number | null>(b.tariff_hours)
  const [comment, setComment] = useState(b.comment || '')

  // Править/отменять можно только со своим токеном (бронь создана на этом устройстве).
  const canManage = b.status === 'new' && !!token
  const patch = async (body: any) => {
    if (!token) return
    setBusy(true)
    try { await api.patch(`/bookings/public/${token}`, body); await onChanged(); setEdit(false) } catch (e) { /* */ } finally { setBusy(false) }
  }

  return (
    <div style={{ ...glass, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: st.color }}>
          <Icon name={st.icon} size={16} color={st.color} /> {st.label}
        </span>
        <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{b.location === 'exit' ? 'Выезд' : 'Штаб Titan'}</span>
      </div>
      <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--on-surface)' }}><Icon name="schedule" size={15} color="var(--on-surface-variant)" /> {fmtWhen(b.starts_at)}{b.tariff_hours ? ` · ${b.tariff_hours} ч` : ''}</div>
        {b.zone_name && <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--on-surface-variant)', fontSize: 13 }}><Icon name="location_on" size={15} color="var(--on-surface-variant)" /> {b.zone_name}</div>}
        {b.location === 'exit' && b.address && <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--on-surface-variant)', fontSize: 13 }}><Icon name="location_on" size={15} color="var(--on-surface-variant)" /> {b.address}</div>}
        {b.comment && <div style={{ color: 'var(--on-surface-variant)', fontSize: 13 }}>{b.comment}</div>}
      </div>

      {b.status === 'new' && !token && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>
          Изменить или отменить заявку можно на устройстве, с которого её отправили, или позвонив в заведение.
        </div>
      )}

      {canManage && !edit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => setEdit(true)} style={{ flex: 1, padding: '9px 0', borderRadius: 11, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--on-surface)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Изменить</button>
          <button disabled={busy} onClick={() => patch({ cancel: true })} style={{ flex: 1, padding: '9px 0', borderRadius: 11, border: 'none', background: 'rgba(248,113,113,0.14)', color: '#f87171', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Отменить</button>
        </div>
      )}

      {canManage && edit && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={lbl}>Дата</label><input style={inp} type="date" value={date} min={mskToday()} onChange={(e) => setDate(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label style={lbl}>Время</label><input style={inp} type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          {(cfg.tariffs?.length ?? 0) > 0 && (
            <>
              <label style={lbl}>Часы</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {(cfg.tariffs ?? []).map((t) => (
                  <button key={t.hours} onClick={() => setHours(t.hours)} style={{ padding: '8px 13px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13, border: hours === t.hours ? `1.5px solid ${VIOLET}` : '1px solid rgba(255,255,255,0.12)', background: hours === t.hours ? 'rgba(139,92,246,0.2)' : 'transparent', color: 'var(--on-surface)' }}>{t.hours} ч</button>
                ))}
              </div>
            </>
          )}
          <label style={lbl}>Комментарий</label>
          <textarea style={{ ...inp, minHeight: 54, resize: 'vertical', fontFamily: 'inherit' }} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button disabled={busy} onClick={() => patch({ date, time, tariffHours: hours ?? undefined, comment })} style={{ flex: 1, padding: '10px 0', borderRadius: 11, border: 'none', background: VIOLET, color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>{busy ? '…' : 'Сохранить'}</button>
            <button onClick={() => setEdit(false)} style={{ padding: '10px 16px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: 'var(--on-surface-variant)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  )
}
