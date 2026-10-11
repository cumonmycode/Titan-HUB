// Metro-конфиг: на Android подменяем модули, у которых нет Android-реализации;
// на iOS — только SwiftUI-формы (см. IOS_ALIASED).
//
// Приложение написано под iOS 26: иконки — SF Symbols (expo-symbols), контролы —
// SwiftUI (@expo/ui/swift-ui). На Android нативных вью SwiftUI нет, поэтому
// `requireNativeView('ExpoUI', …)` падает, а SymbolView без android-имени рисует
// пустоту. Слой в src/compat/android воспроизводит те же API на React Native, и
// подмена делается здесь — чтобы 90 экранов остались без единой правки импортов.
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const COMPAT = path.resolve(__dirname, 'src/compat/android');
const ANDROID_ALIASES = {
  'expo-symbols': path.join(COMPAT, 'symbols.tsx'),
  // Штатный expo-glass-effect на Android рендерит пустой View — карточки теряют фон.
  'expo-glass-effect': path.join(COMPAT, 'glass-effect.tsx'),
  '@expo/ui/swift-ui': path.join(COMPAT, 'swift-ui/index.tsx'),
  '@expo/ui/swift-ui/modifiers': path.join(COMPAT, 'swift-ui/modifiers.ts'),
};

// iOS: формы тоже рисует RN-слой. SwiftUI Form строился по 110–220 мс на переход —
// анимации дёргались; RN-разметка тех же экранов в 2–3 раза быстрее. Меню, сегменты,
// дата и графики остаются нативными вставками (swift-ui/islands.ios.tsx).
const IOS_ALIASED = new Set(['@expo/ui/swift-ui', '@expo/ui/swift-ui/modifiers']);
// Экраны, которым нужен настоящий SwiftUI целиком: перетаскивание строк List (editMode).
const IOS_NATIVE_SCREENS = [path.join('src', 'app', '(app)', 'manage', 'goods', 'reorder.tsx')];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const alias = ANDROID_ALIASES[moduleName];
  const origin = context.originModulePath ?? '';
  // Сам слой совместимости импортирует настоящие модули — иначе подмена замкнулась бы на себя.
  const fromCompat = origin.startsWith(COMPAT);
  const iosAliased = platform === 'ios' && IOS_ALIASED.has(moduleName) && !IOS_NATIVE_SCREENS.some((screen) => origin.endsWith(screen));
  if (alias && !fromCompat && (platform === 'android' || iosAliased)) {
    return { type: 'sourceFile', filePath: alias };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
