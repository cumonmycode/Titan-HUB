/**
 * HTML-виджеты Telegram (Bot API 10.4): мини-приложение прямо в сообщении.
 *
 * Одна карточка на все случаи: код виджета неизменен (CARD_HTML), а что показать —
 * данные сообщения (chat_data, JSON ≤ 1024 байт). Кнопка шлёт боту запрос
 * (widget_query), бот отвечает подписью для кнопки и меняет chat_data —
 * карточка перерисовывается сама. В продакшене Telegram пока разрешает виджеты
 * только в личке с ботом; где нельзя — отправляем ту же карточку текстом.
 */
import { deflateSync } from 'node:zlib'
import { escapeHtml, type TgBot } from './tgBot.js'

/** Кнопка карточки: подпись и данные запроса (1–64 байта). o — второстепенная (контурная). */
export interface CardButton { l: string; d: string; o?: 1 }
/** Строка карточки: подпись, значение (a — акцент), кнопка справа. */
export interface CardRow { l: string; v?: string; a?: 1; b?: CardButton }
export interface Card {
  /** Значок (эмодзи) в шапке. */
  i: string
  t: string
  s?: string
  /** Крупное число под шапкой. */
  n?: string
  r?: CardRow[]
  /** Кнопки внизу. */
  b?: CardButton[]
  /** Подпись внизу. */
  f?: string
}

const MAX_HTML_BYTES = 32_768
const MAX_DEFLATED_BYTES = 4096
const MAX_DATA_BYTES = 1024
const MAX_REQUEST_BYTES = 64

/* Код карточки. Только встроенные стили и скрипт, системный шрифт, без сети и форм. */
export const CARD_HTML = `<style>
body{margin:0;font:15px/1.35 system-ui,sans-serif;color:var(--tg-theme-text-color);background:transparent}
.c{padding:14px 14px calc(12px + env(safe-area-inset-bottom))}
.h{display:flex;gap:11px;align-items:center;margin-bottom:6px}
.i{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:21px;background:rgba(127,127,127,.14)}
.t{font-weight:700;font-size:17px}
.s,.v,.f{color:var(--tg-theme-hint-color);font-size:13px}
.n{font-size:30px;font-weight:800;letter-spacing:-.5px;margin:6px 0 2px}
.r{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(127,127,127,.18)}
.l{flex:1;min-width:0}
.a{color:var(--tg-theme-link-color)}
.g{display:flex;gap:8px;flex-wrap:wrap;padding-top:10px}
button{border:0;border-radius:11px;padding:8px 14px;font:600 14px system-ui,sans-serif;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color,#fff);transition:transform .12s,opacity .12s}
button:active{transform:scale(.96)}
button.o{background:transparent;color:var(--tg-theme-link-color);box-shadow:inset 0 0 0 1.5px currentColor}
button:disabled{opacity:.45}
.f{margin-top:8px;min-height:16px}
.w{animation:fi .18s ease-out}
@keyframes fi{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
</style>
<div class="c" id="w"></div>
<script>
var W=window.TelegramWidget,R=document.getElementById('w'),busy=0,msg='';
function E(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function D(){try{return JSON.parse(W&&W.chatData||'{}')}catch(e){return{}}}
function H(k){var h=W&&W.HapticFeedback;if(h){if(k)h.notificationOccurred(k);else h.selectionChanged()}}
function B(b){var e=E('button',b.o?'o':'',b.l);e.disabled=!!busy;e.addEventListener('click',function(){if(busy||!W)return;busy=1;msg='…';H();draw();W.request(b.d).then(function(r){msg=r&&r.result||'';H('success')},function(){msg='Не вышло — попробуй ещё раз';H('error')}).then(function(){busy=0;draw()})});return e}
function draw(){var d=D(),h=E('div','h'),x=E('div');R.textContent='';R.className='c w';
h.appendChild(E('div','i',d.i||'✨'));x.appendChild(E('div','t',d.t||''));if(d.s)x.appendChild(E('div','s',d.s));h.appendChild(x);R.appendChild(h);
if(d.n)R.appendChild(E('div','n',d.n));
(d.r||[]).forEach(function(r){var w=E('div','r'),l=E('div','l');l.appendChild(E('div','',r.l));if(r.v)l.appendChild(E('div','v'+(r.a?' a':''),r.v));w.appendChild(l);if(r.b)w.appendChild(B(r.b));R.appendChild(w)});
if(d.b&&d.b.length){var g=E('div','g');d.b.forEach(function(b){g.appendChild(B(b))});R.appendChild(g)}
R.appendChild(E('div','f',msg||d.f||''))}
if(W){W.onEvent('chatDataChanged',function(){msg='';draw()});W.onEvent('themeChanged',draw);W.ready()}draw();
</script>`

