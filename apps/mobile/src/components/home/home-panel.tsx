import { BlurView } from 'expo-blur';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View, type ColorValue } from 'react-native';
import { GestureDetector, GestureHandlerRootView, type ComposedGesture, type GestureType } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { initialWindowMetrics, SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text } from '@/components/text';
import { reconnectHa, useHa } from '@/lib/home-assistant';
import { turnOffZones } from '@/lib/home-control';
import { haptic } from '@/lib/haptics';
import type { Zone } from '@/lib/smart-home-api';
import { colors, space, type } from '@/lib/theme';

import { HEM_RADIUS, HEM_SPACE, HEM_TOUCH_EXTRA, HemEdge, useHemState } from './home-hem';
import { IS_IOS } from './home-surface';
import { ZoneSection } from './home-tiles';

/**
 * Шторка «Свет и климат» — одна панель во всю высоту окна, как настоящая штора. Свёрнутая
 * поднята вверх: на экране остаётся только её подол под строкой состояния. Потянули подол —
 * вся панель едет вниз за пальцем; раскрытая закрывает окно целиком, вместе с таб-баром и
 * плашкой смены. Содержимое (заголовок, помещения) лежит выше подола: у свёрнутой шторки оно
 * за верхним краем рамки и не выглядывает из-под строки состояния.
 *
 * iOS — материал (systemThickMaterial) со скруглённым низом, плитки Liquid Glass поверх.
 * Android — плотная поверхность с тенью и тональные плитки, как шторка быстрых настроек.
 */

/** Прямоугольник, в котором ходит шторка, в координатах её слоя. */
export type ShadeFrame = { x: number; y: number; width: number; height: number };

const MAX_COLUMN = 680;
/** Зона ручки у раскрытой шторки — над полоской «Домой» и жестовой навигацией Android. */
const GRABBER_ZONE = 36;
const SCRIM = IS_IOS ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.45)';

/** Путь низа шторки от подола под строкой состояния до низа рамки. */
export function shadeTravel(frame: ShadeFrame, hemTop: number): number {
  return Math.max(1, frame.height - hemTop - HEM_SPACE);
}

/**
 * Слой шторки. iOS — FullWindowOverlay: вид прямо в окне над таб-баром, без презентации
 * контроллера. Слой пропускает касания везде, кроме своих видов (корни — box-none), а
 * «модальным» для VoiceOver становится, только пока шторка раскрыта. Свой SafeAreaProvider —
 * чтобы внутри были отступы окна (полоска «Домой»), а не экрана кассы с таб-баром.
 *
 * Android: слой уже лежит над панелью вкладок (HomeShadeHost в app/(app)/_layout.tsx).
 */
export function ShadeLayer({ modal, children }: { modal: boolean; children: ReactNode }) {
  if (!IS_IOS) return children;
  return (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={modal}>
      <GestureHandlerRootView pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {children}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </FullWindowOverlay>
  );
}

type ShadePanelProps = {
  zones: Zone[];
  frame: ShadeFrame;
  /** От верха рамки до подола свёрнутой шторки — там, где начинается касса. */
  hemTop: number;
  /** 0 — свёрнута, 1 — раскрыта. */
  progress: SharedValue<number>;
  /** 1 — шторка на месте, 0 — подол спрятан за верх (появление, баннер уведомления). */
  presence: SharedValue<number>;
  /** Шторку тянут или она открыта: подложка, касания содержимого, VoiceOver. */
  engaged: boolean;
  hemGesture: GestureType | ComposedGesture;
  headerGesture: GestureType | ComposedGesture;
  onOpen: () => void;
  onClose: () => void;
};

