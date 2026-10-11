'use client'
/**
 * Tai во весь экран — вход из навигации (боковая панель, кнопка на «Аналитике» на
 * телефоне). Та же беседа, что в панели Tai поверх кассы и чека.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { TaiChat } from '@/components/tai/TaiChat'
import { useTaiStore } from '@/store/tai.store'

export default function TaiPage() {
  const router = useRouter()
  const setContext = useTaiStore((s) => s.setContext)
  useEffect(() => { setContext({ screen: 'other' }) }, [setContext])
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <TaiChat onClose={() => router.back()} closeOnNavigate={false} />
    </div>
  )
}
