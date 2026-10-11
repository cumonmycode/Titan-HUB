'use client'
/**
 * «Мероприятия» — лента по дням. Шапка с ОДНОЙ кнопкой «Создать» (единая форма:
 * В клубе | Выезд | Миникап), вкладки «Предстоящие · N» / «Прошедшие».
 * Предстоящие: заявки с сайта, затем дни (Сегодня / Завтра / «Пт, 10 октября»);
 * идущие сейчас — тоже предстоящие. Тап по событию → просмотр с одним главным
 * действием по статусу, остальное — в меню «⋯».
 *
 * Страница рендерится и на /events (вкладка нижней навигации, диплинки), и на
 * /manage/events (сплит «Управления»): там слева кнопка «назад»/«закрыть раздел».
 */
import React, { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { useAuthStore } from '@/store/auth.store'
import { PullToRefreshContainer } from '@/components/PullToRefreshContainer'
import { StateView } from '@/components/StateView'
import { Segments } from '@/components/manage/goods/parts'
import { EventsHeader } from '@/components/events/EventsHeader'
import { BookingRequests } from '@/components/events/BookingRequests'
import { PastList, UpcomingList, countUpcoming, hasPast, type ListContext } from '@/components/events/EventsList'
import { EventView } from '@/components/events/EventView'
import { EventForm } from '@/components/events/EventForm'
import type { BookingRequest, EventItem, EventRate, SpaceInfo, StaffInfo } from '@/components/events/lib'

type Tab = 'upcoming' | 'past'
const PENDING_REFETCH_MS = 60_000

export default function EventsPage() {
  const qc = useQueryClient()
  const { show } = useToast()
  const pathname = usePathname()
  const inManageSplit = !!pathname && pathname.startsWith('/manage')
  const isOwner = useAuthStore(s => s.user?.role) === 'owner'

  const [tab, setTab] = useState<Tab>('upcoming')
  const [formOpen, setFormOpen] = useState(false)
  const [editEvent, setEditEvent] = useState<EventItem | null>(null)
  // Просматриваемое событие: id + снимок (новый миникап может ещё не прийти в ленту).
  const [view, setView] = useState<EventItem | null>(null)

  const eventsQ = useQuery({ queryKey: ['events'], queryFn: () => api.get<{ events: EventItem[] }>('/events') })
  const events = eventsQ.data?.events ?? []
  const { data: pendingData } = useQuery({
    queryKey: ['bookings-pending'],
    queryFn: () => api.get<{ bookings: BookingRequest[] }>('/bookings?status=new'),
    refetchInterval: PENDING_REFETCH_MS,
  })
  const pending = pendingData?.bookings ?? []
  const { data: staffData } = useQuery({ queryKey: ['staff'], queryFn: () => api.get<{ staff: StaffInfo[] }>('/staff') })
  const { data: spacesData } = useQuery({ queryKey: ['pos', 'spaces'], queryFn: () => api.get<{ spaces: SpaceInfo[] }>('/pos/spaces') })
  const { data: ratesData } = useQuery({
    queryKey: ['pricing', 'event-rates'],
    queryFn: () => api.get<{ rates: { hours: number; price: string }[] }>('/pricing/event-rates'),
  })
  const staff = staffData?.staff ?? []
  const spaces = spacesData?.spaces ?? []
  const rates: EventRate[] = (ratesData?.rates ?? []).map(r => ({ hours: r.hours, price: parseFloat(String(r.price)) || 0 }))

  const viewed = view ? (events.find(e => e.id === view.id) ?? view) : null

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['events'] }),
      qc.invalidateQueries({ queryKey: ['bookings-pending'] }),
    ])
  }

  function openCreate() { setEditEvent(null); setView(null); setFormOpen(true) }
  function openEdit(ev: EventItem) { setView(null); setEditEvent(ev); setFormOpen(true) }

  // Заявка подтверждена → сервер создал мероприятие; сразу открываем его форму.
  async function onBookingConfirmed(eventId: string | null) {
    if (!eventId) return
    try {
      const r = await api.get<{ event: EventItem }>(`/events/${eventId}`)
      if (r?.event) openEdit(r.event)
    } catch (e) {
      show((e as Error)?.message || 'Мероприятие создано, но открыть его не удалось', 'error')
    }
  }

  const ctx: ListContext = { spaces, rates, onOpen: setView }
  const upcomingCount = countUpcoming(events)

  function renderBody() {
    if (eventsQ.isLoading) return <StateView state="loading" />
    if (eventsQ.isError) return <StateView state="error" title="Не удалось загрузить мероприятия" description={(eventsQ.error as Error)?.message} action={{ label: 'Повторить', icon: 'refresh', onClick: () => eventsQ.refetch() }} />
    if (tab === 'upcoming') {
      return (
        <>
          <BookingRequests bookings={pending} onConfirmed={onBookingConfirmed} />
          {upcomingCount > 0
            ? <UpcomingList events={events} ctx={ctx} />
            : pending.length === 0 && <StateView state="empty" icon="event" title="Предстоящих мероприятий нет" />}
        </>
      )
    }
    return hasPast(events) ? <PastList events={events} ctx={ctx} /> : <StateView state="empty" icon="history" title="Прошедших мероприятий нет" />
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%' }}>
      <EventsHeader inManageSplit={inManageSplit} onCreate={openCreate} />

      {/* Контент со свайпом для обновления (свой PTR-контейнер, глобальный здесь выключен) */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <PullToRefreshContainer onRefresh={refresh}>
          <div style={{ padding: '14px 16px var(--bottom-nav-clear)', maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Segments<Tab> value={tab} onChange={setTab} items={[
              { key: 'upcoming', label: `Предстоящие · ${upcomingCount}`, icon: 'event' },
              { key: 'past', label: 'Прошедшие', icon: 'history' },
            ]} />
            {renderBody()}
          </div>
        </PullToRefreshContainer>
      </div>

      <EventForm
        open={formOpen}
        editEvent={editEvent}
        onClose={() => setFormOpen(false)}
        onMinicapCreated={(ev) => setView(ev)}
        spaces={spaces} staff={staff} rates={rates}
      />
      <EventView
        event={viewed}
        onClose={() => setView(null)}
        onEdit={openEdit}
        spaces={spaces} staff={staff} rates={rates}
        isOwner={isOwner}
      />
    </div>
  )
}
