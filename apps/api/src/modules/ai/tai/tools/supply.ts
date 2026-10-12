/**
 * Поставка со слов: Tai разбирает фразу на строки (название, сколько, в чём, цена),
 * сервер сопоставляет их со складом и создаёт черновик прихода. Черновик правится
 * карточкой или словами и принимается кнопкой «Принять» — сам Tai не проводит.
 */
import { createSupply, editSupply, supplyMemo, type SpokenLine, type SupplyOp } from '../supply.js'
import type { ToolDef, ToolResult } from './types.js'

const LINE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Название, как сказали: «кола 0,5», «сахар», «Мальборо»' },
    count: { type: 'number', description: 'Сколько в единицах unit' },
    unit: { type: 'string', enum: ['pcs', 'pack', 'kg', 'g', 'l', 'ml'], description: 'pcs — штуки/бутылки, pack — пачки/блоки/коробки/упаковки, kg, g, l, ml' },
    price: { type: 'number', description: 'Цена за названную единицу, если сказали' },
    total: { type: 'number', description: 'Сумма за всю строку, если сказали' },
  },
  required: ['name', 'count'],
}

function spokenOf(raw: unknown): SpokenLine | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r['name'] === 'string' ? r['name'].trim() : ''
  const count = Number(r['count'])
  if (!name || !Number.isFinite(count) || count <= 0) return null
  const unit = typeof r['unit'] === 'string' && ['pcs', 'pack', 'kg', 'g', 'l', 'ml'].includes(r['unit']) ? (r['unit'] as SpokenLine['unit']) : 'pcs'
  const price = Number(r['price'])
  const total = Number(r['total'])
  return { name, count, unit, ...(Number.isFinite(price) && price > 0 ? { price } : {}), ...(Number.isFinite(total) && total > 0 ? { total } : {}) }
}

const proposeSupply: ToolDef = {
  name: 'propose_supply',
  description:
    'Собрать поставку (приход на склад) из того, что перечислил пользователь: каждая позиция — отдельная строка. ' +
    'Создаёт черновик и показывает карточку, где можно поправить и принять. Цены не выдумывай: не сказали — не передавай.',
  parameters: {
    type: 'object',
    properties: { lines: { type: 'array', items: LINE_SCHEMA }, supplier: { type: 'string', description: 'Поставщик, если назвали' } },
    required: ['lines'],
  },
  status: () => 'Собираю поставку…',
  async run(args, ctx): Promise<ToolResult> {
    const lines = (Array.isArray(args['lines']) ? args['lines'] : []).map(spokenOf).filter((l): l is SpokenLine => !!l)
    if (!lines.length) return { data: { error: 'Не понял позиции — перечисли «название и количество»' } }
    const card = await createSupply({ db: ctx.db, api: ctx.api, clubKey: ctx.clubKey }, lines, typeof args['supplier'] === 'string' ? args['supplier'] : null)
    const doubtful = card.lines.filter((l) => l.uncertain).map((l) => `${l.index + 1}) ${l.said ?? l.name}`)
    return {
      blocks: [{ type: 'supply', supply: card }],
      memo: supplyMemo(card),
      data: { supplyId: card.id, lines: card.lines.length, total: card.total, doubtful, shown: 'Карточка показана: проверить, поправить и нажать «Принять»' },
      terminal: true,
    }
  },
}

const editSupplyTool: ToolDef = {
  name: 'edit_supply',
  description:
    'Поправить черновик поставки словами пользователя. supplyId — из памяти диалога («черновик поставки …»), line — номер строки с 1. ' +
    'Операции: quantity (новое количество в единицах склада), price (цена за единицу склада), remove, respeak (строку назвали иначе — name/count/unit), add (новая строка), supplier, payment (fromRegister: оплата из кассы).',
  parameters: {
    type: 'object',
    properties: {
      supplyId: { type: 'string' },
      ops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['quantity', 'price', 'remove', 'respeak', 'add', 'supplier', 'payment'] },
            line: { type: 'number' },
            quantity: { type: 'number' },
            price: { type: 'number' },
            item: LINE_SCHEMA,
            supplier: { type: 'string' },
            fromRegister: { type: 'boolean' },
          },
          required: ['op'],
        },
      },
    },
    required: ['supplyId', 'ops'],
  },
  status: () => 'Правлю поставку…',
  async run(args, ctx): Promise<ToolResult> {
    const id = String(args['supplyId'] ?? '')
    const ops: SupplyOp[] = []
    for (const raw of Array.isArray(args['ops']) ? args['ops'] : []) {
      const o = raw as Record<string, unknown>
      const line = Number(o['line']) - 1
      const spoken = spokenOf(o['item'])
      if (o['op'] === 'quantity' && Number.isFinite(Number(o['quantity']))) ops.push({ op: 'quantity', line, quantity: Number(o['quantity']) })
      else if (o['op'] === 'price' && Number.isFinite(Number(o['price']))) ops.push({ op: 'price', line, costPerUnit: Number(o['price']) })
      else if (o['op'] === 'remove') ops.push({ op: 'remove', line })
      else if (o['op'] === 'respeak' && spoken) ops.push({ op: 'respeak', line, spoken })
      else if (o['op'] === 'add' && spoken) ops.push({ op: 'add', spoken })
      else if (o['op'] === 'supplier' && typeof o['supplier'] === 'string') ops.push({ op: 'supplier', supplier: o['supplier'] })
      else if (o['op'] === 'payment' && typeof o['fromRegister'] === 'boolean') ops.push({ op: 'payment', fromRegister: o['fromRegister'] })
    }
    if (!ops.length) return { data: { error: 'Не понял, что поправить' } }
    // Удаление строк — с конца, чтобы номера остальных не съехали.
    ops.sort((a, b) => (a.op === 'remove' && b.op === 'remove' ? b.line - a.line : 0))
    const card = await editSupply({ db: ctx.db, api: ctx.api, clubKey: ctx.clubKey }, id, ops)
    return { blocks: [{ type: 'supply', supply: card }], memo: supplyMemo(card), data: { supplyId: card.id, total: card.total, shown: 'Обновлённая карточка показана' }, terminal: true }
  },
}

export const SUPPLY_TOOLS: ToolDef[] = [proposeSupply, editSupplyTool]
