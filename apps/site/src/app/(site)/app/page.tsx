/** /app — страница клиентского приложения My Titan: возможности, экраны, загрузка. */
import type { Metadata } from 'next'
import type { LucideIcon } from 'lucide-react'
import { Bell, CircleUserRound, Crown, Dices, Eye, Gift, HandCoins, IdCard, KeyRound, Landmark, Megaphone, Radio, Receipt, Wallet } from 'lucide-react'
import { MY_TITAN } from '@/content/app'
import { getAndroidApk } from '@/lib/apk'
import { StoreBadges } from '@/components/app/AppPromo'
import { PhoneStack } from '@/components/app/PhoneStack'
import { Faq, PageHead, Section, Steps } from '@/components/sections/blocks'

export const revalidate = 300
export const metadata: Metadata = {
  title: 'Приложение My Titan',
  description: 'My Titan — приложение клуба TITAN KBR: карта клуба, бонусы, депозит, оплата через СБП, статистика игровых вечеров и трансляции. Скачайте для iPhone в App Store или для Android с сайта.',
  alternates: { canonical: '/app' },
}

const ICONS: Record<string, LucideIcon> = {
  card: IdCard, gift: Gift, wallet: Wallet, debt: HandCoins, fund: Landmark, receipt: Receipt,
  dice: Dices, live: Radio, crown: Crown, news: Megaphone,
  login: KeyRound, bell: Bell, profile: CircleUserRound, demo: Eye,
}

const FAQ = [
  { q: 'Сколько стоит приложение?', a: 'Нисколько — приложение бесплатное, без подписок и рекламы.' },
  { q: 'Почему Android-версии нет в Google Play?', a: 'Приложение для Android мы раздаём сами, с сайта клуба. Это тот же My Titan, подписанный клубом; обновления приложение предлагает установить само.' },
  { q: 'На каких телефонах работает?', a: `На iPhone с ${MY_TITAN.iosMin} и новее и на современных Android-смартфонах.` },
  { q: 'Я ни разу не был в клубе. Можно зарегистрироваться?', a: 'Да: введите номер и заполните короткую анкету. Бонусы и оплата откроются, как только администратор подтвердит профиль — обычно в тот же вечер.' },
  { q: 'Как войти, если нет Telegram?', a: 'Вход подтверждается в Telegram-боте клуба. Если Telegram у вас нет — подойдите к администратору, он поможет.' },
]

export default async function AppPage() {
  const apk = await getAndroidApk()
  return (
    <>
      <PageHead
        title={<>Клуб Titan<br />в вашем телефоне</>}
        lead={`${MY_TITAN.name} — ${MY_TITAN.lead} ${MY_TITAN.login}`}
        actions={<StoreBadges androidVersion={apk.version} />}
        aside={<PhoneStack />}
      />

      <Section title="Что умеет My Titan" lead="Карта клуба, деньги, игры и эфиры — в одном приложении.">
        {MY_TITAN.groups.map((g) => (
          <div key={g.title} className="app-group">
            <div className="app-group-head">
              <h3>{g.title}</h3>
              <p>{g.lead}</p>
            </div>
            <ul className={`app-grid${g.items.length % 3 ? ' is-pairs' : ''}`}>
              {g.items.map((f) => {
                const Icon = ICONS[f.icon] ?? IdCard
                return (
                  <li key={f.title} className="app-tile glass">
                    <span className="app-tile-icon"><Icon size={22} aria-hidden="true" /></span>
                    <h4>{f.title}</h4>
                    <p>{f.text}</p>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </Section>

      <Section title="Экраны приложения">
        <ul className="app-screens" aria-label="Экраны приложения My Titan">
          {MY_TITAN.screens.map((s) => (
            <li key={s.src} className="phone-flat"><img src={s.src} alt={s.alt} loading="lazy" decoding="async" /></li>
          ))}
        </ul>
      </Section>

      <Section title="Как начать" lead="Пара минут — и карта клуба у вас в телефоне.">
        <Steps items={[...MY_TITAN.start]} />
      </Section>

      <Section id="android" title="Установка на Android" lead="My Titan для Android скачивается с нашего сайта — без Google Play.">
        <Steps items={[...MY_TITAN.androidInstall]} />
        <div className="actions app-android-cta">
          <a className="btn btn-primary btn-lg" href={MY_TITAN.androidUrl} download>Скачать для Android{apk.version ? ` · ${apk.version}` : ''}</a>
        </div>
      </Section>

      <Section title="Вопросы">
        <Faq items={FAQ} />
      </Section>

      <section className="cta-band">
        <div>
          <h2>Скачайте My Titan</h2>
          <p>Бонусы начнут копиться с ближайшего вечера.</p>
        </div>
        <StoreBadges androidVersion={apk.version} />
      </section>
    </>
  )
}
