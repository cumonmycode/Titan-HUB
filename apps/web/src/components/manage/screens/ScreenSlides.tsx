'use client'
/**
 * Реклама в ленте меню (раздел «Экраны»): картинка или карточка с QR по очереди
 * сменяют ленту тарифов и кабинок внизу меню. Панель переворачивается, меню остаётся
 * на месте; картинка лучше широкая (≈3:1). ТВ подхватывает изменения в течение 20 секунд.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Sheet, Toggle, ConfirmDialog, Button, INP, LBL } from '@/components/manage/DesignSystem'
import { SLIDE_DURATIONS, uploadScreenImage, withCurrent, type Screen, type ScreenSlide } from '@/lib/screens'
import { useScreenItems } from './useScreenItems'

type CardDraft = { id?: string; kind: 'image' | 'card'; imageUrl: string | null; title: string; body: string; linkUrl: string; durationSec: number }

const SEL: React.CSSProperties = { padding: '6px 8px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 12.5 }
const iconBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 9, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }

const durations = (current: number) => withCurrent(SLIDE_DURATIONS, current)

/** Миниатюра в пропорциях ленты. */
function Thumb({ s }: { s: ScreenSlide }) {
  const box: React.CSSProperties = { width: 96, height: 34, borderRadius: 8, overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)', background: '#0b0810' }
  if (s.kind === 'image' && s.imageUrl) {
    return <div style={box}><img src={s.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></div>
  }
  return (
    <div style={{ ...box, background: '#8c52ff', display: 'flex', alignItems: 'center', gap: 5, padding: '0 6px' }}>
      {s.linkUrl && <span style={{ width: 22, height: 22, borderRadius: 4, background: '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="qr_code_2" size={16} color="#111" /></span>}
      <span style={{ fontSize: 9.5, fontWeight: 700, color: '#fff', lineHeight: 1.1, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{s.title || 'Карточка'}</span>
    </div>
  )
}

export function ScreenSlides({ screen, slides, isOwner }: { screen: Screen; slides: ScreenSlide[]; isOwner: boolean }) {
  const { create, update, remove, move, fail, toast: show } = useScreenItems(screen.id, 'band')
  const list = slides

  const fileRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [draft, setDraft] = useState<CardDraft | null>(null)
  const [confirmDel, setConfirmDel] = useState<ScreenSlide | null>(null)
  const [origin, setOrigin] = useState('')
  useEffect(() => { setOrigin(window.location.origin) }, [])

  const addImage = async (file: File | undefined) => {
    if (!file) return
    setUploading('Загружаем…')
    try {
      const url = await uploadScreenImage(file)
      await create.mutateAsync({ kind: 'image', imageUrl: url, durationSec: 10 })
      show('Картинка добавлена — ТВ покажет её в течение 20 секунд', 'success')
    } catch (e) {
      fail(e)
    } finally {
      setUploading(null)
    }
  }

  const replaceImage = async (file: File | undefined) => {
    if (!file || !draft) return
    setUploading('Загружаем…')
    try {
      const url = await uploadScreenImage(file)
      setDraft((d) => (d ? { ...d, imageUrl: url } : d))
    } catch (e) {
      fail(e)
    } finally {
      setUploading(null)
    }
  }

  const addMyTitan = () => create.mutate({
    kind: 'card', imageUrl: null,
    title: 'My Titan — твой клуб в телефоне',
    body: 'Баланс, бонусы и запись на игры. Наведи камеру на QR',
    linkUrl: `${origin}/residents`, durationSec: 10,
  }, { onSuccess: () => show('Карточка добавлена — появится на экране в течение 20 секунд', 'success') })

  const openEdit = (s: ScreenSlide) => setDraft({
    id: s.id, kind: s.kind === 'card' ? 'card' : 'image', imageUrl: s.imageUrl, title: s.title ?? '', body: s.body ?? '', linkUrl: s.linkUrl ?? '', durationSec: s.durationSec,
  })

  const saveDraft = () => {
    if (!draft) return
    if (draft.kind === 'card' && !draft.title.trim() && !draft.body.trim() && !draft.linkUrl.trim()) { show('Заполните заголовок, текст или ссылку', 'error'); return }
    const fields = {
      imageUrl: draft.imageUrl, title: draft.title.trim() || null, body: draft.body.trim() || null,
      linkUrl: draft.linkUrl.trim() || null, durationSec: draft.durationSec,
    }
    if (draft.id) update.mutate({ id: draft.id, ...fields }, { onSuccess: () => setDraft(null) })
    else create.mutate({ kind: draft.kind, ...fields }, { onSuccess: () => setDraft(null) })
  }

  const removeSlide = (id: string) => remove.mutate(id, { onSuccess: () => { setConfirmDel(null); setDraft(null) } })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {list.length === 0 ? (
        <div style={{ padding: '16px 14px', borderRadius: 14, border: '1px dashed rgba(255,255,255,0.14)', fontSize: 13, color: 'var(--on-surface-variant)', textAlign: 'center' }}>Рекламы пока нет — внизу меню только лента тарифов.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', opacity: s.isActive ? 1 : 0.55 }}>
              <Thumb s={s} />
              <button
                onClick={() => isOwner && openEdit(s)}
                disabled={!isOwner}
                style={{ flex: '1 1 120px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: isOwner ? 'pointer' : 'default' }}
              >
                <p style={{ fontSize: 13.5, fontWeight: 600, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.kind === 'image' ? `Картинка ${i + 1}` : (s.title || 'Карточка')}
                </p>
                <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.kind === 'card' ? (s.linkUrl ? `QR → ${s.linkUrl.replace(/^https?:\/\//, '')}` : 'Карточка без QR') : 'Нажмите, чтобы заменить'}
                </p>
              </button>
              {/* Управление — справа; на узком экране уходит во вторую строку. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                <select style={SEL} value={s.durationSec} disabled={!isOwner} onChange={(e) => update.mutate({ id: s.id, durationSec: Number(e.target.value) })} aria-label="Время показа">
                  {durations(s.durationSec).map((d) => <option key={d} value={d}>{d} с</option>)}
                </select>
                {isOwner && (
                  <>
                    <button style={{ ...iconBtn, opacity: i === 0 ? 0.35 : 1 }} disabled={i === 0} onClick={() => move(list, i, -1)} aria-label="Показывать раньше"><Icon name="arrow_circle_up" size={16} /></button>
                    <button style={{ ...iconBtn, opacity: i === list.length - 1 ? 0.35 : 1 }} disabled={i === list.length - 1} onClick={() => move(list, i, 1)} aria-label="Показывать позже"><Icon name="arrow_circle_down" size={16} /></button>
                  </>
                )}
                <Toggle size="sm" value={s.isActive} onChange={(v) => isOwner && update.mutate({ id: s.id, isActive: v })} ariaLabel="Показывать на экране" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isOwner ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Button size="sm" variant="secondary" icon="add" loading={!!uploading} onClick={() => fileRef.current?.click()}>Картинка</Button>
          <Button size="sm" variant="secondary" icon="description" onClick={() => setDraft({ kind: 'card', imageUrl: null, title: '', body: '', linkUrl: '', durationSec: 10 })}>Карточка с QR</Button>
          <Button size="sm" variant="secondary" icon="qr_code_2" loading={create.isPending && !draft && !uploading} onClick={addMyTitan}>QR приложения My Titan</Button>
          {uploading && <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{uploading}</span>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void addImage(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>Рекламу настраивает владелец.</p>
      )}

      <Sheet open={!!draft} onClose={() => setDraft(null)} title={draft?.kind === 'image' ? 'Картинка' : draft?.id ? 'Карточка' : 'Новая карточка'} desktopSize="md">
        {draft && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 }}>
            {draft.kind === 'image' ? (
              <>
                {draft.imageUrl && <img src={draft.imageUrl} alt="" style={{ width: '100%', aspectRatio: '3 / 1', objectFit: 'contain', background: '#0b0810', borderRadius: 12, display: 'block' }} />}
                <Button variant="secondary" icon="upload_file" loading={!!uploading} onClick={() => replaceRef.current?.click()}>Заменить картинку</Button>
                <input ref={replaceRef} type="file" accept="image/*" hidden onChange={(e) => { void replaceImage(e.target.files?.[0]); e.target.value = '' }} />
              </>
            ) : (
              <>
                <label style={LBL}>Заголовок</label>
                <input style={INP} value={draft.title} maxLength={80} placeholder="My Titan — твой клуб в телефоне" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                <label style={LBL}>Текст</label>
                <textarea style={{ ...INP, minHeight: 72, resize: 'vertical' }} value={draft.body} maxLength={240} placeholder="Баланс, бонусы и запись на игры" onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                <label style={LBL}>Ссылка для QR</label>
                <input style={INP} value={draft.linkUrl} placeholder="https://…" inputMode="url" onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} />
                <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '-6px 0 0' }}>QR рисуется автоматически. Без ссылки карточка будет только с текстом.</p>
              </>
            )}
            <label style={LBL}>Показывать</label>
            <select style={{ ...SEL, padding: '10px 12px', fontSize: 14 }} value={draft.durationSec} onChange={(e) => setDraft({ ...draft, durationSec: Number(e.target.value) })}>
              {durations(draft.durationSec).map((d) => <option key={d} value={d}>{d} секунд</option>)}
            </select>
            <Button fullWidth loading={create.isPending || update.isPending} onClick={saveDraft}>Сохранить</Button>
            {draft.id && (
              <Button fullWidth variant="danger" icon="delete" onClick={() => setConfirmDel(slides.find((x) => x.id === draft.id) ?? null)}>Удалить слайд</Button>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && removeSlide(confirmDel.id)}
        title="Удалить слайд?"
        message="Она пропадёт с экрана ТВ в течение 20 секунд."
        confirmLabel="Удалить"
        danger
        loading={remove.isPending}
      />
    </div>
  )
}
