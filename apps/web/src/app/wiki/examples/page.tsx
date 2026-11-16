import type { Metadata } from 'next'
import { Code, Lead, Pager } from '../_components/ui'
import { PY_CLIENT, PY_USAGE, TS_CLIENT, TS_USAGE } from './snippets'

export const metadata: Metadata = { title: 'Примеры кода' }

export default function WikiExamples() {
  return (
    <>
      <h1>Примеры кода</h1>
      <Lead>Готовые клиенты Titan Connect: подключение по коду, поиск клиентов, синхронизация с повторами при перегрузке.</Lead>

      <h2>curl</h2>
      <Code title="Подключение">{`
curl -X POST https://titanpos.ru/api/connect/v1/exchange \\
  -H 'Content-Type: application/json' \\
  -d '{"code": "K7QM-3XPA", "service": {"name": "Рейтинг игроков"}}'
`}</Code>
      <Code title="Поиск, один клиент, изменения">{`
API=https://club.titanpos.ru/api/connect/v1
KEY=tcn_9fQ…

curl "$API/clients?search=тигр" -H "Authorization: Bearer $KEY"
curl "$API/clients/5b0c8a3e-0d7e-4f8a-9c1b-2a6f0e9d1c44" -H "Authorization: Bearer $KEY"
curl "$API/clients?cursor=$SYNC_CURSOR" -H "Authorization: Bearer $KEY"
`}</Code>

      <h2>TypeScript / Node.js</h2>
      <Code title="titan-connect.ts">{TS_CLIENT}</Code>
      <Code title="Как пользоваться">{TS_USAGE}</Code>

      <h2>Python</h2>
      <Code title="titan_connect.py">{PY_CLIENT}</Code>
      <Code title="Как пользоваться">{PY_USAGE}</Code>

      <Pager current="/wiki/examples" />
    </>
  )
}
