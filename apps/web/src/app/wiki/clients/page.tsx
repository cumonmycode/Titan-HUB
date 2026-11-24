import type { Metadata } from 'next'
import { Callout, Code, Endpoint, Lead, Pager, Table } from '../_components/ui'

export const metadata: Metadata = { title: 'Клиенты' }

export default function WikiClients() {
  return (
    <>
      <h1>Клиенты</h1>
      <Lead>Объект клиента, права на поля, список с поиском и постраничной выдачей, один клиент по id.</Lead>

      <h2>Права</h2>
      <p>Клуб выбирает права при подключении и может менять их в любой момент. Поле, на которое нет права, в ответе отсутствует целиком — проверяйте его наличие, а не значение.</p>
      <Table
        head={['Право', 'Поля', 'Что внутри']}
        rows={[
          [<code key="r">clients:read</code>, 'основные', 'Всегда включено. Ник, имя, статус, резидент, персонал, ID GoMafia, даты, удалён ли.'],
          [<code key="p">clients:photos</code>, <code key="pf">photoUrl</code>, 'Ссылка на фото: загруженное в HUB, иначе из Telegram, иначе из GoMafia.'],
          [<code key="c">clients:contacts</code>, <code key="cf">contacts</code>, 'Телефон, дата рождения, Telegram. Открывает поиск по телефону.'],
          [<code key="b">clients:balance</code>, <code key="bf">balance</code>, 'Депозит (минус — долг) и бонусные баллы.'],
          [<code key="v">clients:visits</code>, <code key="vf">visits</code>, 'Сколько вечеров клиент был в клубе.'],
          [<code key="s">streams:publish</code>, <code key="sf">POST /streams</code>, 'Сообщить клубу об эфире: ссылки на трансляцию и донаты. Публиковать ли их через Tai, решает клуб.'],
        ]}
      />

      <h2>Объект клиента</h2>
      <Code title="Client (все права включены)">{`
{
  "id": "5b0c8a3e-0d7e-4f8a-9c1b-2a6f0e9d1c44",
  "nickname": "Тигр",
  "fullName": "Иван Петров",
  "status": { "key": "resident", "label": "Резидент", "color": "#8B5CF6" },
  "isResident": true,
  "isStaff": false,
  "gomafiaId": "4242",
  "registeredAt": "2026-03-01T18:00:00.000Z",
  "updatedAt": "2026-11-16T12:30:05.123456Z",
  "deleted": false,

  "photoUrl": "https://club.titanpos.ru/media/abc.jpg",
  "contacts": {
    "phone": "+7 900 123-45-67",
    "birthday": "1990-05-01",
    "telegram": { "id": "123456789", "username": "tiger" }
  },
  "balance": { "deposit": 1500, "bonusPoints": 120 },
  "visits": { "count": 14 }
}
`}</Code>
      <Table
        head={['Поле', 'Тип', 'Описание']}
        rows={[
          [<code key="1">id</code>, 'uuid', 'Постоянный идентификатор клиента в клубе. Используйте его как ключ у себя.'],
          [<code key="2">nickname</code>, 'string', 'Ник — уникален в клубе, но клиент может его сменить.'],
          [<code key="3">fullName</code>, 'string | null', 'Имя и фамилия, если клуб их знает.'],
          [<code key="4">status</code>, 'object', <span key="4d">Статус клиента в клубе: <code>key</code> для логики, <code>label</code> и <code>color</code> для показа. Статусы клуб заводит сам.</span>],
          [<code key="5">isResident</code>, 'boolean', 'Постоянный гость клуба.'],
          [<code key="6">isStaff</code>, 'boolean', 'Сотрудник или владелец клуба (у них такой же профиль клиента).'],
          [<code key="7">gomafiaId</code>, 'string | null', 'ID игрока на gomafia.pro, если клиент привязан.'],
          [<code key="8">registeredAt</code>, 'ISO-дата', 'Когда клиент появился в клубе.'],
          [<code key="9">updatedAt</code>, 'ISO-дата', 'Последнее изменение профиля, с микросекундами. Основа синхронизации.'],
          [<code key="10">deleted</code>, 'boolean', <span key="10d">Клиент удалён в клубе. В списке приходит при синхронизации или с <code>includeDeleted=true</code>.</span>],
          [<code key="11">photoUrl</code>, 'string | null', 'Абсолютная ссылка на картинку. Кэшируйте у себя, если показываете часто.'],
          [<code key="12">contacts.birthday</code>, 'string | null', <span key="12d">Дата в формате <code>YYYY-MM-DD</code>.</span>],
          [<code key="13">balance.deposit</code>, 'number', 'Рубли, до копеек. Отрицательное значение — долг клиента клубу.'],
        ]}
      />

      <h2>Список клиентов</h2>
      <Endpoint method="GET" path="{apiBase}/clients" />
      <Table
        head={['Параметр', 'Описание']}
        rows={[
          [<code key="l">limit</code>, 'Сколько клиентов на странице: 1–200, по умолчанию 50.'],
          [<code key="s">search</code>, 'Часть ника или имени, без учёта регистра.'],
          [<code key="p">phone</code>, <span key="pd">Телефон в любом виде: сравниваются последние 10 цифр. Нужно право <code>clients:contacts</code>, иначе <code>403 scope_required</code>.</span>],
          [<code key="c">cursor</code>, <span key="cd"><code>nextCursor</code> — следующая страница, <code>syncCursor</code> — изменения с прошлого раза.</span>],
          [<code key="u">updatedSince</code>, 'ISO-дата: только клиенты, изменённые после неё.'],
          [<code key="d">includeDeleted</code>, <span key="dd"><code>true</code> / <code>false</code>. По умолчанию <code>true</code>, если передан <code>cursor</code> или <code>updatedSince</code>, иначе <code>false</code>.</span>],
        ]}
      />
      <Code title="Найти клиента по нику">{`
GET {apiBase}/clients?search=тигр
Authorization: Bearer tcn_…
`}</Code>
      <Code title="Ответ 200">{`
{
  "items": [ { "id": "5b0c…", "nickname": "Тигр", … } ],
  "nextCursor": null,
  "syncCursor": "MjAyNi0xMS0xNlQxMjozMDowNS4xMjM0NTZafDViMGM…"
}
`}</Code>
      <p>
        Клиенты идут по времени изменения (<code>updatedAt</code>, затем <code>id</code>). Если клиентов больше, чем{' '}
        <code>limit</code>, в ответе будет <code>nextCursor</code> — передайте его как <code>?cursor=</code>, чтобы получить
        следующую страницу. На последней странице <code>nextCursor</code> равен <code>null</code>.
      </p>
      <Callout>
        <p>Курсор — непрозрачная строка. Не разбирайте и не собирайте его сами: формат может измениться.</p>
      </Callout>

      <h3>Кто входит в список</h3>
      <ul>
        <li>Клиенты клуба и персонал (<code>isStaff: true</code>).</li>
        <li>Новые анкеты из приложения My Titan, которые клуб ещё не проверил, тоже входят.</li>
        <li>Не входят служебные профили планшетов и анкеты, которые клуб отклонил.</li>
      </ul>

      <h2>Один клиент</h2>
      <Endpoint method="GET" path="{apiBase}/clients/{id}" />
      <p>Тот же объект клиента. Удалённый клиент тоже вернётся — с <code>deleted: true</code>. Если такого id нет — <code>404 not_found</code>.</p>

      <Pager current="/wiki/clients" />
    </>
  )
}
