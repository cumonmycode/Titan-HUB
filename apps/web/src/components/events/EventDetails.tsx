'use client'
/**
 * Сведения в просмотре события — каждое один раз: где (маршрут/такси для выезда),
 * ответственный, оплата, гости, комментарий; заказчик со связью
 * (звонок / WhatsApp / Telegram). Пустые строки не показываем.
 */
import React, { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button, IconButton } from '@/components/manage/DesignSystem'
import { Card } from '@/components/manage/goods/parts'
import { mapsRouteUrl, openContact, taxiMapsFallbackUrl, taxiUrlFromCoords, telLink, telegramLink, whatsappLink } from '@/lib/contact'
import {
  MUTED, eventKind, eventTitle, num, packagePrice, placeLabel, rub,
  type EventItem, type EventRate, type SpaceInfo, type StaffInfo,
} from './lib'
import { InfoRow } from './ui'

/** Координаты адреса выезда — для прямого диплинка в Яндекс Go. Префетчим заранее,
 *  чтобы открытие было в самом жесте; нет координат — запасной Я.Карты-такси. */
function useTaxiCoords(address: string | null): { lat: number; lon: number } | null {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  useEffect(() => {
    setCoords(null)
    const addr = (address ?? '').trim()
    if (!addr) return
    let cancelled = false
    api.get<{ lat?: number; lon?: number }>(`/geo/geocode?text=${encodeURIComponent(addr)}`)
      .then(r => { if (!cancelled && typeof r.lat === 'number' && typeof r.lon === 'number') setCoords({ lat: r.lat, lon: r.lon }) })
      .catch(() => { /* фолбэк — Я.Карты в режиме такси */ })
    return () => { cancelled = true }
  }, [address])
  return coords
}

function billingText(ev: EventItem, spaces: SpaceInfo[], rates: EventRate[]): string {
  if (eventKind(ev) === 'minicap') {
    const fee = num(ev.participationFee)
    return fee != null ? `Взнос ${rub(fee)} с игрока` : 'Взнос не задан'
  }
  if (ev.billingMode === 'rental') {
    const rate = num(spaces.find(s => s.id === ev.spaceId)?.hourlyRate ?? null)
    return rate ? `По ставке зоны · ${rub(rate)}/ч, по факту` : 'По ставке зоны, по факту'
  }
  if (ev.billingMode === 'hourly') {
    const h = ev.plannedHours
    const price = h ? packagePrice(rates, h) : null
    return h ? `Пакет ${h} ч${price != null ? ` · ${rub(price)}` : ''}` : 'Пакет'
  }
  const amount = num(ev.manualAmount) ?? num(ev.fixedAmount)
  return amount != null ? `Фикс · ${rub(amount)}` : 'Фикс — сумма не указана'
}

function costsText(ev: EventItem): string | null {
  const parts = ([['Призовой фонд', ev.prizeFund], ['Обед', ev.lunchCost], ['Иные', ev.otherCost]] as const)
    .map(([label, v]) => { const n = num(v); return n != null ? `${label} ${rub(n)}` : null })
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function CustomerCard({ ev }: { ev: EventItem }) {
  const name = ev.customerName?.trim() || null
  const phone = ev.customerPhone?.trim() || null
  // Имя заказчика уже стоит заголовком (клуб) — не повторяем его.
  const showName = !!name && name !== eventTitle(ev)
  if (!showName && !phone) return null
  const contacts: [string, string, string][] = phone
    ? [['call', 'Позвонить', telLink(phone)], ['whatsapp', 'WhatsApp', whatsappLink(phone)], ['telegram', 'Telegram', telegramLink(phone)]]
    : []
  return (
    <Card title="Заказчик">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px 10px 16px', minHeight: 56 }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {showName && <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>}
          {phone && <span style={{ fontSize: showName ? 13 : 15, fontWeight: showName ? 400 : 600, color: showName ? MUTED : 'var(--on-surface)', fontVariantNumeric: 'tabular-nums' }}>{phone}</span>}
        </span>
        {contacts.map(([icon, label, url]) => (
          <IconButton key={icon} icon={icon} ariaLabel={label} size={42} onClick={() => openContact(url)} />
        ))}
      </div>
    </Card>
  )
}

interface DetailsProps { ev: EventItem; spaces: SpaceInfo[]; staff: StaffInfo[]; rates: EventRate[] }

export function EventDetails({ ev, spaces, staff, rates }: DetailsProps) {
  const kind = eventKind(ev)
  const address = kind === 'exit' ? (ev.location?.trim() || null) : null
  const taxi = useTaxiCoords(address)
  const responsible = staff.find(s => s.id === ev.responsibleStaffId)?.nickname ?? null
  const costs = kind === 'minicap' ? costsText(ev) : null
  const place = kind === 'titan' && !ev.spaceId ? 'Зона не выбрана' : placeLabel(ev, spaces)

  return (
    <>
      <Card>
        <InfoRow icon="location_on" label={kind === 'exit' ? 'Адрес' : 'Где'}>
          {place}
          {address && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button variant="secondary" size="sm" icon="map" onClick={() => openContact(mapsRouteUrl(address))}>Маршрут</Button>
              <Button variant="secondary" size="sm" icon="local_taxi"
                onClick={() => openContact(taxi ? taxiUrlFromCoords(taxi.lat, taxi.lon) : taxiMapsFallbackUrl(address))}>Такси</Button>
            </div>
          )}
        </InfoRow>
        {responsible && <InfoRow icon="person" label="Ответственный">{responsible}</InfoRow>}
        <InfoRow icon="payments" label="Оплата">{billingText(ev, spaces, rates)}</InfoRow>
        {costs && <InfoRow icon="receipt_long" label="Расходы">{costs}</InfoRow>}
        {ev.maxGuests != null && <InfoRow icon="group" label="Гостей">{ev.maxGuests}</InfoRow>}
        {ev.comment?.trim() && <InfoRow icon="chat" label="Комментарий"><span style={{ fontWeight: 400, whiteSpace: 'pre-wrap' }}>{ev.comment}</span></InfoRow>}
      </Card>
      <CustomerCard ev={ev} />
    </>
  )
}
