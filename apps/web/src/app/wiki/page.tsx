import type { Metadata } from 'next'
import { Callout, Cards, Code, Lead, Pager, Steps } from './_components/ui'
import { WIKI_PAGES } from './_components/nav'

// Шаблон заголовка из layout не действует на страницу того же сегмента — задаём целиком.
export const metadata: Metadata = { title: { absolute: 'Titan Connect — вики для разработчиков' } }

export default function WikiHome() {
  return (
    <>
      <h1>Titan Connect</h1>
      <Lead>
        API, через которое ваш проект получает данные клиентов клуба на Titan HUB: ник, имя, статус, фото,
        контакты, депозит, бонусы, посещения. Сайт рейтинга, бот турниров, CRM, приложение для игроков —
        всё, чему нужна база гостей клуба.
      </Lead>

      <h2>Как это работает</h2>
      <Steps
        items={[
          { title: 'Клуб выдаёт одноразовый код', text: <p>Владелец клуба в Titan HUB открывает «Интеграции» → «Titan Connect», выбирает, какие данные увидит ваш сервис, и получает код вида <code>K7QM-3XPA</code>. Код живёт 10 минут.</p> },
          { title: 'Ваш сервис меняет код на ключ', text: <p>Пользователь вводит код в вашем интерфейсе, сервер вызывает <code>POST /exchange</code> и получает постоянный ключ <code>tcn_…</code> и адрес API клуба.</p> },
          { title: 'Дальше — обычные запросы с ключом', text: <p>Ключ бессрочный: повторно вводить код не нужно. Подключение видно и у клуба в HUB, и у вас, пока клуб его не отключит.</p> },
        ]}
      />

      <h2>Быстрый старт</h2>
      <p>Попросите у клуба код и выполните два запроса.</p>
      <Code title="1. Обменять код на ключ">{`
curl -X POST https://titanpos.ru/api/connect/v1/exchange \\
  -H 'Content-Type: application/json' \\
  -d '{"code": "K7QM-3XPA", "service": {"name": "Мой сервис"}}'
`}</Code>
      <Code title="Ответ">{`
{
  "accessToken": "tcn_9fQ…",
  "tokenType": "Bearer",
  "expiresAt": null,
  "connectionId": "3f1c…",
  "name": "Сайт рейтинга",
  "scopes": ["clients:read", "clients:photos"],
  "apiBase": "https://club.titanpos.ru/api/connect/v1"
}
`}</Code>
      <Code title="2. Получить клиентов">{`
curl https://club.titanpos.ru/api/connect/v1/clients?limit=50 \\
  -H 'Authorization: Bearer tcn_9fQ…'
`}</Code>
      <Callout>
        <p>Сохраните <code>accessToken</code> и <code>apiBase</code> вместе: ключ работает только на адресе своего клуба. Если вы подключаете несколько клубов, у каждого своя пара.</p>
      </Callout>

      <h2>Главное о данных</h2>
      <ul>
        <li>Только чтение. Titan Connect ничего не меняет в кассе и базе клуба.</li>
        <li>Клуб решает, что видит ваш сервис (права). Полей без права в ответе нет совсем.</li>
        <li>Все ответы — JSON в UTF-8, даты в ISO 8601 (UTC), суммы в рублях числами.</li>
        <li>Это личные данные гостей: храните ключ на сервере, не в браузере и не в мобильном приложении.</li>
      </ul>

      <h2>Разделы</h2>
      <Cards items={WIKI_PAGES.slice(1)} />

      <Pager current="/wiki" />
    </>
  )
}
