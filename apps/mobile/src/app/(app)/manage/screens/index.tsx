import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppRefreshControl } from '@/components/refresh-control';
import { ScreenPreview } from '@/components/screen-preview';
import { Text } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { deviceStatus, nowOnScreen, showLabel, THEMES, useScreens, type Screen } from '@/lib/screens-api';
import { useSession } from '@/lib/session';
import { colors, space, type, useAccentHex } from '@/lib/theme';

const TILE_MIN = 160;
const TILE_PAD = space.md;

/**
 * «Экраны» — телевизоры клуба с Titan Menu плитками: превью, что показывает и в сети ли.
 * «+» сразу ищет телевизор в Wi‑Fi сети; всё остальное — внутри экрана.
 */
export default function ScreensScreen() {
  const router = useRouter();
  const gutter = usePageGutter();
  const accent = useAccentHex();
  const { width } = useWindowDimensions();
  const screens = useScreens();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const [pulling, setPulling] = useState(false);
  const list = screens.data ?? [];

  const inner = width - gutter.paddingLeft - gutter.paddingRight;
  const columns = Math.max(1, Math.floor((inner + space.md) / (TILE_MIN + space.md)));
  const tile = Math.floor((inner - space.md * (columns - 1)) / columns);
  const connect = () => {
    haptic.light();
    router.push('/manage/screens/connect');
  };

  return (
    <View style={styles.screen}>
      <Stack.Title>Экраны</Stack.Title>
      {isOwner ? (
        <Stack.Toolbar placement="right">
          <ToolbarButton icon="plus" accessibilityLabel="Добавить экран" onPress={connect} />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        refreshControl={
          <AppRefreshControl
            tintColor={colors.accent}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void screens.refetch().finally(() => setPulling(false));
            }}
          />
        }
      >
        {screens.isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : screens.error && !screens.data ? (
          <Text style={[type.body, styles.secondary, styles.centerText]}>{`Нет связи. ${screens.error.message}`}</Text>
        ) : list.length === 0 ? (
          <View style={styles.empty}>
            <SymbolView name="tv" size={48} tintColor={colors.tertiaryLabel} />
            <Text style={[type.title3, styles.label]}>Телевизоров пока нет</Text>
            <Text style={[type.subhead, styles.secondary, styles.centerText]}>Откройте Titan Menu на приставке — телефон найдёт её в той же Wi‑Fi сети по коду на экране.</Text>
            {isOwner ? (
              <Pressable onPress={connect} style={({ pressed }) => [styles.cta, { backgroundColor: accent }, pressed && styles.pressed]} accessibilityRole="button">
                <SymbolView name="antenna.radiowaves.left.and.right" size={17} tintColor="white" />
                <Text style={[type.headline, styles.ctaText]}>Подключить телевизор</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              {list.map((s) => (
                <ScreenTile key={s.id} screen={s} width={tile} onPress={() => router.push({ pathname: '/manage/screens/[screenId]', params: { screenId: s.id } })} />
              ))}
            </View>
            <Text style={[type.footnote, styles.secondary, styles.footer]}>Приставка подхватывает изменения за 20 секунд.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ScreenTile({ screen, width, onPress }: { screen: Screen; width: number; onPress: () => void }) {
  const status = deviceStatus(screen);
  const theme = THEMES.find((t) => t.key === screen.theme)?.name;
  const isBooth = screen.deviceApp === 'launcher';
  const subtitle = isBooth
    ? ['ТВ в кабинке', screen.deviceState && nowOnScreen(screen.deviceState)].filter(Boolean).join(' · ')
    : [showLabel(screen.show), screen.show.menu ? theme : null].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      style={({ pressed }) => [styles.tile, { width }, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${screen.name}, ${status.label}`}
    >
      <View style={styles.previewBox}>
        {isBooth ? (
          <View style={[styles.booth, { width: width - TILE_PAD * 2, height: ((width - TILE_PAD * 2) * 9) / 16 }]}>
            <SymbolView name="tv.inset.filled" size={34} tintColor="white" />
          </View>
        ) : (
          <ScreenPreview rotation={screen.rotation} theme={screen.theme} width={width - TILE_PAD * 2} />
        )}
      </View>
      <Text style={[type.headline, styles.label]} numberOfLines={1}>
        {screen.name}
      </Text>
      <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
        {subtitle}
      </Text>
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: status.color }]} />
        <Text style={[type.caption1, styles.secondary]} numberOfLines={1}>
          {status.label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  booth: { borderRadius: 10, borderCurve: 'continuous', backgroundColor: '#2A1B5C', alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { gap: space.lg, paddingTop: space.md, paddingBottom: space.xxxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { padding: TILE_PAD, gap: 3, borderRadius: 18, borderCurve: 'continuous', backgroundColor: colors.card },
  previewBox: { minHeight: 120, justifyContent: 'center', marginBottom: space.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  centerText: { textAlign: 'center' },
  footer: { textAlign: 'center' },
  loading: { marginTop: space.xxl },
  empty: { alignItems: 'center', gap: space.sm, paddingTop: space.xxxl, paddingHorizontal: space.lg },
  cta: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg, paddingHorizontal: space.xl, height: 50, borderRadius: 25 },
  ctaText: { color: 'white' },
  pressed: { opacity: 0.7 },
});
