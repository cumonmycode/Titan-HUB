import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { plural } from '@/lib/format';
import { useHa, type HaStatus } from '@/lib/home-assistant';
import { homeSummary, type HomeSummary } from '@/lib/home-control';
import type { Zone } from '@/lib/smart-home-api';
import { colors, type } from '@/lib/theme';

/**
 * Подол шторки «Свет и климат» — нижний край самой панели (home-panel.tsx), а не отдельная
 * полоса. Свёрнутая шторка поднята так, что под строкой состояния виден только он: ручка
 * посередине, рядом — что горит. У раскрытой шторки ручка стоит над полоской «Домой».
 */

/** Сколько подола видно под строкой состояния: касса опускает шапку ровно на столько. */
export const HEM_SPACE = 16;
/** Скругление низа шторки (и формы размытия под строкой состояния на кассе). */
export const HEM_RADIUS = 28;
/** Касание чуть ниже подола тоже берёт шторку: полоса тонкая. */
export const HEM_TOUCH_EXTRA = 8;
/** Потолок роста цифр: им некуда расти в полосе высотой 16 pt. */
const COUNT_MAX_SCALE = 1.2;
/** Значки гаснут за первую четверть пути: у раскрытой шторки остаётся одна ручка. */
const STATUS_FADE = 4;

export type HemState = { status: HaStatus; connecting: boolean; summary: HomeSummary; description: string };

/** Что горит и есть ли связь — для значков на подоле и для VoiceOver. */
export function useHemState(zones: Zone[]): HemState {
  const status = useHa((s) => s.status);
  const entities = useHa((s) => s.entities);
  const summary = homeSummary(zones, entities);
  const connecting = status === 'connecting' && Object.keys(entities).length === 0;
  return { status, connecting, summary, description: describe(status, connecting, summary) };
}

type HemEdgeProps = {
  state: HemState;
  progress: SharedValue<number>;
  /** На сколько ручка поднимается от края к раскрытию (над полоской «Домой»). */
  lift: number;
};

/** Ручка и значки у нижнего края панели. Касаний не берёт — их ловит подол в home-panel.tsx. */
export function HemEdge({ state, progress, lift }: HemEdgeProps) {
  const edgeStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -progress.get() * lift }] }));
  const statusStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, progress.get() * STATUS_FADE) }));

  return (
    <Animated.View pointerEvents="none" style={[styles.edge, edgeStyle]}>
      <View style={styles.grabber} />
      <Animated.View style={[styles.status, statusStyle]}>
        <HemStatus state={state} />
      </Animated.View>
    </Animated.View>
  );
}

/** Значки рядом с ручкой: горящий свет и кондиционеры с числом, нет связи, подключение. */
function HemStatus({ state: { status, connecting, summary } }: { state: HemState }) {
  if (connecting) return <ActivityIndicator size="small" color={colors.secondaryLabel} style={styles.spinner} />;
  if (status === 'offline' || status === 'auth_failed') return <SymbolView name="wifi.slash" size={11} weight="semibold" tintColor={colors.orange} />;
  if (!summary.anyOn) return null;
  return (
    <>
      {summary.lightsOn > 0 && (
        <View style={styles.stat}>
          <SymbolView name="lightbulb.fill" size={11} tintColor={colors.yellow} />
          <Text style={[type.caption2, styles.count]} maxFontSizeMultiplier={COUNT_MAX_SCALE}>
            {summary.lightsOn}
          </Text>
        </View>
      )}
      {summary.climatesOn > 0 && (
        <View style={styles.stat}>
          <SymbolView name="snowflake" size={11} weight="semibold" tintColor={colors.cyan} />
          <Text style={[type.caption2, styles.count]} maxFontSizeMultiplier={COUNT_MAX_SCALE}>
            {summary.climatesOn}
          </Text>
        </View>
      )}
    </>
  );
}

function describe(status: HaStatus, connecting: boolean, summary: HomeSummary): string {
  if (connecting) return 'Подключаемся';
  if (status === 'offline' || status === 'auth_failed') return 'Дом не на связи';
  if (!summary.anyOn) return 'Всё выключено';
  const parts: string[] = [];
  if (summary.lightsOn > 0) parts.push(`${summary.lightsOn} ${plural(summary.lightsOn, ['лампа горит', 'лампы горят', 'ламп горят'])}`);
  if (summary.climatesOn > 0) {
    parts.push(`${summary.climatesOn} ${plural(summary.climatesOn, ['кондиционер включён', 'кондиционера включены', 'кондиционеров включены'])}`);
  }
  return parts.join(', ');
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: HEM_SPACE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 36, height: 5, borderRadius: 2.5, backgroundColor: colors.tertiaryLabel },
  // Значки — справа от ручки, а сама ручка остаётся строго по центру.
  status: { position: 'absolute', left: '50%', marginLeft: 18 + 8, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  count: { color: colors.label, fontWeight: '700', fontVariant: ['tabular-nums'] },
  spinner: { transform: [{ scale: 0.6 }] },
});
