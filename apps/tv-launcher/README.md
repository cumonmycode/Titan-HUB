# Titan TV — главный экран телевизора в кабинке

Лаунчер Android TV для кабинок клуба (пакет `ru.titan.tv`), сделан на основе «Стекла» владельца.
Первый ТВ — Xiaomi Mi TV P1 (MiTV-MSSP1, Android TV 9, 32-битный MediaTek, 2 ГБ) в «Маленькой
кабинке» (смотровая), адрес `192.168.1.253`.

Что на экране:

- слева — знак клуба, «TITAN · <кабинка>», время, дата и погода из Home Assistant;
- справа — «Источники» (HDMI), «Свет и климат», «Позвать администратора»; под ними приглашение
  «Слушайте свою музыку через AirPlay», пока дополнение AirPlay видит этот ТВ;
- ряд плиток: «Фильмы и сериалы» (всё видео: YouTube, Кинопоиск, Wink, VK Видео, Rutube, Twitch,
  TiviMate, Lampa — отдельный экран-кинозал), Spotify, «Все приложения». Ряд задаётся только в
  `config.json`, гость его не меняет;
- через 2 минуты без пульта — заставка: знак клуба и подсказки в углу (свет и кондиционер, AirPlay,
  вызов администратора, кино, источники).

«Свет и климат» открывается и кнопкой Ассистента на пульте — поверх любого приложения. Свет — сущности
`light.*` или `switch.*`, кондиционер — `climate.*` (← → температура, OK вкл/выкл, режимы и обдув).
«Позвать администратора» запускает в HA действие из `room.callStaff` (у клуба — скрипт, который
объявляет вызов голосом), повторно — не чаще раза в минуту.

## Сборка

```bash
cd apps/tv-launcher
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
./gradlew :app:testDebugUnitTest :app:assembleRelease   # → app/build/outputs/apk/release/app-release.apk
```

Подпись — тот же ключ, что у Titan Menu: `~/.titan-keys/titan-menu.properties`. Без него релиз
подписывается отладочным ключом, и обновление поверх установленного не встанет.

Модуль `wifiguard` (`ru.titan.wifi`) нужен только ТВ на Android 10+: там обычное приложение не может
само включить Wi-Fi. На Android 9 лаунчер переподключается сам, помощник не ставится.

## Установка и настройка

```bash
adb connect 192.168.1.253:5555
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell cmd package set-home-activity ru.titan.tv/.MainActivity
./push-config.sh 192.168.1.253 path/to/config.json   # шаблон — config.example.json
```

`config.json` с токеном HA в репозиторий не кладётся (`.gitignore`). Лаунчер проверяет его, хранит
зашифрованным ключом Android Keystore и удаляет открытую копию. Обновление APK поверх (`install -r`)
настройки сохраняет.

## Очистка ТВ (`tv-tools`)

`audit.sh` — снимок ТВ без изменений; `cleanup.sh <ip> <профиль>` — удаление пакетов для пользователя 0
(журнал и список для отката в `tv-tools/runs/`, локально); `restore.sh` — возврат.
Профили Mi TV P1: `xiaomi-mitv-p1.txt` (до установки лаунчера) и `xiaomi-mitv-p1-stage2.txt` (после).

Сделано на ТВ 2026-10-28, кроме профилей:

- мастер настройки Google заморожен (`pm disable-user com.google.android.tungsten.setupwraith`), не
  удалён: он создатель сохранённой сети «Titan», и Android удаляет сеть вместе с приложением;
- анимации окон, переходов и приложений 0.5, Play Protect и отправка отчётов выключены, поиск сетей
  в фоне и геолокация выключены, системная заставка выключена (своя — в лаунчере);
- фоновая работа запрещена (`cmd appops set <pkg> RUN_ANY_IN_BACKGROUND ignore` и `RUN_IN_BACKGROUND`)
  Google Play — это же останавливает автообновления — и видеоприложениям: Кинопоиск, Wink, VK Видео,
  Rutube, Twitch, YouTube, TiviMate, Lampa, Vimu. Happ (VPN), Spotify и сервисы Google не ограничены;
- установка APK из приложений запрещена всем (`appops … REQUEST_INSTALL_PACKAGES deny`);
- Live TV (`com.mediatek.wwtv.tvcenter`) скрыт из лаунчера, но остаётся на ТВ: он же показывает HDMI.

## Грабли

- **Производительность.** На этом ТВ полноэкранный кадр дорогой, а графику делит вся система:
  - ничего не анимировать бесконечно — медленный дрейф фона «Стекла» давал 141 кадр по 150 мс
    за 10 с простоя и тормозил весь ТВ вместе с пультом;
  - никаких размытых теней под текстом (`Shadow(blurRadius)`): на Android 9 они считаются на CPU
    в каждом анимированном кадре (выдача команд 60 мс → 7 мс без них);
  - без `shadowElevation` и 3D-наклона плиток.

  Проверка: `adb shell dumpsys gfxinfo ru.titan.tv framestats` — для сравнения системные «Настройки»
  рисуют кадр за ~6 мс.

- `adb exec-out screencap` на этом ТВ отдаёт мусор — снимать `screencap -p /sdcard/s.png` и `adb pull`.
  С лаунчером Google снимок был чёрным, с Titan TV — нормальный.
- Load average ~110 — норма для этого ядра MediaTek (около сотни потоков в состоянии D), загрузку
  смотреть в `top`.
- AirPlay работает через дополнение Home Assistant «Steklo AirPlay» (`_steklo-airplay._tcp`); строку
  протокола в коде не переименовывать.
