# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Приложение

My Titan — клиентское приложение клуба (iOS + Android): бонусы, депозит/долг, история, оплата через СБП, уведомления. Полное описание — `docs/CLIENT_APP.md` в корне репозитория.

- Оформление фирменное тёмное Titan (цвета только из `src/lib/theme.ts`), а элементы — нативные Liquid Glass iOS 26 (с 1.1.0): `NativeTabs`, стек с крупным заголовком на вкладку, `formSheet`, `Stack.Toolbar`, SF Symbols, `UISegmentedControl`. Стекло — только через `components/glass.tsx` (не из `expo-glass-effect` напрямую: там досоздание «пустого» эффекта и запасной вид для Android/старых iOS). Иконки — только через `components/icon.tsx`. Без PlatformColor, SwiftUI (`@expo/ui`) и слоя совместимости `apps/mobile`. Подробно — `docs/CLIENT_APP.md`, раздел «Интерфейс».
- Фирменный фон (`backdrop`) — стилем `contentStyle` экрана, никаких слоёв перед ScrollView: иначе iOS не размывает край под шапкой.
- Нативные папки `ios/` и `android/` не хранятся в git — они генерируются `npx expo prebuild` из `app.json` и `plugins/`.
- Все запросы идут через `src/lib/api.ts`; в демо-режиме их обслуживает `src/lib/demo.ts`. Новый эндпоинт → добавить его и в демо, иначе демо покажет ошибку.
- **iOS 27: плагин `plugins/with-scene-lifecycle` обязателен.** Без жизненного цикла UIScene сборка Xcode 27 мгновенно падает на устройствах с iOS 27 (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). Симулятор iOS 26 этого не ловит — проверять на iOS 27.
- Деньги не проводятся офлайн и не ставятся в очередь: оплата — только онлайн-платёж через сервер, зачисление по вебхуку банка.
- ESLint (правила React Compiler) держать чистым: shared value через `.set()`, без setState/записи в ref во время рендера, опрос и таймеры — через `useEffectEvent`.

## Перед коммитом

```bash
npm run typecheck && npm run lint
npx expo export --platform ios && npx expo export --platform android
```
