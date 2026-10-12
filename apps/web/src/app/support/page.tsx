/**
 * Поддержка приложения My Titan — публичная страница (Support URL в App Store
 * и Google Play): как войти, частые вопросы, контакты.
 */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Поддержка My Titan',
  description: 'Как войти в приложение My Titan, пополнить депозит и связаться с клубом.',
}

const FAQ: { q: string; a: string }[] = [
  { q: 'Как войти в приложение?', a: 'Введите номер телефона и нажмите «Подтвердить в Telegram». Откроется бот клуба Tai (@tigran_ai_bot) — подтвердите вход и вернитесь в приложение. В веб-версии можно отправить боту 4-значный код с экрана входа.' },
  { q: 'Бот пишет, что аккаунт не привязан', a: 'Ваш Telegram ещё не связан с профилем клиента. Попросите администратора клуба прислать ссылку привязки — после неё вход заработает.' },
  { q: 'Как пополнить депозит или погасить долг?', a: 'На главном экране нажмите «Пополнить» или «Погасить долг», введите сумму и оплатите через СБП в приложении банка. Деньги зачислятся, как только банк подтвердит платёж, — придёт уведомление.' },
  { q: 'Почему к оплате больше, чем я ввёл?', a: 'При онлайн-оплате банк-эквайер берёт комиссию 8 %. На баланс зачисляется ровно введённая сумма.' },
  { q: 'Оплатил, но баланс не изменился', a: 'Обычно зачисление занимает до минуты. Если прошло больше 15 минут, напишите боту Tai (@tigran_ai_bot) или администратору клуба — проверим платёж.' },
  { q: 'Как отключить уведомления?', a: 'Профиль → Уведомления: можно отдельно выключить push, сообщения в Telegram и новости клуба.' },
  { q: 'Как удалить профиль?', a: 'Напишите боту Tai (@tigran_ai_bot) или обратитесь к администратору клуба — удалим профиль и данные, кроме тех, что закон обязывает хранить.' },
]

export default function SupportPage() {
  return (
    <main style={{ minHeight: '100dvh', height: '100dvh', overflowY: 'auto', background: '#15121b', color: '#e2e8f0' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: 'calc(32px + env(safe-area-inset-top)) 20px calc(48px + env(safe-area-inset-bottom))', lineHeight: 1.6, fontSize: 15 }}>
        <p style={{ color: '#a78bfa', fontSize: 12, fontWeight: 800, letterSpacing: 3, margin: 0 }}>MY TITAN</p>
        <h1 style={{ color: '#fff', fontSize: 28, fontWeight: 800, margin: '8px 0 8px', lineHeight: 1.25 }}>Поддержка</h1>
        <p style={{ margin: '0 0 24px', color: '#cbd5e1' }}>
          My Titan — приложение для клиентов клуба Titan: бонусы, депозит, история операций, оплата через СБП и уведомления.
        </p>
        <a href="https://t.me/tigran_ai_bot" style={{ display: 'inline-block', padding: '13px 22px', borderRadius: 14, background: '#2AABEE', color: '#fff', fontWeight: 700, textDecoration: 'none', marginBottom: 28 }}>
          Написать Tai в Telegram: @tigran_ai_bot
        </a>
        {FAQ.map((f) => (
          <section key={f.q} style={{ padding: '16px 18px', borderRadius: 16, background: '#1d1a24', border: '1px solid rgba(255,255,255,0.08)', marginBottom: 12 }}>
            <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: '0 0 6px' }}>{f.q}</h2>
            <p style={{ margin: 0, color: '#cbd5e1' }}>{f.a}</p>
          </section>
        ))}
        <p style={{ color: '#94A3B8', fontSize: 13, marginTop: 24 }}>
          <a href="/privacy" style={{ color: '#a78bfa' }}>Политика конфиденциальности</a>
        </p>
      </div>
    </main>
  )
}
