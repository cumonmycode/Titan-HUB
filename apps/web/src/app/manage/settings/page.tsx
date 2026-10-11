'use client'
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { PageHeader, SaveButton, INP, SEL, LBL } from '@/components/manage/DesignSystem'
import { TimeInput24 } from '@/components/TimeInput24'
import { AddressAutocomplete } from '@/components/AddressAutocomplete'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { IntegrationsTab } from './IntegrationsTab'
import { PaymentConfig } from './PaymentConfig'
import { WhatsAppConfig } from './WhatsAppConfig'
import { TaiChatConfig } from './TaiChatConfig'
import { ReviewsConfig } from './ReviewsConfig'
import { BookingConfig } from './BookingConfig'

function SectionCard({ title, icon, color, children }: { title: string; icon: string; color: string; children: React.ReactNode }) {
  return (
    <div className="glass-l2" style={{ borderRadius: 18, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={16} color={color} />
        </div>
        <span style={{ ...LBL, margin: 0, color }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function Field({ label, icon, hint, children }: { label: string; icon?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ ...LBL, display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon && <Icon name={icon} size={12} />}
        {label}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--on-surface-variant)', margin: '6px 0 0', lineHeight: 1.45 }}>{hint}</p>}
    </div>
  )
}

interface FormData {
  venue_name: string
  venue_address: string
  hours_open: string
  hours_close: string
  business_day_start_hour: string
  default_payment: string
  receipt_footer: string
}

type Tab = 'venue' | 'behavior' | 'integrations'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'venue',        label: 'Заведение',  icon: 'store' },
  { key: 'behavior',     label: 'Поведение',  icon: 'tune' },
  { key: 'integrations', label: 'Интеграции', icon: 'extension' },
]

function isTab(v: string | null): v is Tab {
  return v === 'venue' || v === 'behavior' || v === 'integrations'
}

export default function SettingsPage() {
  const router = useRouter()
  const qc = useQueryClient()
  const { show } = useToast()
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<Tab>('venue')
  const [form, setForm] = useState<FormData>({
    venue_name: '', venue_address: '', hours_open: '', hours_close: '',
    business_day_start_hour: '9',
    default_payment: 'cash', receipt_footer: '',
  })

  // Вкладка в URL (?tab=) — без next/navigation hooks, чтобы не требовать Suspense.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (isTab(t)) setTab(t)
  }, [])
  function changeTab(t: Tab) {
    setTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  const { data, isLoading } = useQuery<{ settings: Record<string, string> }>({
    queryKey: ['settings'],
    queryFn: () => api.get('/system/settings'),
  })

  useEffect(() => {
    if (!data?.settings) return
    const s = data.settings
    setForm({
      venue_name: s.venue_name ?? '',
      venue_address: s.venue_address ?? '',
      hours_open: s.hours_open ?? '',
      hours_close: s.hours_close ?? '',
      business_day_start_hour: s.business_day_start_hour ?? '9',
      default_payment: s.default_payment ?? 'cash',
      receipt_footer: s.receipt_footer ?? '',
    })
  }, [data])

  const save = useMutation({
    mutationFn: () => api.patch('/system/settings', {
      venue_name: form.venue_name,
      venue_address: form.venue_address,
      hours_open: form.hours_open,
      hours_close: form.hours_close,
      business_day_start_hour: form.business_day_start_hour,
      default_payment: form.default_payment,
      receipt_footer: form.receipt_footer,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
    onError: () => show('Не удалось сохранить настройки', 'error'),
  })

  function set<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  // Подсказка для «Бизнес-дня» — отражает текущий выбранный час.
  const bdHint = `Граница суток для смен и отчётов (сейчас ${String(form.business_day_start_hour).padStart(2, '0')}:00)`

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Настройки" subtitle="Параметры заведения и системы" onBack={() => router.push('/manage')} />

      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* Переключатель вкладок (segmented) */}
        <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          {TABS.map(t => {
            const active = tab === t.key
            return (
              <button key={t.key} onClick={() => changeTab(t.key)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 8px', borderRadius: 11, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, transition: 'all 0.15s', background: active ? 'var(--primary-violet)' : 'transparent', color: active ? '#fff' : 'var(--on-surface-variant)' }}>
                <Icon name={t.icon} size={17} color={active ? '#fff' : 'var(--on-surface-variant)'} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Вкладки «Заведение» и «Поведение» работают на одном GET/PATCH /system/settings */}
        {tab !== 'integrations' && (
          isLoading && !data ? (
            <StateView state="loading" />
          ) : (
            <>
              {tab === 'venue' && (
                <>
                  <SectionCard title="Заведение" icon="store" color="#8B5CF6">
                    <Field label="Название" icon="label">
                      <input style={INP} value={form.venue_name} onChange={e => set('venue_name', e.target.value)} placeholder="Titan HUB" />
                    </Field>
                    <Field label="Адрес" icon="location_on">
                      <AddressAutocomplete value={form.venue_address} onChange={v => set('venue_address', v)} placeholder="ул. Примерная, 1" style={INP} />
                    </Field>
                    <Field label="Часы работы" icon="schedule">
                      <div style={{ display: 'flex', gap: 10 }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ ...LBL, color: 'rgba(204,195,216,0.5)' }}>Открытие</label>
                          <TimeInput24 value={form.hours_open} onChange={v => set('hours_open', v)} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ ...LBL, color: 'rgba(204,195,216,0.5)' }}>Закрытие</label>
                          <TimeInput24 value={form.hours_close} onChange={v => set('hours_close', v)} />
                        </div>
                      </div>
                    </Field>
                    <Field label="Бизнес-день" icon="today" hint={bdHint}>
                      <select style={SEL} value={form.business_day_start_hour} onChange={e => set('business_day_start_hour', e.target.value)}>
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</option>
                        ))}
                      </select>
                    </Field>
                  </SectionCard>

                  <SaveButton onClick={() => save.mutate()} isPending={save.isPending} isSaved={saved} label="Сохранить изменения" />

                  {/* Приём оплат: активный СБП-эквайер (по введённым ключам) + 54-ФЗ.
                      Сохраняется отдельно (собственный API /system/payment-config). */}
                  <PaymentConfig />

                  {/* Отзывы: ссылка-приглашение + QR (Яндекс/2ГИС). Свой API. */}
                  <ReviewsConfig />

                  {/* Онлайн-бронирование: публичная форма /book + QR. Свой API. */}
                  <BookingConfig />

                </>
              )}

              {tab === 'behavior' && (
                <>
                  {/* Автозакрытие смены, тумблер Telegram и общий порог остатка убраны: сервер
                      их не читал. Уведомления — у каждого сотрудника, порог — у позиции склада. */}

                  {/* WhatsApp-уведомления (поздравления с ДР и др.) — своя настройка. */}
                  <WhatsAppConfig />

                  {/* Tai в чате — дерзкие ответы бота опросов. */}
                  <TaiChatConfig />
                </>
              )}
            </>
          )
        )}

        {/* Вкладка «Интеграции» — собственный API /system/integrations */}
        {tab === 'integrations' && <IntegrationsTab />}
      </div>
    </div>
  )
}
