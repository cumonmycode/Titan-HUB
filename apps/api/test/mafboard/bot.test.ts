import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleBotUpdate } from '../../src/modules/mafboard/bot.js'
import { call, callback, config, createTestContext, DEVICE_SECRET, message, TG_USER, type TestContext } from './helpers.js'

function botDeps(ctx: TestContext) {
  return { repo: ctx.repo, messenger: ctx.messenger, config, now: () => ctx.clock.now }
}

async function startLogin(ctx: TestContext, deviceName = 'iPhone Кая'): Promise<{ ticketId: string; code: string; confirmationCode: string }> {
  const start = await call(ctx, 'POST', '/v1/auth/telegram/start', {
    body: { deviceName, platform: 'ios', deviceSecret: DEVICE_SECRET },
  })
  assert.equal(start.status, 200)
  return {
    ticketId: start.json.id,
    code: new URL(start.json.deepLink).searchParams.get('start') ?? '',
    confirmationCode: start.json.confirmationCode,
  }
}

const send = (ctx: TestContext, update: unknown) => handleBotUpdate(update as never, botDeps(ctx))

/** Кнопки с кодами в последнем сообщении бота. */
function codeButtons(ctx: TestContext): string[] {
  const markup = ctx.messenger.last?.markup
  if (!markup || !('inline_keyboard' in markup)) return []
  return markup.inline_keyboard.flat().map((b) => b.text).filter((t) => /^\d{2}$/.test(t))
}

async function reachConfirm(ctx: TestContext, code: string): Promise<void> {
  await send(ctx, message(TG_USER, { text: `/start ${code}` }))
  await send(ctx, callback(TG_USER, ctx.messenger.callbackFor('Принимаю')))
  await send(ctx, message(TG_USER, { contact: { phone_number: '79161234567', user_id: TG_USER.id } }))
}

