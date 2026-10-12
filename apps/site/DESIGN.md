---
name: TITAN KBR — сайт клуба
description: Четыре переключаемых мира одного сайта клуба мафии; общий контент и формы, своя главная и свой материал у каждой темы.
colors:
  case-wall: "#2E1766"
  case-paper: "#EEE7DA"
  case-ink: "#1C1428"
  case-thread: "#E5322D"
  case-folder: "#D9BF84"
  protocol-desk: "#221A44"
  protocol-paper: "#F4F4F0"
  protocol-ink: "#111111"
  protocol-pen: "#1F3FD1"
  protocol-red: "#C8232A"
  night-sky: "#05040A"
  night-cobalt: "#1E2C8F"
  night-rose: "#E8728F"
  night-day: "#F6F3EE"
  classic-bg: "#0B0B10"
  classic-surface: "#15151D"
  classic-violet: "#7C4DFF"
typography:
  case-display:
    fontFamily: "Dela Gothic One, system-ui, sans-serif"
    fontSize: "clamp(38px, 4.5vw, 68px)"
    fontWeight: 400
    lineHeight: 0.98
  case-body:
    fontFamily: "PT Mono, ui-monospace, monospace"
    fontSize: "16px"
    lineHeight: 1.55
  case-label:
    fontFamily: "Fira Sans Extra Condensed, system-ui, sans-serif"
    fontWeight: 700
    letterSpacing: "0.06em"
  protocol-display:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontWeight: 900
    letterSpacing: "-0.035em"
  protocol-hand:
    fontFamily: "Caveat Variable, cursive"
    fontWeight: 700
  protocol-data:
    fontFamily: "JetBrains Mono Variable, ui-monospace, monospace"
    fontSize: "12px"
    letterSpacing: "0.05em"
  night-display:
    fontFamily: "Unbounded Variable, system-ui, sans-serif"
    fontSize: "clamp(52px, 10.5vw, 176px)"
    fontWeight: 300
    letterSpacing: "-0.05em"
  night-body:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "17px"
  classic-display:
    fontFamily: "Manrope Variable, system-ui, sans-serif"
    fontWeight: 800
    letterSpacing: "-0.03em"
rounded:
  case: "4px"
  protocol: "0px"
  night: "22px"
  classic: "20px"
components:
  case-button-primary:
    backgroundColor: "{colors.case-thread}"
    textColor: "#FFF6F0"
    rounded: "{rounded.case}"
    padding: "0 28px"
  protocol-button-primary:
    backgroundColor: "{colors.protocol-ink}"
    textColor: "#FFFFFF"
    rounded: "{rounded.protocol}"
  night-button-primary:
    backgroundColor: "{colors.night-day}"
    textColor: "#0B0A14"
    rounded: "999px"
  classic-button-primary:
    backgroundColor: "{colors.classic-violet}"
    textColor: "#FFFFFF"
    rounded: "14px"
---

# Design System: TITAN KBR — сайт клуба

## Overview

**Creative North Star: "Четыре стола одного клуба"**

Сайт продаёт вечер мафии через ритуалы самой игры. Одна база контента (форматы, расписание и цены из HUB, публикации, отзывы, формы заявок) показывается в одном из четырёх миров. Владелец переключает мир в HUB (`app_settings.site_theme`). Миры не смешиваются: на странице всегда один мир целиком.

- **case — «Дело о мафии»**: фиолетовая крашеная стена штаба, бумажные карточки и полароиды на булавках, красная нить, печати.
- **protocol — «Протокол судьи»**: белый судейский бланк на тёмном столе, чёрная сетка и значения, вписанные синей ручкой.
- **night — «Город засыпает»**: циклорама ночь → кобальт → рассвет → день, которая светлеет с прокруткой.
- **classic — «Классика»**: фото во весь экран, тёмный фон, фиолетовый акцент, мягкие карточки.

**Key Characteristics:**
- Общая разметка блоков, оформление задаёт тема через `.site[data-theme]`.
- Цены, расписание, залы и рейтинг GoMafia — живые данные HUB, не вёрстка.
- Каждая кнопка ведёт к заявке, которая попадает в HUB.

## Colors

У каждой темы своя палитра. Цвета не переносятся между темами.

