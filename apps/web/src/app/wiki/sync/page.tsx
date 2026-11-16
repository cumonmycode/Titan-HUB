import type { Metadata } from 'next'
import { Callout, Code, Lead, Pager, Steps } from '../_components/ui'

export const metadata: Metadata = { title: 'Синхронизация' }

export default function WikiSync() {
  return (
    <>
      <h1>Синхронизация</h1>
      <Lead>
        Как держать у себя копию базы клиентов клуба и забирать только то, что изменилось, — без повторной
        выгрузки всех клиентов.
      </Lead>

      <h2>Алгоритм</h2>
      <Steps
        items={[
          { title: 'Первая загрузка', text: <p>Запрашивайте <code>GET /clients?limit=200</code> и идите по <code>nextCursor</code>, пока он не станет <code>null</code>. Каждого клиента сохраняйте по <code>id</code>.</p> },
          { title: 'Запомните syncCursor', text: <p>Из последнего ответа возьмите <code>syncCursor</code> и сохраните рядом с подключением.</p> },
          { title: 'Забирайте изменения', text: <p>Периодически запрашивайте <code>GET /clients?cursor=&lt;syncCursor&gt;</code>. Придут только клиенты, изменённые с прошлого раза, — и удалённые с <code>deleted: true</code>. Если в ответе есть <code>nextCursor</code>, дочитайте страницы.</p> },
          { title: 'Сохраните новый syncCursor', text: <p>После каждого успешного прохода сохраняйте <code>syncCursor</code> из последнего ответа. Если изменений не было, он вернётся прежним.</p> },
          { title: 'Удалённые после первой загрузки', text: <p>Первая загрузка удалённых не отдаёт, а проход по курсору — отдаёт. Поэтому сразу после неё могут прийти клиенты, удалённые ещё раньше, с <code>deleted: true</code>. Тех, кого у вас нет, просто пропустите.</p> },
        ]}
      />

      <Code title="Псевдокод">{`
cursor = connection.sync_cursor            # null при первой загрузке

repeat:
    page = GET {apiBase}/clients?limit=200 (+ &cursor=<cursor>, если он есть)
    for client in page.items:
        if client.deleted: delete_local(client.id)
        else:              upsert_local(client)
    cursor = page.syncCursor ?? cursor
until page.nextCursor is null

connection.sync_cursor = cursor            # сохраните только после успеха
`}</Code>

      <Callout>
        <p>Обновляйте курсор в базе только после того, как сохранили клиентов. Если проход упал посередине, повторите его со старым курсором: записи придут ещё раз, и <code>upsert</code> по <code>id</code> их спокойно перезапишет.</p>
      </Callout>

      <h2>Что считается изменением</h2>
      <ul>
        <li>Любое изменение профиля: ник, имя, фото, статус, телефон, дата рождения, Telegram.</li>
        <li>Депозит и бонусы — каждое пополнение, списание или начисление меняет профиль.</li>
        <li>Удаление клиента в клубе — придёт с <code>deleted: true</code>.</li>
      </ul>
      <Callout warn>
        <p>Число посещений (<code>visits.count</code>) растёт вместе с чеками, а не с профилем, поэтому само по себе не попадает в изменения. Если оно вам важно, перечитывайте нужных клиентов через <code>GET /clients/{'{id}'}</code>.</p>
      </Callout>

      <h2>Как часто опрашивать</h2>
      <ul>
        <li>Для витрины или рейтинга хватит раза в 5–15 минут.</li>
        <li>Если нужно почти сразу — раз в минуту: пустой ответ стоит дёшево.</li>
        <li>Не чаще раза в несколько секунд на подключение: лимит — 600 запросов в минуту на ключ.</li>
      </ul>

      <h2>Начать с даты</h2>
      <p>Если копия базы у вас уже есть, а курсора нет, начните с <code>?updatedSince=2026-11-01T00:00:00Z</code> — придут все, кто менялся после этой даты, включая удалённых. Дальше работайте с <code>syncCursor</code> как обычно.</p>

      <Pager current="/wiki/sync" />
    </>
  )
}
