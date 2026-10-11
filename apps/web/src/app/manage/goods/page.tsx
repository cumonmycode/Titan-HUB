'use client'
/**
 * «Товары» — меню, ингредиенты и склад одним разделом (вместо «Меню» и «Склада»,
 * 2026-10-08; та же логика, что в приложении). Меню — что продаём, Ингредиенты — из
 * чего собираем блюда, Склад — что меняет остатки. Действие в шапке зависит от вкладки.
 */
import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { PageHeader, Button } from '@/components/manage/DesignSystem'
import { StateView } from '@/components/StateView'
import { Segments } from '@/components/manage/goods/parts'
import { IngredientsTab, MenuTab, WarehouseTab, type StockFilter } from '@/components/manage/goods/tabs'
import { ItemEditor, type EditorTarget } from '@/components/manage/goods/ItemEditor'
import { CategoriesSheet } from '@/components/manage/goods/CategoriesSheet'
import { useGoods } from '@/lib/goods'

type Tab = 'menu' | 'ingredients' | 'warehouse'
// Без иконок: «Ингредиенты» должны помещаться и в узкой панели сплита.
const TABS: { key: Tab; label: string; perm: string }[] = [
  { key: 'menu', label: 'Меню', perm: 'menu' },
  { key: 'ingredients', label: 'Ингредиенты', perm: 'inventory' },
  { key: 'warehouse', label: 'Склад', perm: 'inventory' },
]
/** Старые ссылки (?tab=stock, ?tab=operations) ведут на «Склад». */
const TAB_ALIASES: Record<string, Tab> = { menu: 'menu', ingredients: 'ingredients', warehouse: 'warehouse', stock: 'warehouse', operations: 'warehouse' }

export default function GoodsPage() {
  const role = useAuthStore(s => s.user?.role) ?? 'staff'
  const { data: me } = useQuery({ queryKey: ['auth-me-perms'], queryFn: () => api.get<{ permissions?: Record<string, boolean> }>('/auth/me'), staleTime: 60_000 })
  const allowed = TABS.filter(t => role === 'owner' || me?.permissions?.[t.perm] !== false)
  const [picked, setPicked] = useState<Tab | null>(null)
  const tab = picked && allowed.some(t => t.key === picked) ? picked : allowed[0]?.key
  const [category, setCategory] = useState<string | null>(null)
  const [filter, setFilter] = useState<StockFilter>('all')
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const goods = useGoods()

  // Вкладка в адресе (?tab=) — без useSearchParams, чтобы странице не нужен был Suspense.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && TAB_ALIASES[t]) setPicked(TAB_ALIASES[t])
  }, [])
  const changeTab = (t: Tab) => {
    setPicked(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  const action = tab === 'menu'
    ? { label: 'Позиция', icon: 'add', onClick: () => setEditor({ kind: 'goods', presetCategory: category && category !== 'none' ? category : null }) }
    : tab === 'ingredients'
      ? { label: 'Ингредиент', icon: 'add', onClick: () => setEditor({ kind: 'ingredient' }) }
      : undefined

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title="Товары" subtitle="Меню, ингредиенты и склад" action={action} />
      <div style={{ padding: '16px 16px var(--bottom-nav-clear, 24px)', flex: 1, maxWidth: 'var(--content-narrow)', margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {allowed.length > 1 && tab && <Segments value={tab} onChange={changeTab} items={allowed} />}
        {!tab ? <StateView state="empty" icon="lock" title="Нет доступа" description="Меню и склад закрыты для вашей роли — попросите владельца." />
          : !goods.data ? <StateView state={goods.isError ? 'error' : 'loading'} title={goods.isError ? 'Нет связи' : undefined} description={goods.error?.message} />
          : tab === 'menu' ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="secondary" size="sm" icon="folder_open" onClick={() => setCategoriesOpen(true)}>Категории</Button>
              </div>
              <MenuTab catalog={goods.data} category={category} onCategory={setCategory} />
            </>
          )
          : tab === 'ingredients' ? <IngredientsTab catalog={goods.data} />
          : <WarehouseTab catalog={goods.data} filter={filter} onFilter={setFilter} />}
      </div>
      {goods.data && <ItemEditor target={editor} catalog={goods.data} onClose={() => setEditor(null)} />}
      {goods.data && <CategoriesSheet open={categoriesOpen} catalog={goods.data} onClose={() => setCategoriesOpen(false)} />}
    </div>
  )
}