### Named Rules
**Правило бумаги и чернил (case).** Всё, что лежит на стене, — бумага `#EEE7DA` с чернилами `#1C1428`. Текст прямо на фиолетовой стене — светлый `#F1ECE2`, вторичный `#D6CBEF`. Красный `#E5322D` — только нить, печати и главная кнопка.
**Правило ручки (protocol).** Синий `#1F3FD1` — только то, что «вписано»: значения, цены, рейтинг, отзывы. Печатный текст — чёрный.
**Правило рассвета (night).** Днём (блок `.night-day`) палитра инвертируется в `#F6F3EE` / `#14121C`. Ночные блоки не используют дневной белый как фон.

## Typography

- **case:** Dela Gothic One — заголовки капсом; PT Mono — текст машинописного отчёта; Fira Sans Extra Condensed — подписи и навигация капсом.
- **protocol:** Onest 900 с плотной трекинговой сеткой (−0.035em) — заголовки; Caveat — рукописные значения; JetBrains Mono — поля бланка.
- **night:** Unbounded Light/ExtraBold — реплики ведущего огромным кеглем; Onest — текст.
- **classic:** Manrope 800/400.

Тело текста не уже 65–75 знаков. Шрифты подключаются локально через @fontsource, Google Fonts не используется.

## Layout

Контейнер `min(1320px, 100% − 2·gutter)`, отступ `clamp(16px, 4vw, 56px)`, расстояние между секциями `clamp(64px, 9vw, 128px)`. Сетки на auto-fill с порогом 300–340 px. На ширине ≤1000 px навигация уходит в полноэкранное меню, на ≤860 px двухколоночные шапки страниц складываются в одну колонку. Доска «Дела» на мобильном превращается в сетку из двух колонок, записка с ближайшим вечером выходит первой.

## Elevation & Depth

- **case:** у бумаги физическая тень `0 16px 28px -14px rgba(0,0,0,.6)`, карточки повёрнуты на ±1°, при наведении выпрямляются.
- **protocol:** плоский, глубина задаётся линиями бланка (2 px — рамка, 1 px — строки).
- **night:** без теней, тонкие обводки `rgba(243,241,250,.14)`; глубину даёт небо.
- **classic:** тональные поверхности `#15151D` на `#0B0B10`.

## Shapes

Скругления: case — 4–6 px (бумага, печати), protocol — 0–4 px, night — 22 px и пилюли, classic — 20 px. Бирки цен в case вырезаны пятиугольником (`clip-path`, 5 вершин).

## Components

### Buttons
Классы `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-link`, высота 46 px (lg — 56, sm — 40).
- **case:** красная печать капсом Dela, наклон −1.5°, при наведении выпрямляется.
- **protocol:** чёрная плашка, при наведении синеет.
- **night:** белая пилюля.
- **classic:** фиолетовая, скругление 14 px.

### Форма заявки (`RequestForm`)
Одна форма на все темы: игра, мероприятие, сертификат, вопрос. Справа выезжает шторкой (на телефоне — снизу), на страницах сертификата и контактов встраивается в страницу. Есть чипы выбора вечера из расписания, степпер гостей, тарифы с ценой, ловушка для ботов и обязательное согласие на ПДн. Тема перекрашивает её через переменные `--sheet-*`.

### Signature
- **case:** доска с полароидами, нитями (SVG, дорисовываются при загрузке) и запиской «ближайший вечер».
- **protocol:** таблица мест 1–10 с вписыванием «от руки» по строкам; место №10 — главная кнопка.
- **night:** фиксированное небо `NightSky` (`--sky` 0…1) и дневной блок со скруглением 40 px.

## Do's and Don'ts

### Do:
- **Do** брать цены, расписание и залы только из `getSiteConfig()` (HUB).
- **Do** собирать новые страницы из общих блоков (`Section`, `Formats`, `Schedule`, `StoriesGrid`…) и стилизовать их в CSS каждой темы.
- **Do** уважать `prefers-reduced-motion`: анимации нитей, проявления, вписывания и рассвета отключаются.

### Don't:
- **Don't** ставить подписи-«киккеры» над заголовками: вид публикации идёт строкой под заголовком.
- **Don't** использовать символы и эмодзи вместо иконок — только lucide-react или CSS-графика.
- **Don't** выдумывать факты (партнёров, награды, даты): нужны реальные данные клуба.
