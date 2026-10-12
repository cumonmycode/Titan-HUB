'use client'
/**
 * Форма заявки: игра · мероприятие · сертификат · сообщение. Отправляет в HUB
 * (POST /api/site/requests) — заявка появляется в «Заявки с сайта» и пушем
 * владельцу. Одна разметка на все темы; вид задаёт CSS темы.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import type { RequestPreset, SiteConfig } from '@/lib/types'
import { rub } from '@/lib/format'
import { SITE } from '@/content/site'
import { EVENT_FORMATS, TIMES, TOPICS, formatPhone, mskToday, upcomingEvenings, type EventFormat, type EveningSlot, type Topic } from './options'

type Kind = RequestPreset['kind']
const KINDS: { id: Kind; label: string }[] = [
  { id: 'game', label: 'Игра' },
  { id: 'event', label: 'Мероприятие' },
  { id: 'certificate', label: 'Сертификат' },
  { id: 'message', label: 'Вопрос' },
]
const TITLES: Record<Kind, string> = {
  game: 'Записаться на игру',
  event: 'Заказать мероприятие',
  certificate: 'Активировать сертификат',
  message: 'Написать клубу',
}

interface State {
  slot: string // индекс вечера в списке
  guests: number
  newbie: boolean
  format: EventFormat
  location: 'titan' | 'exit'
  date: string
  time: string
  hours: number | null
  zone: string
  address: string
  code: string
  topic: Topic
  name: string
  phone: string
  telegram: string
  comment: string
  consent: boolean
  website: string
}

function initial(preset: RequestPreset): State {
  return {
    slot: '0', guests: 1, newbie: false,
    format: preset.kind === 'event' ? preset.format ?? 'birthday' : 'birthday',
    location: preset.kind === 'event' ? preset.location ?? 'titan' : 'titan',
    date: '', time: '19:00', hours: null, zone: '', address: '', code: '',
    topic: preset.kind === 'message' ? preset.topic ?? 'question' : 'question',
    name: '', phone: '', telegram: '', comment: '', consent: false, website: '',
  }
}

export function RequestForm({ config, preset, variant, onClose, lockKind }: {
  config: SiteConfig
  preset: RequestPreset
  variant: 'sheet' | 'inline'
  onClose?: () => void
  /** Встроенная форма без переключателя вида (сертификат, контакты). */
  lockKind?: boolean
}) {
  const [kind, setKind] = useState<Kind>(preset.kind)
  const [s, setS] = useState<State>(() => initial(preset))
  const [slots, setSlots] = useState<EveningSlot[]>([])
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Вечера считаем на клиенте — по его «сейчас», без рассинхрона с серверным рендером.
  useEffect(() => {
    const list = upcomingEvenings(config.schedule, 6)
    setSlots(list)
    if (preset.kind === 'game' && preset.evening) {
      const i = list.findIndex((x) => x.evening === preset.evening)
      if (i > 0) setS((p) => ({ ...p, slot: String(i) }))
    }
  }, [config.schedule, preset])

  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }))
  const rate = config.eventRates.find((r) => r.hours === s.hours)
  const zone = config.zones.find((z) => z.id === s.zone)
  const needsDate = kind === 'event' || kind === 'certificate'
  const today = useMemo(() => mskToday(), [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!s.consent) return setError('Нужно согласие на обработку персональных данных')
    if (s.phone.replace(/\D/g, '').length < 10) return setError('Укажите телефон полностью — мы перезвоним по нему')
    if (needsDate && !s.date) return setError('Выберите дату')
    if (kind === 'game' && !slots[Number(s.slot)]) return setError('Выберите вечер')
    if (kind === 'certificate' && !s.code.trim()) return setError('Введите номер сертификата')
    if (kind === 'message' && !s.comment.trim()) return setError('Напишите, о чём хотите спросить')

    const base = {
      name: s.name.trim() || 'Гость', phone: formatPhone(s.phone), telegram: s.telegram.trim() || undefined,
      comment: s.comment.trim() || undefined, consent: true as const, website: s.website || undefined,
      page: typeof window !== 'undefined' ? window.location.pathname : undefined,
    }
    const slot = slots[Number(s.slot)]
    const body =
      kind === 'game' && slot ? { ...base, kind, date: slot.date, time: slot.time, evening: slot.evening, guests: s.guests, newbie: s.newbie }
      : kind === 'event' ? {
        ...base, kind, date: s.date, time: s.time, format: s.format, location: s.location,
        address: s.location === 'exit' ? s.address.trim() || undefined : undefined,
        guests: s.guests > 1 ? s.guests : undefined, tariffHours: s.hours ?? undefined,
        spaceId: s.location === 'titan' && s.zone ? s.zone : undefined,
      }
      : kind === 'certificate' ? {
        ...base, kind, date: s.date, time: s.time, code: s.code.trim(), location: s.location,
        address: s.location === 'exit' ? s.address.trim() || undefined : undefined, guests: s.guests > 1 ? s.guests : undefined,
      }
      : { ...base, kind: 'message' as const, topic: s.topic, comment: s.comment.trim() }

    setStatus('sending')
    try {
      const res = await fetch('/api/site/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Не получилось отправить заявку')
      setStatus('done')
    } catch (err) {
      setStatus('idle')
      setError(err instanceof Error && err.message !== 'Failed to fetch' ? err.message : `Нет связи — позвоните нам: ${SITE.phone}`)
    }
  }

  if (status === 'done') return <Done kind={kind} variant={variant} onClose={onClose} />

  return (
    <form className={`rq rq-${variant}`} onSubmit={submit} noValidate>
      <h2 className="rq-title">{TITLES[kind]}</h2>
      {!lockKind && (
        <div className="rq-tabs" role="tablist" aria-label="Вид заявки">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="tab" aria-selected={kind === k.id} className="rq-tab" onClick={() => { setKind(k.id); setError(null) }}>{k.label}</button>
          ))}
        </div>
      )}

      {kind === 'game' && (
        <>
          <Field label="Вечер">
            {slots.length ? (
              <div className="chips chips-wrap">
                {slots.map((x, i) => (
                  <button key={`${x.date}-${x.title}`} type="button" className="chip chip-slot" aria-pressed={s.slot === String(i)} onClick={() => set('slot', String(i))}>
                    <b>{x.label}, {x.time}</b><span>{x.title}</span>
                  </button>
                ))}
              </div>
            ) : <p className="rq-note">Расписание уточним по телефону.</p>}
          </Field>
          <Field label="Сколько вас"><Stepper value={s.guests} min={1} max={20} onChange={(v) => set('guests', v)} /></Field>
          <label className="rq-check"><input type="checkbox" checked={s.newbie} onChange={(e) => set('newbie', e.target.checked)} /><span>Я впервые — объясните правила</span></label>
        </>
      )}

      {kind === 'event' && (
        <Field label="Повод">
          <div className="chips chips-wrap">
            {EVENT_FORMATS.map((f) => <button key={f.id} type="button" className="chip" aria-pressed={s.format === f.id} onClick={() => set('format', f.id)}>{f.label}</button>)}
          </div>
        </Field>
      )}

      {kind === 'certificate' && (
        <Field label="Номер сертификата"><input className="rq-input" value={s.code} onChange={(e) => set('code', e.target.value)} placeholder="Число, указанное на сертификате" inputMode="text" autoComplete="off" /></Field>
      )}

      {needsDate && (
        <>
          <Field label="Где играем">
            <div className="chips">
              <button type="button" className="chip" aria-pressed={s.location === 'titan'} onClick={() => set('location', 'titan')}>В штабе клуба</button>
              <button type="button" className="chip" aria-pressed={s.location === 'exit'} onClick={() => set('location', 'exit')}>У вас — выезд</button>
            </div>
          </Field>
          {s.location === 'exit' && <Field label="Адрес"><input className="rq-input" value={s.address} onChange={(e) => set('address', e.target.value)} placeholder="Город, улица, дом" autoComplete="street-address" /></Field>}
          <div className="rq-row">
            <Field label="Дата"><input className="rq-input" type="date" min={today} value={s.date} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label="Начало">
              <select className="rq-input" value={s.time} onChange={(e) => set('time', e.target.value)}>{TIMES.map((t) => <option key={t}>{t}</option>)}</select>
            </Field>
          </div>
          <Field label="Гостей"><Stepper value={s.guests} min={1} max={kind === 'event' ? 200 : 60} onChange={(v) => set('guests', v)} /></Field>
        </>
      )}

      {kind === 'event' && config.eventRates.length > 0 && (
        <Field label="Продолжительность">
          <div className="chips chips-wrap">
            {config.eventRates.map((r) => (
              <button key={r.hours} type="button" className="chip chip-rate" aria-pressed={s.hours === r.hours} onClick={() => set('hours', s.hours === r.hours ? null : r.hours)}>
                <b>{r.hours} ч</b><span>{rub(r.price)}</span>
              </button>
            ))}
          </div>
          {rate && <p className="rq-note">Мероприятие на {rate.hours} ч — {rub(rate.price)}. Точную смету подтвердим по телефону.</p>}
        </Field>
      )}

      {kind === 'event' && s.location === 'titan' && config.zones.length > 0 && (
        <Field label="Зал">
          <div className="chips chips-wrap">
            {config.zones.map((z) => (
              <button key={z.id} type="button" className="chip chip-rate" aria-pressed={s.zone === z.id} onClick={() => set('zone', s.zone === z.id ? '' : z.id)}>
                <b>{z.name}</b><span>{rub(z.hourlyRate)}/ч</span>
              </button>
            ))}
          </div>
          {zone && <p className="rq-note">{zone.name}{zone.capacity ? ` — до ${zone.capacity} гостей` : ''}.</p>}
        </Field>
      )}

      {kind === 'message' && (
        <Field label="Тема">
          <div className="chips">{TOPICS.map((t) => <button key={t.id} type="button" className="chip" aria-pressed={s.topic === t.id} onClick={() => set('topic', t.id)}>{t.label}</button>)}</div>
        </Field>
      )}

      <div className="rq-row">
        <Field label="Имя"><input className="rq-input" value={s.name} onChange={(e) => set('name', e.target.value)} placeholder="Как к вам обращаться" autoComplete="given-name" /></Field>
        <Field label="Телефон"><input className="rq-input" value={s.phone} onChange={(e) => set('phone', e.target.value)} onBlur={() => set('phone', formatPhone(s.phone))} placeholder="+7 (___) ___-__-__" inputMode="tel" autoComplete="tel" required /></Field>
      </div>
      <Field label="Telegram" hint="необязательно"><input className="rq-input" value={s.telegram} onChange={(e) => set('telegram', e.target.value)} placeholder="@ник" autoComplete="off" /></Field>
      <Field label={kind === 'message' ? 'Сообщение' : 'Пожелания'} hint={kind === 'message' ? undefined : 'необязательно'}>
        <textarea className="rq-input rq-area" value={s.comment} onChange={(e) => set('comment', e.target.value)} rows={3} placeholder={kind === 'message' ? 'Опишите предложение или вопрос' : 'Что важно учесть'} />
      </Field>
      <input className="rq-trap" tabIndex={-1} autoComplete="off" aria-hidden="true" value={s.website} onChange={(e) => set('website', e.target.value)} name="website" />

      <label className="rq-check rq-consent">
        <input type="checkbox" checked={s.consent} onChange={(e) => set('consent', e.target.checked)} />
        <span>Согласен на обработку персональных данных по <a href="/privacy-policy" target="_blank">политике конфиденциальности</a></span>
      </label>
      {error && <p className="rq-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary rq-submit" disabled={status === 'sending'}>{status === 'sending' ? 'Отправляем…' : 'Отправить заявку'}</button>
      <p className="rq-note">Или позвоните: <a href={SITE.phoneHref}>{SITE.phone}</a></p>
    </form>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rq-field">
      <span className="rq-label">{label}{hint && <i> — {hint}</i>}</span>
      {children}
    </div>
  )
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Меньше" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus size={18} /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="Больше" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus size={18} /></button>
    </div>
  )
}

const DONE_TEXT: Record<Kind, string> = {
  game: 'Вы в списке. Администратор подтвердит запись звонком или в мессенджере.',
  event: 'Заявка у администратора. Перезвоним, чтобы обсудить детали и смету.',
  certificate: 'Сертификат передан администратору — свяжемся, чтобы выбрать дату.',
  message: 'Сообщение получено. Ответим в течение дня.',
}

function Done({ kind, variant, onClose }: { kind: Kind; variant: 'sheet' | 'inline'; onClose?: () => void }) {
  return (
    <div className={`rq rq-${variant} rq-done`} role="status">
      <span className="rq-done-mark" aria-hidden="true"><Check size={34} strokeWidth={2.4} /></span>
      <h2 className="rq-title">Заявка принята</h2>
      <p>{DONE_TEXT[kind]}</p>
      {onClose && <button type="button" className="btn btn-ghost" onClick={onClose}>Готово</button>}
    </div>
  )
}
