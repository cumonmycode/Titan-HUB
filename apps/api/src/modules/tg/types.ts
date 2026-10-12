/** Минимальные типы апдейтов Telegram Bot API, которые обрабатывает Tai. */

export interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
}

export interface TgChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
}

export interface TgFile {
  file_id: string
  duration?: number
  file_size?: number
}

export interface TgMessage {
  message_id: number
  from?: TgUser
  chat: TgChat
  date: number
  text?: string
  caption?: string
  voice?: TgFile
  audio?: TgFile
  video_note?: TgFile
  contact?: { phone_number: string; user_id?: number }
  reply_to_message?: TgMessage
  message_thread_id?: number
  is_topic_message?: boolean
  new_chat_members?: TgUser[]
  forum_topic_created?: { name?: string }
}

export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}

export interface TgChatMemberUpdate {
  chat: TgChat
  from: TgUser
  new_chat_member?: { user?: TgUser; status?: string }
}

export interface TgUpdate {
  update_id: number
  message?: TgMessage
  edited_message?: TgMessage
  callback_query?: TgCallbackQuery
  poll_answer?: { poll_id?: string; user?: TgUser; voter_chat?: TgChat; option_ids?: number[] }
  my_chat_member?: TgChatMemberUpdate
  chat_member?: TgChatMemberUpdate
}
