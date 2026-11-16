import type { Metadata } from 'next'
import { Callout, Code, Lead, Pager, Table } from '../_components/ui'

export const metadata: Metadata = { title: 'Ошибки и лимиты' }

export default function WikiErrors() {
  return (
    <>
      <h1>Ошибки и лимиты</h1>
      <Lead>Какие ошибки возвращает API, что они значат для вашего сервиса и когда повторять запрос.</Lead>

      <h2>Формат ошибки</h2>
      <p>Ошибки Titan Connect приходят с HTTP-кодом и объектом <code>error</code>. Ориентируйтесь на <code>code</code>, а <code>message</code> можно показать человеку — он на русском.</p>
      <Code title="Пример">{`
HTTP/1.1 401 Unauthorized
{
  "error": {
    "code": "invalid_token",
    "message": "Ключ не действует: подключение отключено в Titan HUB или запрос ушёл не на адрес клуба (apiBase)."
  }
}
`}</Code>

      <h2>Коды</h2>
      <Table
        head={['HTTP', 'code', 'Когда', 'Что делать']}
        rows={[
          ['400', <code key="1">invalid_request</code>, 'Неверное тело или параметры запроса.', 'Исправить запрос; повтор не поможет.'],
          ['400', <code key="2">invalid_code</code>, 'Код неверный, истёк или уже использован.', 'Попросить у клуба новый код.'],
          ['400', <code key="3">invalid_cursor</code>, 'Курсор повреждён.', 'Начать синхронизацию заново без курсора.'],
          ['401', <code key="4">unauthorized</code>, <span key="4d">Нет заголовка <code>Authorization: Bearer tcn_…</code>.</span>, 'Добавить ключ.'],
          ['401', <code key="5">invalid_token</code>, 'Ключ отозван или запрос ушёл не на apiBase.', 'Проверить адрес; если он верный — подключение отключено, нужен новый код.'],
          ['403', <code key="6">scope_required</code>, 'Запросу нужно право, которого у подключения нет.', 'Попросить клуб включить право в HUB.'],
          ['404', <code key="7">not_found</code>, 'Клиента с таким id нет.', 'Удалить его у себя.'],
          ['429', <code key="8">too_many_attempts</code>, 'Больше 10 неверных кодов с IP за 15 минут.', 'Подождать 15 минут.'],
        ]}
      />

      <h2>Общие ответы сервера</h2>
      <p>Эти ответы приходят не от Titan Connect, а от сервера целиком, поэтому формат у них другой.</p>
      <Table
        head={['HTTP', 'Тело', 'Что значит']}
        rows={[
          ['402', <code key="a">{'{"error": "subscription_required"}'}</code>, 'У клуба приостановлена подписка Titan HUB — данные временно недоступны. Повторяйте реже, например раз в час.'],
          ['404', <code key="n">{'{"error": "Клуб не найден"}'}</code>, 'Адрес клуба неверный или клуб закрыт. Проверьте apiBase.'],
          ['429', <code key="b">{'{"error": "Too many requests", "retryAfter": 12}'}</code>, <span key="bd">Превышен лимит запросов. Подождите столько секунд, сколько в <code>Retry-After</code>.</span>],
          ['500', <code key="c">{'{"error": "Internal error"}'}</code>, 'Сбой на стороне Titan. Повторите с паузой.'],
          ['502–504', '—', 'Сервер недоступен или обновляется. Повторите с паузой.'],
        ]}
      />

      <h2>Лимиты</h2>
      <ul>
        <li>600 запросов в минуту на один ключ.</li>
        <li>До 200 клиентов на странице (<code>limit</code>).</li>
        <li>Обмен кода: 10 неверных попыток с одного IP за 15 минут.</li>
        <li>Код подключения действует 10 минут и только один раз.</li>
      </ul>

      <h2>Повторы</h2>
      <p>Повторяйте только <code>429</code>, <code>500</code> и <code>502–504</code> — с растущей паузой: 1, 2, 4, 8 секунд и так далее, не больше минуты. Ошибки <code>4xx</code> кроме <code>429</code> повтором не исправить.</p>
      <Callout>
        <p>Все запросы, кроме <code>exchange</code>, <code>token/rotate</code> и <code>DELETE /connection</code>, только читают данные — их безопасно повторять сколько угодно раз. <code>token/rotate</code> не повторяйте вслепую: если ответ потерялся, старый ключ уже не работает, и понадобится новый код от клуба.</p>
      </Callout>

      <h2>Заголовки ответа</h2>
      <ul>
        <li><code>X-Titan-Connect: v1</code> — версия API, ответившего на запрос.</li>
        <li><code>Cache-Control: no-store</code> — ответы с личными данными не кэшируются промежуточными узлами.</li>
      </ul>

      <Pager current="/wiki/errors" />
    </>
  )
}
