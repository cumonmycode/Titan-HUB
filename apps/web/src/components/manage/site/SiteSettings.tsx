'use client'
/**
 * «Сайт → Настройки»: домен сайта (DNS-записи, проверка, сертификат — его выпускает
 * агент на сервере), контакты клуба на сайте и уведомления о заявках (чат персонала
 * в Telegram, бот для гостей). Всё сохраняется в HUB, сайт обновляется за минуту.
 */
import React, { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Icon } from '@/components/Icon'
import { StateView } from '@/components/StateView'
import { useToast } from '@/components/Toast'
import { Button, INP, LBL, SEL } from '@/components/manage/DesignSystem'
import type { SiteConfig, SiteContacts, SiteDomainState } from '@/lib/site'

const CARD: React.CSSProperties = { borderRadius: 18, padding: 16, border: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }
const NOTE: React.CSSProperties = { margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--on-surface-variant)' }
const GOOD = '#34D399'
const WAIT = '#FBBF24'
const BAD = '#F87171'

function CardHead({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={18} color="#a78bfa" />
      <p style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{title}</p>
    </div>
  )
}

function StatusDot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: color, flex: 'none', boxShadow: `0 0 0 3px ${color}22` }} />
}

// ─── Домен ───────────────────────────────────────────────────────────────────
function DnsRow({ host, ok, ips, ip }: { host: string; ok: boolean; ips: string[]; ip: string | null }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.04)' }}>
      <StatusDot color={ok ? GOOD : WAIT} />
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>A · {host}</p>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--on-surface-variant)', overflowWrap: 'anywhere' }}>
          {ok ? `указывает на ${ip}` : ips.length ? `сейчас: ${ips.join(', ')} — нужно ${ip ?? 'IP сервера'}` : `записи нет — нужно ${ip ?? 'IP сервера'}`}
        </p>
      </div>
      <span style={{ fontSize: 12, fontWeight: 800, color: ok ? GOOD : WAIT }}>{ok ? 'Готово' : 'Ждём'}</span>
    </div>
  )
}

function certLine(d: SiteDomainState): { color: string; text: string } {
  const c = d.cert
  if (c?.cert === 'active') {
    const until = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
    return { color: GOOD, text: `Сертификат действует${until ? ` до ${until}` : ''}, продлевается сам` }
  }
  if (c?.cert === 'error') return { color: BAD, text: c.error ?? 'Не удалось выпустить сертификат' }
  if (c?.cert === 'pending') return { color: WAIT, text: c.error ?? 'Ждём DNS-записи' }
  return { color: WAIT, text: 'Сервер проверит домен в течение 5 минут после сохранения' }
}

function SiteDomain() {
  const qc = useQueryClient()
  const { show } = useToast()
  const q = useQuery({ queryKey: ['site-domain'], queryFn: () => api.get<SiteDomainState>('/system/site-domain'), refetchInterval: 60_000 })
  const [domain, setDomain] = useState('')
  const [primary, setPrimary] = useState<'www' | 'apex'>('www')
  useEffect(() => {
    if (q.data) { setDomain(q.data.domain ?? ''); setPrimary(q.data.primary) }
  }, [q.data])
  const save = useMutation({
    mutationFn: () => api.put<SiteDomainState>('/system/site-domain', { domain: domain.trim() || null, primary }),
    onSuccess: (d) => { qc.setQueryData(['site-domain'], d); show(d.domain ? 'Домен сохранён — проверим DNS и выпустим сертификат' : 'Домен снят', 'success') },
    onError: (e: Error) => show(e.message || 'Не удалось сохранить домен', 'error'),
  })
  if (q.isLoading) return <StateView state="loading" />
  if (q.isError || !q.data) return <StateView state="error" title="Домен не загрузился" action={{ label: 'Повторить', onClick: () => void q.refetch() }} />
  const d = q.data
  const dirty = domain.trim() !== (d.domain ?? '') || primary !== d.primary
  const cert = certLine(d)
  return (
    <section className="glass-l2" style={CARD}>
      <CardHead icon="language" title="Домен сайта" />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, alignItems: 'end' }}>
        <div>
          <label style={LBL}>Домен</label>
          <input style={INP} value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="titanmafia.ru" autoCapitalize="none" spellCheck={false} />
        </div>
        <div>
          <label style={LBL}>Основной адрес</label>
          <select style={SEL} value={primary} onChange={(e) => setPrimary(e.target.value === 'apex' ? 'apex' : 'www')}>
            <option value="www">с www</option>
            <option value="apex">без www</option>
          </select>
        </div>
      </div>
      <div>
        <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Сохранить домен</Button>
      </div>
      {d.domain ? (
        <>
          <p style={NOTE}>В панели регистратора домена ({d.domain}) поставьте две A-записи на IP сервера. Остальное HUB сделает сам: проверит записи, выпустит и будет продлевать сертификат.</p>
          <DnsRow host={`@ (${d.domain})`} ok={d.dns.apex.ok} ips={d.dns.apex.ips} ip={d.serverIp} />
          <DnsRow host={`www.${d.domain}`} ok={d.dns.www.ok} ips={d.dns.www.ips} ip={d.serverIp} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot color={cert.color} />
            <span style={{ fontSize: 13 }}>{cert.text}</span>
          </div>
          {d.url && d.cert?.cert === 'active' && (
            <a href={d.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--accent-light)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Icon name="open_in_new" size={15} /> {d.url.replace('https://', '')}
            </a>
          )}
        </>
      ) : (
        <p style={NOTE}>Пока домена нет, сайт открывается по адресу {d.mirror.replace('https://', '')}.</p>
      )}
    </section>
  )
}