export function ShadePanel({ zones, frame, hemTop, progress, presence, engaged, hemGesture, headerGesture, onOpen, onClose }: ShadePanelProps) {
  // Отступы окна: iOS — свой провайдер в ShadeLayer, Android — корневой.
  const insets = useSafeAreaInsets();
  const hem = useHemState(zones);

  const hemBottom = hemTop + HEM_SPACE;
  const travel = shadeTravel(frame, hemTop);
  const bottomGap = Math.max(insets.bottom, space.sm);
  // Низ раскрытой шторки под подол: не меньше видимой части свёрнутой, иначе содержимое
  // выглянуло бы из-под строки состояния.
  const footer = Math.max(hemBottom, GRABBER_ZONE + bottomGap);
  const lift = bottomGap + (GRABBER_ZONE - HEM_SPACE) / 2;
  const tuck = hemBottom + HEM_TOUCH_EXTRA + HEM_RADIUS;
  const columnWidth = Math.max(0, Math.min(MAX_COLUMN, frame.width - insets.left - insets.right - space.lg * 2));

  // Один сдвиг на панель и её подол: низ шторки идёт за пальцем 1:1.
  const moveStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (progress.get() - 1) * travel - (1 - presence.get()) * tuck }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  const offAll = () => {
    haptic.warning();
    Alert.alert('Выключить всё?', 'Свет и кондиционеры во всех помещениях.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выключить', style: 'destructive', onPress: () => void turnOffZones(zones) },
    ]);
  };

  return (
    <View pointerEvents="box-none" style={[styles.area, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }]}>
      {engaged && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
      )}

      {/* Сама шторка. Верхние углы — выше рамки, видно только скруглённый низ. */}
      <Animated.View
        pointerEvents={engaged ? 'auto' : 'none'}
        style={[
          styles.panel,
          IS_IOS ? styles.panelIos : styles.panelAndroid,
          { height: frame.height + HEM_RADIUS, paddingTop: HEM_RADIUS + hemTop + space.sm, paddingBottom: footer },
          moveStyle,
        ]}>
        {IS_IOS && <BlurView tint="systemThickMaterial" intensity={100} style={styles.material} />}
        <View
          style={[styles.column, { width: columnWidth }]}
          accessibilityElementsHidden={!engaged}
          importantForAccessibility={engaged ? 'auto' : 'no-hide-descendants'}>
          <GestureDetector gesture={headerGesture}>
            <View style={styles.header}>
              <Text style={[type.title2, styles.title]} accessibilityRole="header" numberOfLines={1}>
                Свет и климат
              </Text>
              {hem.summary.anyOn && (
                <Pressable
                  onPress={offAll}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Выключить всё"
                  android_ripple={{ color: 'rgba(127,127,127,0.2)' }}
                  style={({ pressed }) => [styles.offAll, IS_IOS && pressed && styles.pressed]}>
                  <SymbolView name="power" size={13} weight="bold" tintColor={colors.red} />
                  <Text style={[type.footnote, styles.offAllText]}>Выключить всё</Text>
                </Pressable>
              )}
            </View>
          </GestureDetector>
          <StatusLine />
          {/* Касание строки состояния прокручивает наверх кассу, пока шторка свёрнута (iOS: при двух таких списках — никакой). */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.zones}
            contentInsetAdjustmentBehavior="never"
            scrollsToTop={engaged}
            showsVerticalScrollIndicator={false}>
            {zones.map((zone) => (
              <ZoneSection key={zone.id} zone={zone} width={columnWidth} />
            ))}
          </ScrollView>
        </View>
        <HemEdge state={hem} progress={progress} lift={lift} />
      </Animated.View>

      {/* Подол как место касания: низ шторки и полоса чуть ниже края. Едет вместе с панелью. */}
      <GestureDetector gesture={hemGesture}>
        <Animated.View
          style={[styles.hemHit, { top: frame.height - footer, height: footer + HEM_TOUCH_EXTRA }, moveStyle]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={engaged ? 'Свернуть свет и климат' : 'Свет и климат'}
          accessibilityValue={engaged ? undefined : { text: hem.description }}
          accessibilityHint={engaged ? undefined : 'Открывает управление светом и кондиционерами'}
          onAccessibilityTap={engaged ? onClose : onOpen}
        />
      </GestureDetector>
    </View>
  );
}

function Notice({ icon, tone, text, spinner, children }: { icon?: SFSymbol; tone?: ColorValue; text: string; spinner?: boolean; children?: ReactNode }) {
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      {spinner ? <ActivityIndicator size="small" /> : icon ? <SymbolView name={icon} size={14} weight="semibold" tintColor={tone} /> : null}
      <Text style={[type.footnote, styles.noticeText]}>{text}</Text>
      {children}
    </View>
  );
}

/** Строка под заголовком — только когда что-то не так: нет связи, токен, отказ команды. */
function StatusLine() {
  const status = useHa((s) => s.status);
  const failure = useHa((s) => s.failure);
  if (failure) return <Notice icon="exclamationmark.triangle" tone={colors.red} text={failure} />;
  if (status === 'connecting') return <Notice spinner text="Подключаемся к Home Assistant…" />;
  if (status === 'auth_failed') {
    return <Notice icon="exclamationmark.triangle" tone={colors.red} text="Home Assistant не принял токен — владелец обновит его в «Интеграциях»." />;
  }
  if (status === 'offline') {
    return (
      <Notice icon="wifi.slash" tone={colors.orange} text="Нет связи с домом. Телефон должен быть в Wi‑Fi клуба.">
        <Pressable hitSlop={8} onPress={reconnectHa} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
          <Text style={[type.footnote, styles.retry]}>Повторить</Text>
        </Pressable>
      </Notice>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  // Рамка режет всё, что выше неё: на iPad шторка выходит из-под верхнего таб-бара.
  area: { position: 'absolute', overflow: 'hidden' },
  scrim: { backgroundColor: SCRIM },
  panel: { position: 'absolute', top: -HEM_RADIUS, left: 0, right: 0, alignItems: 'center', borderRadius: HEM_RADIUS, borderCurve: 'continuous' },
  // Тень — на внешнем виде, материал — внутри со скруглением (обрезка гасит тень iOS).
  panelIos: { boxShadow: '0 6px 20px rgba(0,0,0,0.14)' },
  panelAndroid: { backgroundColor: colors.floating, elevation: 6 },
  material: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: HEM_RADIUS, borderCurve: 'continuous', overflow: 'hidden' },
  column: { flex: 1, gap: space.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingHorizontal: 4 },
  title: { flex: 1, color: colors.label },
  offAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: colors.fill,
    overflow: 'hidden',
  },
  offAllText: { color: colors.red, fontWeight: '600' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  noticeText: { flex: 1, color: colors.secondaryLabel },
  retry: { color: colors.accent, fontWeight: '600' },
  scroll: { flex: 1 },
  zones: { gap: space.xl, paddingTop: space.xs, paddingBottom: space.md },
  hemHit: { position: 'absolute', left: 0, right: 0 },
  pressed: { opacity: 0.55 },
});
