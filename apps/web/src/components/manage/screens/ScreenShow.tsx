'use client'
/**
 * Показ экрана (раздел «Экраны»): по кругу меню клуба и картинки на весь экран.
 * У каждого элемента — время показа, анимация появления и её скорость, у картинки —
 * ещё вписывание. Картинка появляется поверх того, что на экране; меню — из-под
 * уходящей картинки своей анимацией. Порядок — стрелками, выключенные пропускаются.
 * Всё сохраняется сразу, ТВ подхватывает изменения в течение 20 секунд.
 */
import React, { useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { Sheet, Toggle, ConfirmDialog, Button, Chip, LBL } from '@/components/manage/DesignSystem'
import {
  FITS, MENU_DURATIONS, SLIDE_DURATIONS, SPEEDS, TRANSITIONS, durationLabel, uploadScreenImage, withCurrent,
  type Screen, type ScreenSlide,
} from '@/lib/screens'
import { useScreenItems } from './useScreenItems'

const SEL: React.CSSProperties = { padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface)', fontSize: 14 }
const iconBtn: React.CSSProperties = { width: 30, height: 30, borderRadius: 9, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }
const HINT: React.CSSProperties = { fontSize: 12, color: 'var(--on-surface-variant)', margin: '8px 2px 0', lineHeight: 1.45 }

function speedLabel(ms: number) {
  return SPEEDS.find((s) => s.ms === ms)?.label ?? `${(ms / 1000).toFixed(1).replace('.', ',')} с`
}

/** «10 с · Сдвиг», скорость — только если не обычная: «1 мин · Сдвиг · быстро». */
function summary(it: ScreenSlide) {
  const parts = [durationLabel(it.durationSec), TRANSITIONS.find((x) => x.key === it.transition)?.label ?? 'Растворение']
  if (it.transition !== 'none' && it.transitionMs !== 900) parts.push(speedLabel(it.transitionMs).toLowerCase())
  return parts.join(' · ')
}

/** Миниатюра в пропорциях экрана: меню — фирменной плашкой, картинка — как впишется. */
function Thumb({ it, portrait, large }: { it: ScreenSlide; portrait: boolean; large?: boolean }) {
  const size = large
    ? portrait ? { height: 200, aspectRatio: '9 / 16' } : { width: '100%', maxWidth: 300, aspectRatio: '16 / 9' }
    : portrait ? { width: 28, height: 50 } : { width: 56, height: 32 }
  const box: React.CSSProperties = { ...size, borderRadius: large ? 14 : 8, overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)', background: '#0b0810', margin: large ? '0 auto' : undefined }
  if (it.kind === 'menu') {
    return (
      <div style={{ ...box, background: 'linear-gradient(160deg, #2a1650 0%, #15121b 70%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <Icon name="restaurant_menu" size={large ? 40 : 16} color="#a78bfa" />
        {large && <span style={{ fontSize: 13, fontWeight: 700, color: '#c4b5fd', letterSpacing: '.08em', textTransform: 'uppercase' }}>Меню</span>}
      </div>
    )
  }
  return (
    <div style={box}>
      {it.imageUrl && <img src={it.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: it.fit === 'cover' ? 'cover' : 'contain', display: 'block' }} />}
    </div>
  )
}

export function ScreenShow({ screen, items, isOwner }: { screen: Screen; items: ScreenSlide[]; isOwner: boolean }) {
  const { create, update, remove, move, fail, toast } = useScreenItems(screen.id, 'show')
  const portrait = screen.rotation !== 0
  const fileRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<ScreenSlide | null>(null)
  const editing = items.find((x) => x.id === editId) ?? null
  const activeCount = items.filter((x) => x.isActive).length

  // Номер картинки среди картинок показа — «Картинка 2», а не «Элемент 3».
  const titleOf = (it: ScreenSlide) => {
    if (it.kind === 'menu') return 'Меню'
    return `Картинка ${items.filter((x) => x.kind === 'image').indexOf(it) + 1}`
  }

  // Несколько картинок сразу — по очереди: сжать, загрузить, добавить в конец показа.
  const addImages = async (files: FileList | null) => {
    const picked = files ? Array.from(files) : []
    if (!picked.length) return
    try {
      for (let i = 0; i < picked.length; i++) {
        setUploading(picked.length > 1 ? `Загружаем ${i + 1} из ${picked.length}…` : 'Загружаем…')
        const url = await uploadScreenImage(picked[i]!)
        await create.mutateAsync({ kind: 'image', imageUrl: url, durationSec: 10, transition: 'fade', transitionMs: 900, fit: 'contain' })
      }
      toast(picked.length > 1 ? `Добавлено ${picked.length} картинок — ТВ покажет их в течение 20 секунд` : 'Картинка добавлена — ТВ покажет её в течение 20 секунд', 'success')
    } catch (e) {
      fail(e)
    } finally {
      setUploading(null)
    }
  }

  const replaceImage = async (file: File | undefined) => {
    if (!file || !editing) return
    setUploading('Загружаем…')
    try {
      update.mutate({ id: editing.id, imageUrl: await uploadScreenImage(file) })
    } catch (e) {
      fail(e)
    } finally {
      setUploading(null)
    }
  }

  const addMenu = () => create.mutate(
    { kind: 'menu', durationSec: 60, transition: 'fade', transitionMs: 900 },
    { onSuccess: () => toast('Меню добавлено в показ', 'success') },
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.length === 0 ? (
        <div style={{ padding: '16px 14px', borderRadius: 14, border: '1px dashed rgba(255,255,255,0.14)', fontSize: 13, color: 'var(--on-surface-variant)', textAlign: 'center' }}>
          Показ пуст — экран показывает меню. Добавьте картинки или меню.
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it, i) => (
            <li key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', opacity: it.isActive ? 1 : 0.5 }}>
              <button
                onClick={() => setEditId(it.id)}
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: 'none', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer' }}
                aria-label={`Настроить: ${titleOf(it)}`}
              >
                <Thumb it={it} portrait={portrait} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleOf(it)}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--on-surface-variant)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.isActive ? summary(it) : 'Выключено — пропускается'}
                  </span>
                </span>
              </button>
              {isOwner && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <button style={{ ...iconBtn, opacity: i === 0 ? 0.35 : 1 }} disabled={i === 0} onClick={() => move(items, i, -1)} aria-label="Показывать раньше"><Icon name="arrow_circle_up" size={16} /></button>
                  <button style={{ ...iconBtn, opacity: i === items.length - 1 ? 0.35 : 1 }} disabled={i === items.length - 1} onClick={() => move(items, i, 1)} aria-label="Показывать позже"><Icon name="arrow_circle_down" size={16} /></button>
                  <span style={{ width: 2 }} />
                  <Toggle size="sm" value={it.isActive} onChange={(v) => update.mutate({ id: it.id, isActive: v })} ariaLabel="Показывать на экране" />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {activeCount === 1 && items.length > 0 && (
        <p style={{ ...HINT, margin: '0 2px' }}>Включён один элемент — он стоит на экране без смены.</p>
      )}

      {isOwner ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Button size="sm" variant="secondary" icon="image" loading={!!uploading} onClick={() => fileRef.current?.click()}>Картинки</Button>
          <Button size="sm" variant="secondary" icon="restaurant_menu" loading={create.isPending && !uploading} onClick={addMenu}>Меню</Button>
          {uploading && <span style={{ fontSize: 12, color: 'var(--on-surface-variant)' }}>{uploading}</span>}
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages(e.target.files); e.target.value = '' }} />
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--on-surface-variant)', margin: 0 }}>Показ настраивает владелец.</p>
      )}

      <Sheet open={!!editing} onClose={() => setEditId(null)} title={editing ? titleOf(editing) : ''} desktopSize="md">
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, paddingBottom: 8 }}>
            <Thumb it={editing} portrait={portrait} large />

            <div>
              <label style={LBL}>Показывать</label>
              <select
                style={{ ...SEL, width: '100%' }} value={editing.durationSec} disabled={!isOwner}
                onChange={(e) => update.mutate({ id: editing.id, durationSec: Number(e.target.value) })}
              >
                {withCurrent(editing.kind === 'menu' ? MENU_DURATIONS : SLIDE_DURATIONS, editing.durationSec).map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
              </select>
            </div>

            <div>
              <label style={LBL}>{editing.kind === 'menu' ? 'Как появляется меню' : 'Как появляется картинка'}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {TRANSITIONS.map((t) => (
                  <Chip key={t.key} size="sm" active={editing.transition === t.key} onClick={() => isOwner && update.mutate({ id: editing.id, transition: t.key })}>{t.label}</Chip>
                ))}
              </div>
              <p style={HINT}>
                {editing.kind === 'menu'
                  ? 'Картинка перед меню уходит этой анимацией, меню открывается из-под неё.'
                  : 'Картинка входит поверх того, что на экране, — меню или прошлой картинки.'}
              </p>
            </div>

            {editing.transition !== 'none' && (
              <div>
                <label style={LBL}>Скорость анимации</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {withCurrent(SPEEDS.map((s) => s.ms), editing.transitionMs).map((ms) => (
                    <Chip key={ms} size="sm" active={editing.transitionMs === ms} onClick={() => isOwner && update.mutate({ id: editing.id, transitionMs: ms })}>{speedLabel(ms)}</Chip>
                  ))}
                </div>
              </div>
            )}

            {editing.kind === 'image' && (
              <div>
                <label style={LBL}>Картинка на экране</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {FITS.map((f) => (
                    <Chip key={f.key} size="sm" active={editing.fit === f.key} onClick={() => isOwner && update.mutate({ id: editing.id, fit: f.key })}>{f.label}</Chip>
                  ))}
                </div>
                <p style={HINT}>«Целиком» — вся картинка на её же приглушённом фоне, «Во весь экран» — без полей, края обрезаются.</p>
              </div>
            )}

            {isOwner && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {editing.kind === 'image' && (
                  <>
                    <Button fullWidth variant="secondary" icon="upload_file" loading={!!uploading} onClick={() => replaceRef.current?.click()}>Заменить картинку</Button>
                    <input ref={replaceRef} type="file" accept="image/*" hidden onChange={(e) => { void replaceImage(e.target.files?.[0]); e.target.value = '' }} />
                  </>
                )}
                <Button fullWidth variant="danger" icon="delete" onClick={() => setConfirmDel(editing)}>Убрать из показа</Button>
              </div>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmDialog
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => confirmDel && remove.mutate(confirmDel.id, { onSuccess: () => { setConfirmDel(null); setEditId(null) } })}
        title={confirmDel?.kind === 'menu' ? 'Убрать меню из показа?' : 'Удалить картинку?'}
        message={confirmDel?.kind === 'menu'
          ? 'Без меню экран будет показывать только картинки. Вернуть — кнопкой «Меню».'
          : 'Она пропадёт с экрана ТВ в течение 20 секунд.'}
        confirmLabel={confirmDel?.kind === 'menu' ? 'Убрать' : 'Удалить'}
        danger
        loading={remove.isPending}
      />
    </div>
  )
}
