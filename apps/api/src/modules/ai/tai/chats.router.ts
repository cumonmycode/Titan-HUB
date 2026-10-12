/**
 * Чаты Tai сотрудника: список (с поиском), открыть, переименовать, удалить.
 * Только свои — чужой чат отвечает «не найден». Новые реплики пишет /api/ai/assistant.
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppEnv } from '../../../types.js'
import { chatTurns, deleteChat, listChats, ownChat, renameChat } from './history.js'

export const chatsRouter = new Hono<AppEnv>()

const ID = /^[0-9a-f-]{36}$/i
const NOT_FOUND = { error: 'Чат не найден' }

chatsRouter.get('/', zValidator('query', z.object({ q: z.string().max(100).optional() })), async (c) => {
  const chats = await listChats(c.var.db, c.get('user').sub, c.req.valid('query').q)
  return c.json({ chats })
})

chatsRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json(NOT_FOUND, 404)
  const chat = await ownChat(c.var.db, c.get('user').sub, id)
  if (!chat) return c.json(NOT_FOUND, 404)
  return c.json({ chat, turns: await chatTurns(c.var.db, chat.id) })
})

chatsRouter.patch('/:id', zValidator('json', z.object({ title: z.string().min(1).max(60) })), async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json(NOT_FOUND, 404)
  const chat = await renameChat(c.var.db, c.get('user').sub, id, c.req.valid('json').title)
  return chat ? c.json({ chat }) : c.json(NOT_FOUND, 404)
})

chatsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json(NOT_FOUND, 404)
  return (await deleteChat(c.var.db, c.get('user').sub, id)) ? c.json({ ok: true }) : c.json(NOT_FOUND, 404)
})
