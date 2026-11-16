import type { Metadata } from 'next'
import { Callout, Code, Endpoint, Lead, Pager, Table } from '../_components/ui'

export const metadata: Metadata = { title: 'Подключение' }

export default function WikiConnect() {
  return (
    <>
      <h1>Подключение</h1>
      <Lead>
        Как ваш сервис получает доступ к клубу: интерфейс ввода кода, обмен кода на ключ, хранение ключа,
        несколько клубов, переподключение и отключение.
      </Lead>

      <h2>Что сделать в своём интерфейсе</h2>
      <p>Добавьте в настройки вашего сервиса кнопку «Подключить Titan» и поле для кода. Подсказка для пользователя:</p>
      <Callout>
        <p>Откройте Titan HUB → «Управление» → «Настройки клуба» → «Интеграции» → «Titan Connect» → «Подключить сервис». Отметьте, какие данные нужны, нажмите «Получить код» и введите его здесь. Код действует 10 минут.</p>
      </Callout>
      <p>Регистр, пробелы и дефис в коде не важны: <code>k7qm 3xpa</code> и <code>K7QM-3XPA</code> — один и тот же код. После успешного обмена у клуба на экране сразу появится «Сервис подключён».</p>

      <h2>Обмен кода на ключ</h2>
      <Endpoint method="POST" path="/api/connect/v1/exchange" auth={false} />
      <p>
        Отправляйте на <code>https://titanpos.ru</code>: сервер сам найдёт клуб, который выдал код. Если вы
        знаете адрес клуба (например, <code>club.titanpos.ru</code>), можно отправить и туда.
      </p>
      <Code title="Запрос">{`
POST https://titanpos.ru/api/connect/v1/exchange
Content-Type: application/json

{
  "code": "K7QM-3XPA",
  "service": {
    "name": "Рейтинг игроков",
    "url": "https://rating.example"
  }
}
`}</Code>
      <Table
        head={['Поле', 'Обязательно', 'Что это']}
        rows={[
          [<code key="c">code</code>, 'да', 'Код из Titan HUB.'],
          [<code key="n">service.name</code>, 'нет', 'Название вашего сервиса — клуб увидит его в HUB. До 80 символов.'],
          [<code key="u">service.url</code>, 'нет', 'Сайт сервиса, показывается клубу. До 300 символов, полный URL.'],
        ]}
      />
      <Code title="Ответ 200">{`
{
  "accessToken": "tcn_9fQ…",
  "tokenType": "Bearer",
  "expiresAt": null,
  "connectionId": "3f1c2b0e-…",
  "name": "Сайт рейтинга",
  "scopes": ["clients:read", "clients:photos"],
  "apiBase": "https://club.titanpos.ru/api/connect/v1"
}
`}</Code>
      <ul>
        <li><code>expiresAt: null</code> — ключ не истекает.</li>
        <li><code>name</code> — как подключение назвал клуб (может отличаться от вашего <code>service.name</code>).</li>
        <li><code>apiBase</code> — адрес, на который идут все дальнейшие запросы этого подключения.</li>
      </ul>
      <p>Код одноразовый: повторный обмен того же кода вернёт <code>400 invalid_code</code>. После 10 неверных кодов с одного IP обмен закрывается на 15 минут (<code>429 too_many_attempts</code>).</p>

      <h2>Как хранить ключ</h2>
      <ul>
        <li>Только на вашем сервере: в базе, лучше зашифрованным. Не отдавайте его в браузер и не вшивайте в мобильное приложение.</li>
        <li>Храните рядом <code>apiBase</code> и <code>connectionId</code> — по <code>connectionId</code> удобно сопоставлять подключение с тем, что видит клуб.</li>
        <li>Не пишите ключ в логи. Он начинается с <code>tcn_</code> — по этому префиксу его легко маскировать.</li>
      </ul>
      <Callout warn>
        <p>API рассчитано на вызовы с сервера. Из браузера на другом домене запросы не пройдут (CORS) — и это правильно: ключ не должен попадать к посетителям.</p>
      </Callout>

      <h2>Несколько клубов</h2>
      <p>Каждый клуб подключается отдельно и выдаёт свой код. Храните подключения списком:</p>
      <Code title="Пример таблицы у вас">{`
titan_connections
  id              -- ваш id
  account_id      -- ваш пользователь / организация
  connection_id   -- connectionId из ответа exchange
  api_base        -- apiBase из ответа exchange
  access_token    -- accessToken (зашифрован)
  scopes          -- scopes из ответа, для подсказок в интерфейсе
  sync_cursor     -- для синхронизации, см. раздел «Синхронизация»
  created_at
`}</Code>
      <p>Чтобы показать пользователю, какой клуб подключён, вызовите <code>GET /me</code>.</p>

      <h2>Проверить подключение</h2>
      <Endpoint method="GET" path="{apiBase}/me" />
      <Code title="Ответ 200">{`
{
  "connectionId": "3f1c2b0e-…",
  "name": "Сайт рейтинга",
  "scopes": ["clients:read", "clients:photos"],
  "connectedAt": "2026-11-16T10:12:44.000Z",
  "club": { "name": "Titan", "slug": "club" },
  "apiBase": "https://club.titanpos.ru/api/connect/v1"
}
`}</Code>
      <p>Права могут меняться: клуб включает и выключает их в HUB без переподключения. Перечитывайте <code>/me</code>, если вашему интерфейсу важно, какие поля сейчас доступны.</p>
      <Endpoint method="GET" path="{apiBase}/scopes" auth={false} />
      <p>Справочник всех прав с названиями и описаниями — пригодится для подсказки «попросите клуб включить право…».</p>

      <h2>Сменить ключ</h2>
      <Endpoint method="POST" path="{apiBase}/token/rotate" />
      <p>Выдаёт новый ключ, старый перестаёт работать сразу. Используйте, если ключ мог утечь. Сохраните новый ключ сразу после ответа.</p>
      <Code title="Ответ 200">{`
{ "accessToken": "tcn_Lm2…", "tokenType": "Bearer", "expiresAt": null }
`}</Code>

      <h2>Отключение и переподключение</h2>
      <Table
        head={['Что произошло', 'Что увидит ваш сервис', 'Что делать']}
        rows={[
          ['Клуб отключил сервис в HUB', <span key="a"><code>401 invalid_token</code> на любой запрос</span>, 'Пометить подключение отключённым, попросить у клуба новый код.'],
          ['Клуб выдал новый код (переподключение)', 'Старый ключ работает, пока новый код не обменяют', 'Обменять новый код — получите новый ключ, старый перестанет работать.'],
          ['Вы удаляете интеграцию у себя', '—', <span key="d">Вызвать <code>DELETE /connection</code> — у клуба подключение исчезнет.</span>],
        ]}
      />
      <Endpoint method="DELETE" path="{apiBase}/connection" />
      <p>Сервис отключается сам: ключ отзывается, подключение пропадает из HUB клуба. Ответ — <code>{'{ "ok": true }'}</code>.</p>

      <Pager current="/wiki/connect" />
    </>
  )
}
