'use client'
/**
 * Редактор публикации сайта: заголовок, адрес, вид, дата, текст, до 4 цифр,
 * фото (загрузка со сжатием; первое — обложка), результаты и папка Google Drive.
 */
import React, { useRef, useState } from 'react'
import { Icon } from '@/components/Icon'
import { useToast } from '@/components/Toast'
import { Button, Chip, INP, LBL, ToggleRow } from '@/components/manage/DesignSystem'
import { uploadImage } from '@/lib/upload'
import { STORY_KINDS, photoSrc, slugify, type StoryDraft } from '@/lib/site'

const AREA: React.CSSProperties = { ...INP, minHeight: 140, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }
const MAX_PHOTOS = 24
const MAX_STATS = 4

export function StoryEditor({ value, onChange, isNew }: { value: StoryDraft; onChange: (d: StoryDraft) => void; isNew: boolean }) {
  const { show } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [slugTouched, setSlugTouched] = useState(!isNew)
  const set = <K extends keyof StoryDraft>(k: K, v: StoryDraft[K]) => onChange({ ...value, [k]: v })

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return
    const list = Array.from(files).slice(0, MAX_PHOTOS - value.photos.length)
    setUploading(list.length)
    const urls: string[] = []
    for (const f of list) {
      try { urls.push(await uploadImage(f)) } catch (e) { show((e as Error).message || 'Фото не загрузилось', 'error') }
      setUploading((n) => n - 1)
    }
    if (urls.length) {
      const photos = [...value.photos, ...urls]
      onChange({ ...value, photos, coverUrl: value.coverUrl ?? photos[0] ?? null })
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const removePhoto = (url: string) => {
    const photos = value.photos.filter((p) => p !== url)
    onChange({ ...value, photos, coverUrl: value.coverUrl === url ? photos[0] ?? null : value.coverUrl })
  }
  const setStat = (i: number, patch: Partial<StoryDraft['stats'][number]>) => set('stats', value.stats.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 8 }}>
      <div>
        <label style={LBL}>Название</label>
        <input style={INP} value={value.title} maxLength={120} placeholder="Society Mafia Cup 2026"
          onChange={(e) => onChange({ ...value, title: e.target.value, slug: slugTouched ? value.slug : slugify(e.target.value) })} />
      </div>
      <div>
        <label style={LBL}>Адрес страницы</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--on-surface-variant)', whiteSpace: 'nowrap' }}>titanmafia.ru/</span>
          <input style={INP} value={value.slug} maxLength={40} placeholder="smc2026" onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()) }} />
        </div>
      </div>
      <div>
        <label style={LBL}>Подзаголовок</label>
        <input style={INP} value={value.tagline} maxLength={160} placeholder="Самый большой турнир в КБР" onChange={(e) => set('tagline', e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={LBL}>Вид</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {STORY_KINDS.map((k) => <Chip key={k.id} active={value.kind === k.id} onClick={() => set('kind', k.id)}>{k.label}</Chip>)}
          </div>
        </div>
        <div style={{ minWidth: 170 }}>
          <label style={LBL}>Дата</label>
          <input style={INP} type="date" value={value.eventDate ?? ''} onChange={(e) => set('eventDate', e.target.value || null)} />
        </div>
      </div>
      <div>
        <label style={LBL}>Рассказ</label>
        <textarea style={AREA} value={value.body} maxLength={6000} placeholder="Абзацы разделяйте пустой строкой" onChange={(e) => set('body', e.target.value)} />
      </div>

      <div>
        <label style={LBL}>Цифры</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {value.stats.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 40px', gap: 8 }}>
              <input style={INP} value={s.value} maxLength={24} placeholder="30" onChange={(e) => setStat(i, { value: e.target.value })} />
              <input style={INP} value={s.label} maxLength={40} placeholder="участников" onChange={(e) => setStat(i, { label: e.target.value })} />
              <button type="button" aria-label="Убрать" onClick={() => set('stats', value.stats.filter((_, j) => j !== i))} style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'var(--on-surface-variant)', cursor: 'pointer' }}><Icon name="close" size={16} /></button>
            </div>
          ))}
          {value.stats.length < MAX_STATS && (
            <div><Button size="sm" variant="secondary" onClick={() => set('stats', [...value.stats, { value: '', label: '' }])}>Добавить цифру</Button></div>
          )}
        </div>
      </div>

      <div>
        <label style={LBL}>Фото · {value.photos.length}/{MAX_PHOTOS}</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
          {value.photos.map((url) => {
            const cover = value.coverUrl === url
            return (
              <div key={url} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', aspectRatio: '1', border: cover ? '2px solid var(--primary-violet)' : '1px solid rgba(255,255,255,0.1)' }}>
                <img src={photoSrc(url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <button type="button" onClick={() => set('coverUrl', url)} style={{ position: 'absolute', left: 4, bottom: 4, padding: '3px 6px', borderRadius: 8, border: 'none', fontSize: 10.5, fontWeight: 800, cursor: 'pointer', background: cover ? 'var(--primary-violet)' : 'rgba(0,0,0,0.6)', color: '#fff' }}>{cover ? 'Обложка' : 'Сделать обложкой'}</button>
                <button type="button" aria-label="Убрать фото" onClick={() => removePhoto(url)} style={{ position: 'absolute', top: 4, right: 4, width: 26, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,0.6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={14} /></button>
              </div>
            )
          })}
          {value.photos.length < MAX_PHOTOS && (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading > 0} style={{ aspectRatio: '1', borderRadius: 12, border: '1.5px dashed rgba(255,255,255,0.2)', background: 'transparent', color: 'var(--on-surface-variant)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 12 }}>
              <Icon name={uploading > 0 ? 'hourglass_top' : 'add_photo_alternate'} size={22} />
              {uploading > 0 ? `Ещё ${uploading}…` : 'Добавить'}
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
        <p style={{ fontSize: 11.5, color: 'var(--on-surface-variant)', margin: '6px 0 0' }}>Лучшие 3–6 кадров. Полную галерею дайте ссылкой на папку Google Drive ниже.</p>
      </div>

      <div>
        <label style={LBL}>Папка с фото в Google Drive</label>
        <input style={INP} value={value.galleryUrl} placeholder="https://drive.google.com/drive/folders/…" inputMode="url" onChange={(e) => set('galleryUrl', e.target.value.trim())} />
      </div>
      <div>
        <label style={LBL}>Результаты (GoMafia)</label>
        <input style={INP} value={value.resultsUrl} placeholder="https://gomafia.pro/tournament/…" inputMode="url" onChange={(e) => set('resultsUrl', e.target.value.trim())} />
      </div>
      <ToggleRow label="Опубликовано на сайте" subtitle="Выключите, чтобы скрыть публикацию" value={value.isPublished} onChange={(v) => set('isPublished', v)} />
    </div>
  )
}
