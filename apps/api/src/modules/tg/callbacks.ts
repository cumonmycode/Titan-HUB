/**
 * Нажатия кнопок под сообщениями Tai: подтверждение входа, карточки действий
 * (выполняются от имени нажавшего — только им же подготовленные) и выбор варианта
 * в вопросе Tai (как будто человек ответил этим текстом).
 */
import { confirmAction, dismissAction } from '../ai/tai/actions.js'
import { createApiCaller } from '../ai/tai/internal.js'
import type { ReplyMarkup } from '../../lib/tgBot.js'
import { escapeHtml } from '../../lib/tgBot.js'
import type { TgClub } from './club.js'
import { staffHeaders, whoIs } from './identity.js'
import type { TgCallbackQuery } from './types.js'
import { confirmApp, confirmLegacy, rejectApp, rejectLegacy } from './login/app.js'
import { confirmHub, rejectHub } from './login/hub.js'
import { actionMarkup, actionText, supplyAltMarkup, supplyMarkup, supplyText } from './dialog/render.js'
import { acceptSupply, cancelSupply, editSupply, supplyCard, type SupplyCtx } from '../ai/tai/supply.js'
import { converse, loadChoice } from './dialog/converse.js'
import { appendMessage, getContact, touchContact } from './dialog/memory.js'
import { onSmmCallback } from '../smm/tg-handlers.js'

const REJECTED_TEXT = '🛡 Вход отклонён — доступ никому не выдан. Если это был не ты, ничего делать не нужно.'
const UUID_RE = /^[0-9a-f-]{36}$/i

export async function onCallback(club: TgClub, cq: TgCallbackQuery): Promise<void> {
  const data = cq.data ?? ''
  const [prefix = '', arg = '', extra = ''] = data.split(':')
  const msg = cq.message
  const edit = async (text: string, markup?: ReplyMarkup) => {
    if (msg) await club.bot.edit(msg.chat.id, msg.message_id, text, { html: true, markup })
  }

  switch (prefix) {
    case 'ac': {
      const r = await confirmApp(club, cq.from, arg)
      await club.bot.answerCallback(cq.id, r.toast)
      await edit(r.text, r.markup)
      return
    }
    case 'ar':
      await rejectApp(club, cq.from, arg)
      await club.bot.answerCallback(cq.id, 'Вход отклонён')
      await edit(REJECTED_TEXT)
      return
    case 'lc': {
      const r = await confirmLegacy(club, cq.from, arg)
      await club.bot.answerCallback(cq.id, r.toast)
      await edit(r.text)
      return
    }
    case 'lr':
      await rejectLegacy(club, arg)
      await club.bot.answerCallback(cq.id, 'Вход отклонён')
      await edit(REJECTED_TEXT)
      return
    case 'hc': {
      const r = await confirmHub(club, cq.from, arg)
      await club.bot.answerCallback(cq.id, r.toast)
      await edit(r.text)
      return
    }
    case 'hr':
      await rejectHub(club, cq.from, arg)
      await club.bot.answerCallback(cq.id, 'Вход отклонён')
      await edit(REJECTED_TEXT)
      return
    case 'ta':
    case 'td':
      await onAction(club, cq, prefix === 'ta', arg)
      return
    case 'tc':
      await onChoice(club, cq, arg, Number(extra))
      return
    case 'sv':
      await onSupply(club, cq, data.split(':'))
      return
    case 'sm':
      await onSmmCallback(club, cq, arg, extra)
      return
    default:
      await club.bot.answerCallback(cq.id)
  }
}

/** Карточка действия Tai: выполнить или отменить — только тот, для кого готовили. */
async function onAction(club: TgClub, cq: TgCallbackQuery, confirm: boolean, id: string): Promise<void> {
  const person = await whoIs(club.db, cq.from)
  if (!person.staff || !person.profile || !UUID_RE.test(id)) {
    await club.bot.answerCallback(cq.id, 'Это действие для сотрудника, который его попросил')
    return
  }
  const msg = cq.message
  if (!confirm) {
    const card = await dismissAction(club.key, person.profile.id, id)
    await club.bot.answerCallback(cq.id, 'Отменено')
    if (msg && card) await club.bot.edit(msg.chat.id, msg.message_id, actionText(card), { html: true })
    return
  }
  const outcome = await confirmAction(club.key, person.profile.id, id, createApiCaller(await staffHeaders(club, person.profile)))
  if (outcome.status !== 200) {
    await club.bot.answerCallback(cq.id, outcome.error)
    return
  }
  const card = outcome.card
  await club.bot.answerCallback(cq.id, card.status === 'done' ? 'Готово' : 'Не получилось')
  if (msg) {
    await club.bot.edit(msg.chat.id, msg.message_id, actionText(card), { html: true, markup: actionMarkup(card, club.host) })
    await appendMessage(club.db, { chatId: String(msg.chat.id), role: 'assistant', content: `${card.status === 'done' ? '✅' : '⚠️'} ${card.title}: ${card.result ?? ''}` })
  }
}

