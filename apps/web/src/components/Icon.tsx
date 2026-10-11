import React from 'react'

interface IconProps {
  name: string
  size?: number
  color?: string
  style?: React.CSSProperties
  className?: string
}

/* ─── SVG ICON LIBRARY ─────────────────────────────────────────
   All icons: 24×24 viewBox, stroke-based, strokeWidth 1.75
   Uses CSS `color` prop via currentColor for both stroke & fills
──────────────────────────────────────────────────────────────── */
const ICONS: Record<string, React.ReactNode> = {

  /* ── Navigation ─────────────────────────────────────────── */
  add: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  close: (
    <path d="M18 6L6 18M6 6l12 12" />
  ),
  remove: (
    <line x1="5" y1="12" x2="19" y2="12" />
  ),
  arrow_back: (
    <path d="M19 12H5M12 19l-7-7 7-7" />
  ),
  arrow_forward: (
    <path d="M5 12h14M12 5l7 7-7 7" />
  ),
  arrow_downward: (
    <path d="M12 5v14M19 12l-7 7-7-7" />
  ),
  chevron_left: (
    <polyline points="15 18 9 12 15 6" />
  ),
  chevron_right: (
    <polyline points="9 18 15 12 9 6" />
  ),
  expand_more: (
    <polyline points="6 9 12 15 18 9" />
  ),
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),

  /* ── Actions ────────────────────────────────────────────── */
  edit: (
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  ),
  delete: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </>
  ),
  search_off: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M19 19l-3.5-3.5" />
      <line x1="8" y1="8" x2="13" y2="13" />
      <line x1="13" y1="8" x2="8" y2="13" />
    </>
  ),
  refresh: (
    <>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </>
  ),
  undo: (
    <>
      <polyline points="3 7 3 13 9 13" />
      <path d="M3 13a9 9 0 109 9" />
    </>
  ),
  timer: (
    /* Секундомер: засечка сверху + циферблат со стрелкой — живой счётчик аренды */
    <>
      <line x1="10" y1="2" x2="14" y2="2" />
      <circle cx="12" cy="14" r="8" />
      <line x1="12" y1="14" x2="12" y2="10" />
    </>
  ),
  sell: (
    /* Ценник со скидкой — для кнопки/строк скидки */
    <>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>
  ),
  money_return: (
    /* Возврат средств: банкнота с монетой + изогнутая стрелка назад сверху —
       однозначно «деньги возвращаются клиенту», в отличие от общей петли undo. */
    <>
      <polyline points="3 4 3 8 7 8" />
      <path d="M3 8a8 8 0 0 1 14.5-2.5" strokeLinecap="round" />
      <rect x="2" y="11" width="20" height="9" rx="2" />
      <circle cx="12" cy="15.5" r="2" />
    </>
  ),
  play_arrow: (
    <polygon points="7 4 20 12 7 20 7 4" fill="currentColor" />
  ),
  play_circle: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </>
  ),
  call: (
    /* Телефонная трубка — «Позвонить» */
    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
  ),
  whatsapp: (
    /* Пузырь чата с трубкой — WhatsApp */
    <>
      <path d="M3 21l1.65-4.5A8.5 8.5 0 1112 20.5a8.4 8.4 0 01-4.5-1.3L3 21z" />
      <path d="M9 9.2c.3-.8.6-.8.9-.8h.5c.2 0 .4 0 .55.4.2.5.6 1.6.65 1.7.05.1.08.25 0 .4-.3.55-.6.7-.4 1 .5.85 1.2 1.4 2 1.8.2.1.35.08.5-.05.15-.15.6-.7.75-.95.15-.2.3-.17.5-.1.2.08 1.3.62 1.5.73.2.1.35.15.4.25.05.1.05.55-.15 1.05-.2.5-1.15.95-1.6.98-.45.03-.5.35-2.8-.85-1.95-1.05-3.1-3.1-3.2-3.25-.1-.15-.75-1-.75-1.9 0-.9.48-1.35.65-1.53z" strokeWidth="0.5" fill="currentColor" />
    </>
  ),
  telegram: (
    /* Бумажный самолётик — Telegram */
    <path d="M21.5 4.3L2.8 11.4c-.9.35-.88 1.65.02 1.97l4.6 1.6 1.75 5.3c.25.75 1.2.95 1.7.34l2.5-3.05 4.7 3.45c.6.45 1.45.12 1.6-.6l3.1-14.5c.18-.85-.65-1.55-1.45-1.2z" />
  ),
  home: (
    <>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 001 1h12a1 1 0 001-1V9.5" />
      <path d="M9 21v-6h6v6" />
    </>
  ),
  directions_car: (
    <>
      <path d="M5 11l1.5-4.5A2 2 0 018.4 5h7.2a2 2 0 011.9 1.5L19 11" />
      <path d="M3 11h18v6a1 1 0 01-1 1h-1a1 1 0 01-1-1v-1H6v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z" />
      <circle cx="7.5" cy="14.5" r="1" />
      <circle cx="16.5" cy="14.5" r="1" />
    </>
  ),
  print: (
    <>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </>
  ),
  send: (
    <>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  open_in_new: (
    <>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </>
  ),

  /* ── Status / Feedback ──────────────────────────────────── */
  check_circle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <circle cx="12" cy="16" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  warning: (
    <>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <circle cx="12" cy="17" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <circle cx="12" cy="8.5" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  cancel: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </>
  ),
  progress_activity: (
    <path d="M12 3a9 9 0 100 18" strokeLinecap="round" />
  ),
  radio_button_unchecked: (
    <circle cx="12" cy="12" r="9" />
  ),
  checklist: (
    <>
      <path d="M3 17l2 2 4-4" />
      <path d="M3 7l2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </>
  ),
  how_to_vote: (
    <>
      <path d="M9 12l2 2 4-4" />
      <path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5V7z" />
      <path d="M22 19H2" />
    </>
  ),
  smartphone: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </>
  ),
  done_all: (
    <>
      <polyline points="2 12 6 16 14 8" />
      <polyline points="9 12 13 16 21 8" />
    </>
  ),
  check: (
    <polyline points="20 6 9 17 4 12" />
  ),
  block: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </>
  ),

  /* ── UI Controls ────────────────────────────────────────── */
  drag_indicator: (
    <>
      <circle cx="9" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="8" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="9" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  star: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  tune: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="10" cy="6" r="2.5" />
      <circle cx="16" cy="12" r="2.5" />
      <circle cx="8" cy="18" r="2.5" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
      <circle cx="12" cy="17" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  add_circle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  remove_circle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  lock: (
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </>
  ),
  notifications_off: (
    <>
      <path d="M13.73 21a2 2 0 01-3.46 0" />
      <path d="M18.63 13A17.89 17.89 0 0118 8" />
      <path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 00-9.33-5" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </>
  ),
  done_all_off: (
    <path d="M3 15l4 4 3-3M8 9l4 4M12 5l7-5" />
  ),
  update: (
    <>
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0115-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 01-15 6.7L3 16" />
    </>
  ),

  /* ── Business / POS ─────────────────────────────────────── */
  point_of_sale: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="1.5" />
      <path d="M3 11h18" />
      <rect x="5" y="13" width="14" height="8" rx="1" />
      <line x1="8" y1="17" x2="16" y2="17" />
      <circle cx="8.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  receipt: (
    <>
      <path d="M4 2h16v20l-3-2-2 2-2-2-2 2-2-2-3 2V2z" />
      <line x1="8" y1="8" x2="16" y2="8" />
      <line x1="8" y1="12" x2="16" y2="12" />
      <line x1="8" y1="16" x2="13" y2="16" />
    </>
  ),
  receipt_long: (
    <>
      <path d="M4 2h16v20l-3-2-2 2-2-2-2 2-2-2-3 2V2z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="10.5" x2="16" y2="10.5" />
      <line x1="8" y1="14" x2="16" y2="14" />
      <line x1="8" y1="17.5" x2="13" y2="17.5" />
    </>
  ),
  payments: (
    <>
      <rect x="1" y="5" width="22" height="14" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
      <circle cx="6.5" cy="15.5" r="2" fill="currentColor" fillOpacity="0.3" stroke="currentColor" />
      <circle cx="9.5" cy="15.5" r="2" fill="currentColor" fillOpacity="0.3" stroke="currentColor" />
    </>
  ),
  account_balance: (
    <>
      <path d="M3 21h18" />
      <path d="M3 10h18" />
      <path d="M5 10l7-7 7 7" />
      <line x1="6" y1="10" x2="6" y2="21" />
      <line x1="10" y1="10" x2="10" y2="21" />
      <line x1="14" y1="10" x2="14" y2="21" />
      <line x1="18" y1="10" x2="18" y2="21" />
    </>
  ),
  discount: (
    <>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <line x1="8" y1="14" x2="14" y2="8" />
      <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="8" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  confirmation_number: (
    <>
      <path d="M2 9a2 2 0 012-2h16a2 2 0 012 2v3a2 2 0 010 4v3a2 2 0 01-2 2H4a2 2 0 01-2-2v-3a2 2 0 010-4V9z" />
      <line x1="9" y1="7" x2="9" y2="17" strokeDasharray="2 2" />
    </>
  ),
  calculate: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <rect x="7" y="6" width="10" height="4" rx="1" />
      <circle cx="8.5" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  bar_chart: (
    <>
      <rect x="4" y="11" width="4" height="10" rx="1" fill="currentColor" fillOpacity="0.2" stroke="currentColor" />
      <rect x="10" y="6" width="4" height="15" rx="1" fill="currentColor" fillOpacity="0.2" stroke="currentColor" />
      <rect x="16" y="2" width="4" height="19" rx="1" fill="currentColor" fillOpacity="0.2" stroke="currentColor" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 20l5-6 4 4 5-8 4 5" strokeLinejoin="round" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </>
  ),
  salary: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h4a2 2 0 010 4H9v4" />
      <line x1="9" y1="9" x2="9" y2="17" />
      <line x1="9" y1="13" x2="13" y2="13" />
    </>
  ),

  /* ── People ─────────────────────────────────────────────── */
  person: (
    <>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  person_add: (
    <>
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </>
  ),
  person_off: (
    <>
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="9" x2="23" y2="15" />
      <line x1="23" y1="9" x2="17" y2="15" />
    </>
  ),
  group: (
    <>
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </>
  ),
  groups: (
    <>
      <circle cx="9" cy="7.5" r="3.5" />
      <circle cx="17" cy="7.5" r="2.5" />
      <path d="M2 21v-1a7 7 0 0114 0v1" />
      <path d="M16 12a5 5 0 018 0v1" />
    </>
  ),
  fingerprint: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10a4 4 0 014 4c0 2-1.5 4-1.5 6" />
      <path d="M12 10a4 4 0 00-4 4c0 2 1.5 4 1.5 6" />
      <path d="M12 6a8 8 0 018 8c0 3-2 5-2 8" />
      <path d="M12 6a8 8 0 00-8 8c0 3 2 5 2 8" />
    </>
  ),
  pin: (
    <>
      <circle cx="8" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="17" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="17" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="21.5" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  dialpad: (
    <>
      <circle cx="8" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="21" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  support_agent: (
    <>
      <path d="M12 3a9 9 0 00-9 9" />
      <path d="M12 3a9 9 0 019 9" />
      <rect x="2" y="12" width="3" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" stroke="currentColor" />
      <rect x="19" y="12" width="3" height="5" rx="1.5" fill="currentColor" fillOpacity="0.2" stroke="currentColor" />
      <path d="M22 17v1a2 2 0 01-2 2h-2" />
      <path d="M18 20h-2a2 2 0 000 4h2" />
    </>
  ),
  psychology: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="M10 14v3h4v-3" />
      <line x1="10" y1="17" x2="14" y2="17" />
      <path d="M9.5 7c.5-1 1.5-1.5 2.5-1.5s2 .5 2.5 1.5" />
      <line x1="12" y1="7" x2="12" y2="10" />
    </>
  ),
  // TITAN AI — фирменная «AI-искра»: крупная заливная звезда-сверкание + малая.
  // Заливка currentColor (svg задаёт style.color = color prop), поэтому цвет управляется извне.
  titan_ai: (
    <>
      <path d="M10.8 3c.52 4.65 3.13 7.26 7.78 7.78-4.65.52-7.26 3.13-7.78 7.78-.52-4.65-3.13-7.26-7.78-7.78C7.67 10.26 10.28 7.65 10.8 3Z" fill="currentColor" stroke="none" />
      <path d="M18.7 3.3c.16 1.46 1 2.3 2.46 2.46-1.46.16-2.3 1-2.46 2.46-.16-1.46-1-2.3-2.46-2.46 1.46-.16 2.3-1 2.46-2.46Z" fill="currentColor" stroke="none" />
    </>
  ),

  /* ── Venue / Space ──────────────────────────────────────── */
  meeting_room: (
    <>
      <path d="M3 22h18" />
      <rect x="7" y="2" width="10" height="20" rx="1.5" />
      <circle cx="14.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  table_bar: (
    <>
      <rect x="3" y="5" width="18" height="5" rx="1.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
      <line x1="8.5" y1="10" x2="7" y2="21" />
      <line x1="15.5" y1="10" x2="17" y2="21" />
    </>
  ),
  tv: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </>
  ),
  slideshow: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M2 7v10M22 7v10" />
      <path d="M10.5 9.5l4 2.5-4 2.5z" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9.5" r="1.75" />
      <path d="M21 16l-5.5-5.5L5 20" />
    </>
  ),
  rotate_right: (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4h-4" />
    </>
  ),
  link_off: (
    <>
      <path d="M9 17H7a5 5 0 0 1-1.6-9.74M15 7h2a5 5 0 0 1 3.5 8.57" />
      <line x1="8" y1="12" x2="10" y2="12" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </>
  ),
  tv_off: (
    <>
      <path d="M8 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-1.2 1.83M16 17H4a2 2 0 0 1-2-2V6a2 2 0 0 1 1.38-1.9" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </>
  ),
  tablet_mac: (
    <>
      <rect x="4" y="1" width="16" height="22" rx="2.5" />
      <circle cx="12" cy="20.5" r="1" fill="currentColor" stroke="none" />
      <line x1="8" y1="5" x2="16" y2="5" />
    </>
  ),
  event: (
    <>
      <rect x="3" y="5" width="18" height="17" rx="2" />
      <path d="M16 2v6M8 2v6" />
      <line x1="3" y1="11" x2="21" y2="11" />
      <circle cx="9" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="16" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 3" />
    </>
  ),
  stop_circle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" fillOpacity="0.3" stroke="currentColor" />
    </>
  ),

  /* ── Inventory / Products ───────────────────────────────── */
  restaurant_menu: (
    <>
      <path d="M4 2h12l4 4v16H4V2z" />
      <path d="M14 2v4h4" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="11" y2="17" />
    </>
  ),
  category: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" />
    </>
  ),
  inventory_2: (
    <>
      <path d="M21 8V21H3V8" />
      <path d="M23 3H1v5h22V3z" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </>
  ),

  /* ── Shopping ───────────────────────────────────────────── */
  shopping_cart: (
    <>
      <circle cx="9" cy="21" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20" cy="21" r="1.5" fill="currentColor" stroke="none" />
      <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 001.96-1.58L23 6H6" />
    </>
  ),
  add_shopping_cart: (
    <>
      <circle cx="9" cy="21" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="20" cy="21" r="1.5" fill="currentColor" stroke="none" />
      <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h7.72" />
      <line x1="16" y1="6" x2="22" y2="6" strokeWidth="2.5" />
      <line x1="19" y1="3" x2="19" y2="9" strokeWidth="2.5" />
    </>
  ),
  card_giftcard: (
    <>
      <rect x="1" y="5" width="22" height="14" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
      <path d="M12 5v14" />
      <path d="M9.5 5A2.5 2.5 0 0112 7.5 2.5 2.5 0 0114.5 5" />
    </>
  ),
  add_card: (
    <>
      <rect x="1" y="5" width="22" height="14" rx="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
      <line x1="16" y1="15" x2="20" y2="15" />
      <line x1="18" y1="13" x2="18" y2="17" />
    </>
  ),

  /* ── Documents / Info ───────────────────────────────────── */
  description: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="11" y2="17" />
    </>
  ),
  fact_check: (
    <>
      <path d="M9 5H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2h-4" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 12l2 2 4-4" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </>
  ),
  gavel: (
    <>
      <path d="M14 2L2 14l3 3L17 5l-3-3z" />
      <path d="M19 19L9 9" />
      <line x1="14" y1="20" x2="22" y2="20" />
    </>
  ),
  privacy_tip: (
    <>
      <path d="M12 2L3 7v6c0 5.25 3.75 10.15 9 11.25C17.25 23.15 21 18.25 21 13V7L12 2z" />
      <line x1="12" y1="11" x2="12" y2="15" />
      <circle cx="12" cy="8.5" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  commit: (
    <>
      <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.3" stroke="currentColor" />
      <line x1="2" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="22" y2="12" />
    </>
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </>
  ),

  /* ── Payment methods ────────────────────────────────────── */
  credit_card: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <line x1="2" y1="9.5" x2="22" y2="9.5" />
      <line x1="5.5" y1="14.5" x2="10" y2="14.5" />
      <line x1="15.5" y1="14.5" x2="18.5" y2="14.5" />
    </>
  ),
  qr_code_2: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="5.5" y="5.5" width="2" height="2" rx="0.3" fill="currentColor" stroke="none" />
      <rect x="16.5" y="5.5" width="2" height="2" rx="0.3" fill="currentColor" stroke="none" />
      <rect x="5.5" y="16.5" width="2" height="2" rx="0.3" fill="currentColor" stroke="none" />
      <rect x="14" y="14" width="2.5" height="2.5" rx="0.3" fill="currentColor" stroke="none" />
      <rect x="18.5" y="14" width="2.5" height="2.5" rx="0.3" fill="currentColor" stroke="none" />
      <rect x="14" y="18.5" width="2.5" height="2.5" rx="0.3" fill="currentColor" stroke="none" />
      <rect x="18.5" y="18.5" width="2.5" height="2.5" rx="0.3" fill="currentColor" stroke="none" />
    </>
  ),
  stars: (
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  ),
  account_balance_wallet: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2.5" />
      <path d="M21 11h-4a2 2 0 000 4h4" />
      <circle cx="17.2" cy="13" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  person_pin: (
    <>
      <path d="M12 22s7-5.5 7-12a7 7 0 10-14 0c0 6.5 7 12 7 12z" />
      <circle cx="12" cy="9" r="2.3" />
      <path d="M15.2 16.2v-.4a3.2 3.2 0 00-6.4 0v.4" />
    </>
  ),
  card_membership: (
    <>
      <rect x="3" y="4" width="18" height="11" rx="2" />
      <line x1="3" y1="8.5" x2="21" y2="8.5" />
      <circle cx="12" cy="18" r="3" />
      <path d="M10.4 20.4L9.3 23l2.7-1.4L14.7 23l-1.1-2.6" />
    </>
  ),
  call_split: (
    <>
      <path d="M12 21v-7" />
      <path d="M12 14L7.5 9.5" />
      <polyline points="7.5 13 7.5 9.5 11 9.5" />
      <path d="M12 14l4.5-4.5" />
      <polyline points="13 9.5 16.5 9.5 16.5 13" />
    </>
  ),
  refund: (
    <>
      {/* Банкнота + стрелка возврата сверху = «деньги возвращаются» */}
      <rect x="2.5" y="10" width="19" height="10" rx="2.5" />
      <circle cx="12" cy="15" r="2.3" />
      <path d="M6.5 7.2A6.5 6.5 0 0 1 18 7.8" strokeLinecap="round" />
      <polyline points="5.6 4 6.4 7.6 9.8 6.4" />
    </>
  ),

  /* ── Misc (dashboard / manage / reports) ────────────────── */
  dashboard: (
    <>
      <rect x="3" y="3" width="8" height="9" rx="1.5" />
      <rect x="13" y="3" width="8" height="5" rx="1.5" />
      <rect x="13" y="10" width="8" height="11" rx="1.5" />
      <rect x="3" y="14" width="8" height="7" rx="1.5" />
    </>
  ),
  percent: (
    <>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="7.5" cy="7.5" r="2.3" />
      <circle cx="16.5" cy="16.5" r="2.3" />
    </>
  ),
  money_off: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <line x1="3" y1="3.5" x2="21" y2="20.5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20v-1a6.5 6.5 0 0113 0v1" />
      <path d="M16 5a3.2 3.2 0 010 6" />
      <path d="M17.5 20v-1a6.5 6.5 0 00-2.3-5" />
    </>
  ),
  badge: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <path d="M9.5 5V4a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 4v1" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16.5a3 3 0 016 0" />
      <line x1="14.5" y1="10.5" x2="18" y2="10.5" />
      <line x1="14.5" y1="14" x2="18" y2="14" />
    </>
  ),
  store: (
    <>
      <path d="M3 9l1.6-4.4A1 1 0 015.5 4h13a1 1 0 01.9.6L21 9" />
      <path d="M3 9h18v1.5a2.6 2.6 0 01-5.1 0 2.6 2.6 0 01-5.9 0 2.6 2.6 0 01-5.9 0A2.6 2.6 0 013 10.5V9z" />
      <path d="M4.5 13v7a1 1 0 001 1h13a1 1 0 001-1v-7" />
      <rect x="9.5" y="15" width="5" height="6" rx="0.5" />
    </>
  ),
  summarize: (
    <>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="9.5" x2="11" y2="9.5" />
      <line x1="8" y1="13.5" x2="16" y2="13.5" />
      <line x1="8" y1="17.5" x2="13" y2="17.5" />
    </>
  ),
  local_shipping: (
    <>
      <rect x="1.5" y="6.5" width="12" height="9" rx="1.5" />
      <path d="M13.5 9.5h4l3 3v3h-7z" />
      <circle cx="6" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </>
  ),
  bedtime: (
    <path d="M20.5 13.2A8 8 0 1 1 10.8 3.5a6.3 6.3 0 0 0 9.7 9.7z" />
  ),
  auto_awesome: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
      <path d="M18.5 14l.75 2 2 .75-2 .75-.75 2-.75-2-2-.75 2-.75z" fill="currentColor" stroke="none" />
    </>
  ),
  loyalty: (
    <>
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L2 12V2h10l8.6 8.6a2 2 0 010 2.8z" />
      <circle cx="6.5" cy="6.5" r="1.3" fill="currentColor" stroke="none" />
      <path d="M10.6 9.6a1.4 1.4 0 012.4 1c0 1-1.2 1.8-2.4 2.6-1.2-.8-2.4-1.6-2.4-2.6a1.4 1.4 0 012.4-1z" />
    </>
  ),
  savings: (
    <>
      <ellipse cx="11.5" cy="13" rx="7.5" ry="5.5" />
      <line x1="9.5" y1="8.2" x2="13.5" y2="8.2" />
      <circle cx="15.5" cy="11.8" r="0.8" fill="currentColor" stroke="none" />
      <path d="M19 11.8a2 2 0 010 2.4" />
      <path d="M7 18.2l-.6 1.8M16 18.2l.6 1.8" />
    </>
  ),
  food: (
    <>
      <path d="M4.5 10a7.5 7.5 0 0115 0" />
      <line x1="3.6" y1="13.5" x2="20.4" y2="13.5" />
      <path d="M5 16.5h14a3 3 0 01-3 3H8a3 3 0 01-3-3z" />
    </>
  ),

  /* ── Toggles / states ───────────────────────────────────── */
  toggle_on: (
    <>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <circle cx="17" cy="12" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  toggle_off: (
    <>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <circle cx="7" cy="12" r="3" />
    </>
  ),
  radio_button_checked: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  visibility: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  visibility_off: (
    <>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </>
  ),
  map: (
    <>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </>
  ),
  local_taxi: (
    <>
      <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
      <path d="M3 11h18a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
      <line x1="9" y1="5" x2="15" y2="5" />
      <circle cx="6.5" cy="17.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="17.5" r="1.5" fill="currentColor" stroke="none" />
    </>
  ),

  /* ── Arrows / trends ────────────────────────────────────── */
  arrow_circle_up: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8.5 11 12 7.5 15.5 11" />
      <line x1="12" y1="7.5" x2="12" y2="16.5" />
    </>
  ),
  arrow_circle_down: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="8.5 13 12 16.5 15.5 13" />
      <line x1="12" y1="7.5" x2="12" y2="16.5" />
    </>
  ),
  trending_up: (
    <>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </>
  ),
  trending_down: (
    <>
      <polyline points="3 7 9 13 13 9 21 17" />
      <polyline points="15 17 21 17 21 11" />
    </>
  ),
  repeat: (
    <>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </>
  ),

  /* ── Misc ───────────────────────────────────────────────── */
  content_copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  label: (
    <path d="M3 5h11.6a2 2 0 0 1 1.6.8l3.4 4.5a1 1 0 0 1 0 1.4l-3.4 4.5a2 2 0 0 1-1.6.8H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  ),
  location_on: (
    <>
      <path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  hourglass_top: (
    <>
      <line x1="6" y1="3" x2="18" y2="3" />
      <line x1="6" y1="21" x2="18" y2="21" />
      <path d="M7 3v3l5 6 5-6V3" fill="currentColor" fillOpacity="0.25" />
      <path d="M7 21v-3l5-6 5 6v3" />
    </>
  ),
  system_update_alt: (
    <>
      <line x1="12" y1="3" x2="12" y2="13" />
      <polyline points="8 9 12 13 16 9" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  inventory: (
    <>
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <line x1="8" y1="10" x2="16" y2="10" />
      <line x1="8" y1="14" x2="13" y2="14" />
    </>
  ),

  /* ── Added: ранее рендерились квадратиком ─────────────────── */
  chat: (
    <>
      <path d="M20 4H4a2 2 0 0 0-2 2v15l4-4h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <line x1="7" y1="9.5" x2="17" y2="9.5" />
      <line x1="7" y1="13" x2="13" y2="13" />
    </>
  ),
  forum: (
    <>
      <path d="M8 13H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v2" />
      <path d="M9 8h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2v3l-4-3H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    </>
  ),
  folder_open: (
    <>
      <path d="M4 19V6a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v2" />
      <path d="M2.6 11h18a1 1 0 0 1 .95 1.32l-1.7 6A1.5 1.5 0 0 1 18.4 19H4a1.4 1.4 0 0 1-1.4-1.4V11z" />
    </>
  ),
  grid_view: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  room_service: (
    <>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <line x1="3" y1="16" x2="21" y2="16" />
      <line x1="4.5" y1="19" x2="19.5" y2="19" />
      <line x1="12" y1="8.5" x2="12" y2="6" />
      <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  notifications_active: (
    <>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
      <path d="M2.5 6a7 7 0 0 1 2-3" />
      <path d="M21.5 6a7 7 0 0 0-2-3" />
    </>
  ),
  remove_shopping_cart: (
    <>
      <path d="M3 3h2l2.4 12.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8l1.1-5.7" />
      <line x1="13.5" y1="6.5" x2="21" y2="6.5" />
      <circle cx="9.5" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="20" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  backspace: (
    <>
      <path d="M21 5H8.5a2 2 0 0 0-1.6.8L3 12l3.9 6.2a2 2 0 0 0 1.6.8H21a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
      <line x1="17" y1="9.5" x2="12.5" y2="14.5" />
      <line x1="12.5" y1="9.5" x2="17" y2="14.5" />
    </>
  ),
  today: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="8" y1="3" x2="8" y2="6.5" />
      <line x1="16" y1="3" x2="16" y2="6.5" />
      <rect x="7" y="12.5" width="4.5" height="3.5" rx="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  celebration: (
    <>
      <path d="M2.5 21.5l6.5-15 8.5 8.5-15 6.5z" />
      <line x1="9" y1="6.5" x2="17.5" y2="15" strokeOpacity="0.4" />
      <path d="M15 3.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" />
      <line x1="19.5" y1="9" x2="21.5" y2="9" />
      <line x1="18" y1="3" x2="18" y2="5" />
    </>
  ),
  workspace_premium: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5" />
      <path d="M12 6l1 2 2.1.3-1.5 1.5.4 2.1L12 11l-2 1 .4-2.1-1.5-1.5L11 8z" />
    </>
  ),
  campaign: (
    <>
      <path d="M3 10v4h3l6 4V6L6 10H3z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
      <path d="M19 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  bolt: (
    <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
  ),
  build: (
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a1.5 1.5 0 0 0 0 2.1l.9.9a1.5 1.5 0 0 0 2.1 0l6-6a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.1-.5-.5-2.1 2.7-2.5z" />
  ),
  sports_esports: (
    <>
      <path d="M6.5 8h11a3 3 0 0 1 2.95 2.46l1 5.5A2.4 2.4 0 0 1 16.8 17l-1.3-2h-7l-1.3 2a2.4 2.4 0 0 1-4.65-1.04l1-5.5A3 3 0 0 1 6.5 8z" />
      <line x1="7" y1="11.5" x2="10" y2="11.5" />
      <line x1="8.5" y1="10" x2="8.5" y2="13" />
      <circle cx="15" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="13" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  vrpano: (
    <>
      <path d="M3 7c6-1.6 12-1.6 18 0v10c-6-1.6-12-1.6-18 0V7z" />
      <path d="M7 14l2.5-2.5 2.5 2 3.5-3.5" />
    </>
  ),
  door_front: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <line x1="4" y1="21" x2="20" y2="21" />
      <circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  warehouse: (
    <>
      <path d="M3 21V8.5l9-4.5 9 4.5V21" />
      <line x1="2" y1="21" x2="22" y2="21" />
      <rect x="8" y="13" width="8" height="8" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </>
  ),

  /* ── Резервное копирование ──────────────────────────────── */
  cloud: (
    <path d="M7 18h9.5a3.4 3.4 0 0 0 .4-6.78 5 5 0 0 0-9.62-1.4A3.9 3.9 0 0 0 7 18z" />
  ),
  backup: (
    // Щит с галочкой — «данные под защитой».
    <>
      <path d="M12 3l7 3v5c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6l7-3z" />
      <path d="M9 11.8l2.2 2.2 3.6-3.8" />
    </>
  ),
  cloud_done: (
    <>
      <path d="M7 18h9.5a3.4 3.4 0 0 0 .4-6.78 5 5 0 0 0-9.62-1.4A3.9 3.9 0 0 0 7 18z" />
      <path d="M9.6 13.4l1.7 1.7 3.3-3.5" />
    </>
  ),
  cloud_off: (
    <>
      <path d="M7 18h9.5a3.4 3.4 0 0 0 .4-6.78 5 5 0 0 0-9.62-1.4A3.9 3.9 0 0 0 7 18z" />
      <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
    </>
  ),
  cloud_upload: (
    <>
      <path d="M7 18h9.5a3.4 3.4 0 0 0 .4-6.78 5 5 0 0 0-9.62-1.4A3.9 3.9 0 0 0 7 18z" />
      <path d="M12 16.5v-5M9.8 13l2.2-2.2 2.2 2.2" />
    </>
  ),
  storage: (
    // База данных — цилиндр (локальное хранилище).
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
      <path d="M5 6v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" />
      <path d="M5 12v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-6" />
    </>
  ),
  restore: (
    // Восстановление: стрелка истории против часовой + стрелки часов.
    <>
      <path d="M3.5 9A9 9 0 1 1 3 12" />
      <path d="M3.2 4.5V9H7.7" />
      <path d="M12 8v4.2l3 1.8" />
    </>
  ),
  archive: (
    // Архив: коробка с крышкой и прорезью-ручкой.
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </>
  ),
  delete_forever: (
    // Удалить навсегда: корзина с крестиком.
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M9 6V4h6v2" />
      <path d="M10 11l4 6M14 11l-4 6" />
    </>
  ),
  school: (
    // Студенты: академическая шапочка (выпускник).
    <>
      <path d="M3 9l9-4 9 4-9 4-9-4z" />
      <path d="M7 11v4c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5v-4" />
      <path d="M21 9v4" />
    </>
  ),
  history: (
    // История: циферблат со стрелкой возврата против часовой.
    <>
      <path d="M3.05 11a9 9 0 1 1 .5 4" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  sort_by_alpha: (
    // Сортировка А→Я: буквы слева, стрелка вниз справа.
    <>
      <path d="M5 5l2.5 6M5 5l-2.5 6M3.3 9h3.4" />
      <path d="M4 15h4l-4 5h4" />
      <path d="M17 4v14M17 18l-3-3M17 18l3-3" />
    </>
  ),
  upload_file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5" />
      <path d="M12 18.5v-5M9.8 15l2.2-2.2 2.2 2.2" />
    </>
  ),

  /* ── Added: миникап / новички / категории расходов ──────────── */
  emoji_events: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3" />
      <path d="M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M9 21h6M12 14v7" />
    </>
  ),
  fiber_new: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M6.5 15v-6l3 6v-6" />
      <path d="M12 15V9h2.6M12 12h2.2M12 15h2.6" />
      <path d="M16.8 9l1.1 6 1.1-6" />
    </>
  ),
  cleaning_services: (
    <>
      <path d="M9 8h6v12a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V8z" />
      <path d="M9 8V5h6V3" />
      <path d="M9 12h6" />
    </>
  ),
  smoking_rooms: (
    <>
      <rect x="3" y="14" width="13" height="3.5" rx="1" />
      <path d="M12.5 14v3.5" />
      <path d="M18.5 5.5c0 2-1.6 2-1.6 3.8M21.5 7.5c0 1.6-1.4 1.6-1.4 3" />
    </>
  ),
}

export function Icon({ name, size = 24, color, style, className }: IconProps) {
  const paths = ICONS[name]
  if (!paths) {
    // Unknown icon: render a placeholder square
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color || 'currentColor'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: color || 'currentColor', flexShrink: 0, ...style }}
        className={className}
        aria-hidden="true"
      >
        <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2" />
      </svg>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: color || 'currentColor', flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    >
      {paths}
    </svg>
  )
}