describe('бот входа MafBoard', () => {
  it('новый пользователь: соглашение → номер → сверка кода → ссылка возврата', async () => {
    const ctx = createTestContext()
    const { ticketId, code, confirmationCode } = await startLogin(ctx)
    assert.match(confirmationCode, /^\d{2}$/)

    await send(ctx, message(TG_USER, { text: `/start ${code}` }))
    assert.match(ctx.messenger.last?.text ?? '', /пользовательское соглашение/)
    assert.equal((await ctx.repo.ticketById(ticketId))?.openedAt?.toISOString(), ctx.clock.now.toISOString())

    await send(ctx, callback(TG_USER, ctx.messenger.callbackFor('Принимаю')))
    assert.deepEqual(ctx.messenger.last?.markup, {
      keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true,
    })

    await send(ctx, message(TG_USER, { contact: { phone_number: '79161234567', user_id: TG_USER.id } }))
    assert.match(ctx.messenger.last?.text ?? '', /«iPhone Кая» \(iOS\)/)
    const buttons = codeButtons(ctx)
    assert.equal(buttons.length, 3)
    assert.equal(new Set(buttons).size, 3)
    assert.ok(buttons.includes(confirmationCode))

    await send(ctx, callback(TG_USER, ctx.messenger.callbackFor(confirmationCode)))
    assert.equal(ctx.messenger.urlFor('Вернуться в MafBoard'), `https://mafboard.test/auth/return?ticket=${ticketId}`)

    assert.equal((await ctx.repo.ticketById(ticketId))?.status, 'confirmed')
    const user = await ctx.repo.userByTgId(TG_USER.id)
    assert.equal(user?.phone, '+79161234567')
    assert.equal(user?.termsVersion, '1')
  })

  it('неверный код отменяет вход (фишинг чужой ссылкой)', async () => {
    const ctx = createTestContext()
    const { ticketId, code, confirmationCode } = await startLogin(ctx)
    await reachConfirm(ctx, code)
    const wrong = codeButtons(ctx).find((c) => c !== confirmationCode)!
    await send(ctx, callback(TG_USER, ctx.messenger.callbackFor(wrong)))

    assert.match(ctx.messenger.last?.text ?? '', /Код не совпал/)
    const status = await call(ctx, 'GET', `/v1/auth/telegram/status?ticket=${ticketId}`)
    assert.deepEqual(status.json, { status: 'rejected', note: 'Код подтверждения не совпал' })
  })

  it('имя устройства очищается от ссылок и служебных символов', async () => {
    const ctx = createTestContext()
    const { code } = await startLogin(ctx, 'evil.com/login‮ — нажми 42!')
    await reachConfirm(ctx, code)
    const text = ctx.messenger.last?.text ?? ''
    assert.ok(!text.includes('evil.com'))
    assert.ok(!text.includes('‮'))
    assert.match(text, /«evilcomlogin нажми 42»/)
  })

  it('вернувшийся пользователь сразу видит сверку кода', async () => {
    const ctx = createTestContext()
    await ctx.repo.upsertUserFromTelegram({
      tgId: TG_USER.id, tgUsername: 'kai', tgFirstName: 'Кай', tgLastName: null, phone: '+79161234567', termsVersion: '1',
    })
    const { code } = await startLogin(ctx)
    await send(ctx, message(TG_USER, { text: `/start ${code}` }))
    assert.equal(ctx.messenger.sent.length, 1)
    assert.match(ctx.messenger.last?.text ?? '', /Подтвердите вход в MafBoard/)
    assert.equal(codeButtons(ctx).length, 3)
  })

  it('новая версия соглашения требует принять его заново', async () => {
    const ctx = createTestContext()
    await ctx.repo.upsertUserFromTelegram({
      tgId: TG_USER.id, tgUsername: 'kai', tgFirstName: 'Кай', tgLastName: null, phone: '+79161234567', termsVersion: '0',
    })
    const { code } = await startLogin(ctx)
    await send(ctx, message(TG_USER, { text: `/start ${code}` }))
    assert.match(ctx.messenger.last?.text ?? '', /соглашение/)
  })

  it('чужой контакт и чужой аккаунт Telegram не принимаются', async () => {
    const ctx = createTestContext()
    const { ticketId, code, confirmationCode } = await startLogin(ctx)
    await send(ctx, message(TG_USER, { text: `/start ${code}` }))
    await send(ctx, callback(TG_USER, ctx.messenger.callbackFor('Принимаю')))

    await send(ctx, message(TG_USER, { contact: { phone_number: '79990000000', user_id: 777 } }))
    assert.match(ctx.messenger.last?.text ?? '', /собственный номер/)
    assert.equal((await ctx.repo.ticketById(ticketId))?.phone, null)

    const intruder = { ...TG_USER, id: 2002, username: 'intruder' }
    await send(ctx, message(intruder, { text: `/start ${code}` }))
    assert.match(ctx.messenger.last?.text ?? '', /другом аккаунте/)
    await send(ctx, callback(intruder, `mb:code:${ticketId}:${confirmationCode}`))
    assert.equal(ctx.messenger.answers.at(-1)?.text, 'Этот вход уже недействителен')
    assert.equal((await ctx.repo.ticketById(ticketId))?.status, 'pending')
  })

  it('гонка двух аккаунтов за одну ссылку: билет достаётся первому', async () => {
    const ctx = createTestContext()
    const { ticketId, code } = await startLogin(ctx)
    const intruder = { ...TG_USER, id: 2002, username: 'intruder' }
    await Promise.all([
      send(ctx, message(TG_USER, { text: `/start ${code}` })),
      send(ctx, message(intruder, { text: `/start ${code}` })),
    ])
    assert.equal((await ctx.repo.ticketById(ticketId))?.tgId, TG_USER.id)
  })

  it('«Это не я» и отказ от соглашения отклоняют вход', async () => {
    const ctx = createTestContext()
    const first = await startLogin(ctx)
    await send(ctx, message(TG_USER, { text: `/start ${first.code}` }))
    await send(ctx, callback(TG_USER, ctx.messenger.callbackFor('Отказаться')))
    assert.equal((await ctx.repo.ticketById(first.ticketId))?.status, 'rejected')

    const second = await startLogin(ctx)
    await reachConfirm(ctx, second.code)
    await send(ctx, callback(TG_USER, ctx.messenger.callbackFor('Это не я')))
    const status = await call(ctx, 'GET', `/v1/auth/telegram/status?ticket=${second.ticketId}`)
    assert.deepEqual(status.json, { status: 'rejected', note: 'Вход отклонён в Telegram' })
  })

  it('устаревшая ссылка не открывается', async () => {
    const ctx = createTestContext()
    const { code } = await startLogin(ctx)
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 11 * 60_000)
    await send(ctx, message(TG_USER, { text: `/start ${code}` }))
    assert.match(ctx.messenger.last?.text ?? '', /устарела/)
  })
})