/** Выбор варианта в вопросе Tai — продолжаем разговор этим ответом. */
async function onChoice(club: TgClub, cq: TgCallbackQuery, key: string, index: number): Promise<void> {
  const choice = await loadChoice(club.key, key)
  const reply = choice?.replies[index]
  if (!choice || !reply || choice.tgId !== String(cq.from.id)) {
    await club.bot.answerCallback(cq.id, 'Этот вопрос уже неактуален')
    return
  }
  await club.bot.answerCallback(cq.id)
  const msg = cq.message
  if (msg) await club.bot.edit(msg.chat.id, msg.message_id, `${escapeHtml(msg.text ?? '')}\n\n→ <b>${escapeHtml(reply)}</b>`, { html: true })
  const person = await whoIs(club.db, cq.from)
  const group = msg && msg.chat.type !== 'private' ? msg.chat.title ?? 'Рабочий чат' : null
  const contact = group ? null : (await getContact(club.db, person.tgId)) ?? (await touchContact(club.db, cq.from, person.profile?.id ?? null))
  await converse(club, person, contact, { chatId: choice.chatId, threadId: msg?.message_thread_id ?? null, replyTo: null, groupTitle: group }, reply, false)
}

/** Кнопки карточки поставки: правки, выбор позиции, оплата, «Принять», «Отменить». */
async function onSupply(club: TgClub, cq: TgCallbackQuery, parts: string[]): Promise<void> {
  const [, op = '', id = '', lineRaw = '0', altRaw = '0'] = parts
  const line = Number(lineRaw)
  const person = await whoIs(club.db, cq.from)
  const msg = cq.message
  if (!person.staff || !person.profile || !UUID_RE.test(id) || !msg) {
    await club.bot.answerCallback(cq.id, 'Поставку правят сотрудники клуба')
    return
  }
  const ctx: SupplyCtx = { db: club.db, api: createApiCaller(await staffHeaders(club, person.profile)), clubKey: club.key }
  const show = async (card: Awaited<ReturnType<typeof supplyCard>>) => {
    if (card) await club.bot.edit(msg.chat.id, msg.message_id, supplyText(card), { html: true, markup: supplyMarkup(card, club.host) })
  }
  try {
    if (op === 'n') {
      const card = await supplyCard(ctx, id)
      const alts = card?.lines[line]?.alternatives ?? []
      if (!card || !alts.length) {
        await club.bot.answerCallback(cq.id, 'Других вариантов нет — назови позицию точнее в чат')
        return
      }
      await club.bot.answerCallback(cq.id)
      await club.bot.edit(msg.chat.id, msg.message_id, `${supplyText(card)}\n\nСтрока ${line + 1}: какая это позиция?`, { html: true, markup: supplyAltMarkup(card, line) })
      return
    }
    if (op === 'b') {
      await club.bot.answerCallback(cq.id)
      await show(await supplyCard(ctx, id))
      return
    }
    if (op === 'k') {
      const card = await acceptSupply(ctx, id)
      await club.bot.answerCallback(cq.id, 'Поставка принята')
      await show(card)
      await appendMessage(club.db, { chatId: String(msg.chat.id), role: 'assistant', content: `✅ Поставка принята: ${card.lines.length} поз. на ${Math.round(card.total)} ₽` })
      return
    }
    if (op === 'd') {
      const card = await cancelSupply(ctx, id)
      await club.bot.answerCallback(cq.id, 'Черновик удалён')
      await show(card)
      return
    }
    const card = op === 'a'
      ? await (async () => {
        const current = await supplyCard(ctx, id)
        const alt = current?.lines[line]?.alternatives?.[Number(altRaw)]
        if (!alt) throw new Error('Вариант устарел')
        return editSupply(ctx, id, [{ op: 'match', line, itemId: alt.itemId }])
      })()
      : op === 'c'
        ? await editSupply(ctx, id, [{ op: 'payment', fromRegister: !(await supplyCard(ctx, id))?.fromRegister }])
        : await editSupply(ctx, id, [op === 'x' ? { op: 'remove', line } : { op: 'step', line, direction: op === 'p' ? 1 : -1 }])
    await club.bot.answerCallback(cq.id)
    await show(card)
  } catch (error) {
    await club.bot.answerCallback(cq.id, error instanceof Error ? error.message.slice(0, 180) : 'Не получилось')
  }
}
