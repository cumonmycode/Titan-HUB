# Анимированные рекламные сцены экранов

75 сцен для показа «Общего зала» (элемент показа «анимация», kind `page`, миграция 101):
HTML-страница с моушном на GSAP и фото из архива клуба, без повторов фото между сценами.
Экран ТВ (`tv-menu.html`) открывает сцену в iframe на время элемента (`?d=` секунд), сцена
шлёт `titan-ad-ready`, когда загрузила фото, и только тогда играет; не ответила за 6 с —
показывается статичный кадр (постер).

- `src/scenes.js` — сцены: шаблон, тексты (только факты с titanmafia.ru), QR, запросы на фото.
- `src/pick-photos.js` → `photos.json` — подбор фото из архива (выгрузка smm_library в
  `.cache/land.tsv`, `.cache/port.tsv`) без повторов и без серий одного момента.
- `src/templates.js`, `src/ads.css`, `src/motion.js` — 21 шаблон: разметка, вид, хореография.
- `src/build.js` → `dist/`; `src/render.js` — постеры и кадры для проверки (`?t=` — перемотка).

```bash
cd apps/screen-ads && npm ci
npm run pick && npm run fetch          # фото: подбор и скачивание (превью Google Диска)
npm run build                          # dist/<id>.html + media/
node src/render.js posters             # dist/posters/<id>.png → сжать в JPG (sips/ffmpeg)
node src/render.js frames /tmp/fr 0.9,2,7 city   # кадры моушна для проверки
bash ../../scripts/publish-screen-ads.sh         # → titanpos.ru/apps/ads/
```

Движение — без отскоков (expo/power), быстрые входы и медленная «камера» по фото до конца.
