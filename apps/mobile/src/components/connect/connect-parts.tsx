import { Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text as RNText } from '@/components/text';
import { codeUntil, type ConnectScopeInfo } from '@/lib/connect-api';
import { colors, radius, space, type } from '@/lib/theme';

/** Цвет и значок Titan Connect — одни в каталоге интеграций и на экранах модуля. */
export const CONNECT_COLOR = '#7C3AED';

/**
 * Одноразовый код крупно: его диктуют или вводят в стороннем сервисе. Под кодом — до
 * какого времени он действует; истёкший код помечается, чтобы не диктовать мёртвый.
 */
export function CodeCard({ code, expiresAt }: { code: string; expiresAt: string }) {
  const expired = useExpired(expiresAt);
  return (
    <View style={styles.card} accessible accessibilityLabel={`Код подключения ${code.split('').join(' ')}`}>
      <RNText style={[styles.code, expired && styles.expired]} selectable>
        {code}
      </RNText>
      <RNText style={[type.footnote, styles.caption]}>{expired ? 'Код истёк — получите новый' : `${codeUntil(expiresAt)} · вводится один раз`}</RNText>
    </View>
  );
}

/** true, когда срок кода прошёл; часы обновляются раз в 15 секунд. */
function useExpired(expiresAt: string): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return new Date(expiresAt).getTime() <= now;
}

/** Шапка экрана модуля: значок, название, что даёт. */
export function ConnectHero() {
  return (
    <View style={styles.hero}>
      <View style={styles.top}>
        <View style={styles.icon}>
          <SymbolView name="link.circle.fill" size={30} weight="semibold" tintColor="white" />
        </View>
        <View style={styles.flex}>
          <RNText style={[type.title3, styles.label]}>Titan Connect</RNText>
          <RNText style={[type.subhead, styles.secondary]}>Данные клиентов для ваших сервисов</RNText>
        </View>
      </View>
      <RNText style={[type.subhead, styles.label]}>
        Сайт рейтинга, бот турниров, CRM — любой сервис получает ники, имена, фото и другие данные клиентов клуба. Подключение одноразовым кодом: сервис вводит его один раз и
        дальше работает сам, пока вы его не отключите.
      </RNText>
    </View>
  );
}

/** Переключатель права с пояснением; базовое право включено всегда. */
export function ScopeToggle({ scope, on, onChange }: { scope: ConnectScopeInfo; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Toggle isOn={scope.required || on} onIsOnChange={(next) => !scope.required && onChange(next)}>
      <VStack alignment="leading" spacing={1}>
        <Text modifiers={[lineLimit(1)]}>{scope.required ? `${scope.title} · всегда` : scope.title}</Text>
        <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(3)]}>{scope.description}</Text>
      </VStack>
    </Toggle>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl, paddingHorizontal: space.lg, borderRadius: radius.card },
  code: { fontSize: 40, lineHeight: 48, fontWeight: '700', letterSpacing: 4, color: colors.label, fontVariant: ['tabular-nums'] },
  expired: { color: colors.tertiaryLabel, textDecorationLine: 'line-through' },
  caption: { color: colors.secondaryLabel, textAlign: 'center' },
  hero: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  icon: { width: 60, height: 60, borderRadius: 15, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: CONNECT_COLOR },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
});