const bytes = (s: string) => Buffer.byteLength(s, 'utf8')

/** Укладывается ли код в лимиты Telegram (32 КБ и 4 КБ после сжатия zlib 9). */
export function widgetFits(html: string): boolean {
  return bytes(html) <= MAX_HTML_BYTES && deflateSync(Buffer.from(html, 'utf8'), { level: 9 }).length <= MAX_DEFLATED_BYTES
}

/** Данные карточки в 1024 байта: лишние строки отбрасываем с конца. */
export function cardData(card: Card): string {
  const clean = (b?: CardButton) => (b && bytes(b.d) <= MAX_REQUEST_BYTES ? b : undefined)
  let rows = (card.r ?? []).map((r) => ({ ...r, b: clean(r.b) }))
  const build = () => JSON.stringify({ ...card, r: rows, b: (card.b ?? []).map(clean).filter(Boolean) })
  let json = build()
  while (bytes(json) > MAX_DATA_BYTES && rows.length) {
    rows = rows.slice(0, -1)
    json = build()
  }
  return json
}

/** Та же карточка текстом — для групп и случаев, когда виджет не отправился. */
export function cardText(card: Card): string {
  const rows = (card.r ?? []).map((r) => `• ${escapeHtml(r.l)}${r.v ? ` — ${escapeHtml(r.v)}` : ''}`)
  return [`${card.i} <b>${escapeHtml(card.t)}</b>`, card.s ? escapeHtml(card.s) : null, card.n ? `<b>${escapeHtml(card.n)}</b>` : null, ...rows, card.f ? `<i>${escapeHtml(card.f)}</i>` : null]
    .filter(Boolean)
    .join('\n')
}

export type CardSent = { ok: true; messageId: number; widget: boolean } | { ok: false; error: string }

/**
 * Отправить карточку виджетом; подпись видна в списке чатов и в старых версиях
 * Telegram. Не вышло (группа, старый клиент API) — отправляем текстом.
 */
export async function sendCard(bot: TgBot, chatId: string | number, card: Card, opts: { caption: string; threadId?: number | null; textOnly?: boolean }): Promise<CardSent> {
  if (!opts.textOnly && widgetFits(CARD_HTML)) {
    const sent = await bot.call<{ message_id: number }>('sendWidget', {
      chat_id: chatId,
      html: CARD_HTML,
      chat_data: cardData(card),
      caption: opts.caption,
      allow_queries: true,
      ...(opts.threadId ? { message_thread_id: opts.threadId } : {}),
    })
    if (sent) return { ok: true, messageId: sent.message_id, widget: true }
  }
  const text = await bot.send(chatId, cardText(card), { html: true, threadId: opts.threadId ?? null })
  return text.ok ? { ok: true, messageId: text.messageId, widget: false } : { ok: false, error: text.error }
}

/** Ответ на нажатие кнопки: короткая подпись под карточкой. Отвечать нужно за 15 с. */
export async function answerWidget(bot: TgBot, queryId: string, text: string): Promise<void> {
  await bot.call('answerWidgetQuery', { widget_query_id: queryId, data: text.slice(0, 300) })
}

/** Новые данные карточки — она перерисуется без «изменено» и без уведомления. */
export async function updateCard(bot: TgBot, chatId: string | number, messageId: number, card: Card): Promise<void> {
  await bot.call('editMessageWidgetData', { chat_id: chatId, message_id: messageId, chat_data: cardData(card) })
}
