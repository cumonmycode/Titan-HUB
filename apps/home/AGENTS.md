# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Приложение

Titan Home 2.0 — киоск самообслуживания на Android-планшете кабинки: действующий счёт, меню и заказ (без фото), «Администратор» (позвать + чат), оплата по QR СБП с чаевыми, оценка вечера и вытягиваемая от края панель «Свет и климат» (Home Assistant, только на главном экране). Описание — `docs/HOME_APP.md`, план и эталон замеров — `docs/HOME_REFACTOR_PLAN.md`.

- Только Android (`platforms: ["android"]`), пакет `ru.titan.home`. Нативные папки `android/` не хранятся в git — `npx expo prebuild` из `app.json` и `plugins/`.
- Структура `src/`:
  - `app/` — тонкие маршруты: `index` (экран гостя), `setup`, `staff/*`;
  - `ui/` — дизайн-система: токены, `Glass`, `Press`, `T`, кнопки, `Segmented`, `Layer`, тосты;
  - `data/` — API клуба, сессия, поток зоны (`stream.ts`), синхронизация состояния (`sync.ts`), меню с ETag, кэш на диске;
  - `features/` — `visit` (машина визита + стор + «двигатель»), `guest`, `bill`, `menu`, `service`, `pay`, `finish`, `room`, `staff`;
  - `lib/` — мелочи (формат, хаптика, активность, настройки планшета).
- **Данные.** Планшет не опрашивает сервер: один SSE-поток `/api/tablet/stream` (события своей зоны) → `requestSync()` → `GET /api/tablet/state`. Запасной таймер — 60 с при живом потоке, 10 с без него. Итог счёта считает сервер — на планшете денежной математики нет.
- **Визит** (`features/visit/machine.ts`) — чистая функция с тестами: idle → session → finish. Смена визита сама закрывает слои и чистит корзину.
- **Дизайн «стекло»** без живого размытия: статичный фон (`assets/images/ambient-*.jpg`) + полупрозрачные слои со светлой верхней кромкой. Запрещено: `boxShadow` с размытием, бесконечные анимации, анимации раскладки в списках — на Adreno 610 (Honor) это лаги. Нажатия — только через `ui/press.tsx` (отклик на UI-потоке).
- **zustand:** селектор не должен возвращать новый объект/массив (`useCart((s) => cartSummary(s.lines))` зацикливает перерисовку) — выбирайте исходные данные и считайте в компоненте.
- **Шрифт** Inter (`@expo-google-fonts/inter`): жирность задаётся семейством (`font.semibold`), не `fontWeight`. Иконки — `lucide-react-native`.
- Home Assistant — **нативный** модуль `modules/titan-ha` (Kotlin, OkHttp WebSocket) + foreground-сервис `HaService`: держит связь постоянно, шлёт в JS только изменения (`onStatus`, `onEntities`, склейка 100 мс), команды при переподключении ждут в очереди до 10 с, последний режим кондиционера хранит на планшете. JS (`features/room/ha.ts`) только показывает состояние и шлёт команды. Не переносить соединение обратно в JS.
- Киоск — `modules/titan-kiosk` (Kotlin): закрепление, владелец устройства, полный экран, ориентация, исключения системных жестов у края, перезапуск после падения.
- **Размер экрана — только `useScreen()`** (`ui/screen.ts`, из `onLayout` корня), не `useWindowDimensions`: после поворота Android отдаёт новые размеры окна в JS с опозданием до 6 с, и экран всё это время в старой раскладке.
- **Клавиатура:** киоск во весь экран, `adjustResize` окно не сжимает — место освобождать по `useKeyboardHeight()` (`ui/keyboard.ts`).
- **Жест «Назад» от края** (навигация жестами) перехватывает свайпы у края экрана — где тянут от края, ставить `Kiosk.setGestureExclusion` (≤ 200 dp на край).
- ESLint (правила React Compiler) держать чистым: без setState/`Date.now()` в рендере, таймеры — через эффекты и `useEffectEvent`, shared values — через `.set()`.

## Проверка

```bash
npm run typecheck && npm run lint && npm test
npx expo export --platform android
```

Сборка и установка на планшет: `npm run android:device`. Для локального стенда (http на 10.0.2.2 / 192.168.x.x) — `EXPO_PUBLIC_LOCAL_STACK=1 npm run android:device`.
