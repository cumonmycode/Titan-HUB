'use client'
// «Меню» стало вкладкой раздела «Товары» (2026-10-08).
// Роут сохранён для старых ссылок и закладок.
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MenuRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/manage/goods?tab=menu')
  }, [router])
  return null
}
