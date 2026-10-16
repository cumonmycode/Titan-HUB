# MafBoard

Приложение-компаньон ведущего игры «Мафия» — городской и спортивной.
Ведёт игру целиком: рассадка, раздача ролей, фазы, голосования, фолы, итоги, рейтинги
за игру, вечер и любой период. Режимы: фанка, рейтинг, миникап, турнир.

Сначала iOS (Swift / SwiftUI), затем Android.

Отдельное приложение в монорепозитории Titan HUB: собирается своим Xcode/SwiftPM, в pnpm-воркспейс
и серверные Docker-образы не входит. Сервер приложения — модуль `apps/api/src/modules/mafboard`
([docs/MAFBOARD.md](../../docs/MAFBOARD.md)), в проде: `https://mafboard.titanpos.ru/api/mafboard`.

## Состав

- `MafBoardCore/` — Swift-пакет: ядро `MafBoardCore` (правила, движок, баллы, рейтинги, аккаунты, вход через Telegram) и `MafBoardClient` (клиент API сервера). Покрыто тестами.
- `docs/ARCHITECTURE.md` — архитектура, поток игры, отличия правил, открытые вопросы.
- `docs/API.md` — контракт сервера: вход через Telegram-бота, GoMafia, история игр клуба.

Интерфейс приложения ещё впереди.

## Разработка

Нужен Xcode 26+ (Swift 6.2+).

```bash
cd apps/mafboard/MafBoardCore
swift build
swift test
```

Пакет можно открыть в Xcode: `open apps/mafboard/MafBoardCore/Package.swift`.
