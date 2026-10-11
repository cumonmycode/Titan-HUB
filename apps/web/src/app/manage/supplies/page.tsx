'use client'
// Поставки — вкладка «Операции» раздела «Товары».
// Роут сохранён для старых ссылок и закладок.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SuppliesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/manage/goods?tab=warehouse')
  }, [router])
  return null
}
