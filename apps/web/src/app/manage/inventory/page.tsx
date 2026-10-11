'use client'
// «Склад» стал вкладками «Остатки» и «Операции» раздела «Товары» (2026-10-08), «Расходы» — отдельный раздел.
// Роут сохранён для старых ссылок и закладок.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function InventoryRedirect() {
  const router = useRouter()
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab')
    if (tab === 'expenses') router.replace('/manage/expenses')
    else router.replace(tab === 'items' ? '/manage/goods?tab=ingredients' : '/manage/goods?tab=warehouse')
  }, [router])
  return null
}