// ─── Контакты ────────────────────────────────────────────────────────────────
const CONTACT_FIELDS: { key: keyof SiteContacts; label: string; placeholder: string }[] = [
  { key: 'phone', label: 'Телефон', placeholder: '+7 900 000-00-00' },
  { key: 'email', label: 'Почта', placeholder: 'info@club.ru' },
  { key: 'telegram', label: 'Telegram', placeholder: 'https://t.me/club' },
  { key: 'whatsapp', label: 'WhatsApp', placeholder: 'https://wa.me/79000000000' },
  { key: 'channel', label: 'Telegram-канал', placeholder: 'https://t.me/channel' },
  { key: 'vk', label: 'ВКонтакте', placeholder: 'https://vk.com/club' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/club' },
]

function SiteContactsCard({ config }: { config: SiteConfig }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const [contacts, setContacts] = useState<SiteContacts>(config.contacts)
  useEffect(() => setContacts(config.contacts), [config.contacts])
  const save = useMutation({
    mutationFn: () => api.put('/system/site-config', { contacts }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['site-config'] }); show('Контакты сохранены — сайт обновится в течение минуты', 'success') },
    onError: (e: Error) => show(e.message || 'Не удалось сохранить контакты', 'error'),
  })
  const dirty = CONTACT_FIELDS.some((f) => contacts[f.key] !== config.contacts[f.key])
  return (
    <section className="glass-l2" style={CARD}>
      <CardHead icon="call" title="Контакты на сайте" />
      <p style={NOTE}>Телефон и ссылки в шапке, подвале и на странице «Контакты»; телефон получает и гость в сообщении об отказе.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {CONTACT_FIELDS.map((f) => (
          <div key={f.key}>
            <label style={LBL}>{f.label}</label>
            <input style={INP} value={contacts[f.key]} placeholder={f.placeholder} autoCapitalize="none" spellCheck={false}
              onChange={(e) => setContacts((c) => ({ ...c, [f.key]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div><Button size="sm" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Сохранить контакты</Button></div>
    </section>
  )
}

// ─── Уведомления о заявках ───────────────────────────────────────────────────
function SiteNotifyCard({ config }: { config: SiteConfig }) {
  const qc = useQueryClient()
  const { show } = useToast()
  const groups = config.chats.filter((c) => c.type !== 'private')
  const current = config.notifyChat ? `${config.notifyChat.chatId}|${config.notifyChat.threadId ?? ''}` : ''
  const save = useMutation({
    mutationFn: (value: string) => {
      if (!value) return api.put('/system/site-config', { notifyChat: null })
      const [chatId, thread] = value.split('|')
      return api.put('/system/site-config', { notifyChat: { chatId, threadId: thread ? Number(thread) : null } })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['site-config'] }); show('Сохранено', 'success') },
    onError: (e: Error) => show(e.message || 'Не удалось сохранить', 'error'),
  })
  return (
    <section className="glass-l2" style={CARD}>
      <CardHead icon="notifications" title="Уведомления о заявках" />
      <p style={NOTE}>Push о каждой заявке получают владельцы и администратор открытой смены. Дополнительно заявка с контактами гостя может приходить в чат персонала.</p>
      <div>
        <label style={LBL}>Чат персонала в Telegram</label>
        <select style={SEL} value={current} disabled={!config.staffBot || save.isPending} onChange={(e) => save.mutate(e.target.value)}>
          <option value="">Не отправлять</option>
          {groups.map((c) => (
            <React.Fragment key={c.id}>
              <option value={`${c.id}|`}>{c.title ?? c.id}</option>
              {c.topics.map((t) => <option key={t.threadId} value={`${c.id}|${t.threadId}`}>{`${c.title ?? c.id} → ${t.name ?? `тема ${t.threadId}`}`}</option>)}
            </React.Fragment>
          ))}
        </select>
      </div>
      {!config.staffBot && <p style={NOTE}>Подключите бота групп в «Опросах» — он пишет в чат персонала.</p>}
      {config.staffBot && !groups.length && <p style={NOTE}>Бот пока не видел ни одного чата — добавьте его в чат персонала и напишите там сообщение.</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot color={config.guestBot ? GOOD : WAIT} />
        <span style={{ fontSize: 13 }}>
          {config.guestBot
            ? `Гости получают статус заявки и напоминание через @${config.guestBot}`
            : 'Клиентский бот не подключён — гостям статус в Telegram не придёт'}
        </span>
      </div>
    </section>
  )
}

export function SiteSettings() {
  const q = useQuery({ queryKey: ['site-config'], queryFn: () => api.get<SiteConfig>('/system/site-config') })
  return (
    <>
      <SiteDomain />
      {q.isLoading && <StateView state="loading" />}
      {(q.isError || (!q.isLoading && !q.data)) && <StateView state="error" title="Настройки сайта не загрузились" action={{ label: 'Повторить', onClick: () => void q.refetch() }} />}
      {q.data && <SiteNotifyCard config={q.data} />}
      {q.data && <SiteContactsCard config={q.data} />}
    </>
  )
}
