import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { KeyboardAvoidingView, useKeyboardState } from 'react-native-keyboard-controller';
import Animated, { Keyframe, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text, TextInput, textScaleProps } from '@/components/text';
import { GlassView } from '@/components/glass';
import { ClearButton } from '@/components/clear-button';
import { CircleButton, GlassChip, sheetStyles } from '@/components/new-check-parts';
import { RollingText } from '@/components/rolling-text';
import { checkTotals } from '@/lib/checks';
import { formatMoney } from '@/lib/format';
import { categoryHex, categorySymbol, isTariffCategory } from '@/lib/catalog-api';
import { haptic } from '@/lib/haptics';
import { addItem, type MenuCategory, type MenuItem, useMenu } from '@/lib/pos-api';
import { useCheck } from '@/lib/queries';
import { effectiveTextScale, FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, springs, type } from '@/lib/theme';
import { useNow } from '@/lib/use-now';

/**
 * Меню чека — стеклянная шторка поверх чека: на средней высоте чек за ней виден и его
 * сумма обновляется после каждого нажатия. Плитки — интерактивное стекло; позиция,
 * которая уже в чеке, окрашена цветом своей категории. Каждое нажатие — «+1» и отклик.
 */

const ALL = 'all';
const SEARCH_HEIGHT = 48;
/**
 * Самая узкая плитка позиции в единицах текста. Уже — сетка теряет колонку (но их не меньше
 * двух): на «Увеличенном» виде и с крупным текстом три колонки рвали названия по буквам.
 */
const TILE_MIN_TEXT_WIDTH = 110;
/**
 * На Android шторка с двумя высотами раскладывает содержимое на полную высоту и
 * просто сдвигает его вниз: на средней высоте нижний край — за экраном, и капсула
 * поиска у нижнего края была не видна вовсе. Поэтому там поиск — сверху, как в веб-кассе.
 */
const SEARCH_ON_TOP = Platform.OS === 'android';
const TOP = 'top';
const OTHER = 'other';

type Section = { key: string; title: string; symbol: SFSymbol; color: string; items: MenuItem[] };
type Row = { type: 'header'; key: string; section: Section } | { type: 'row'; key: string; items: MenuItem[] };

const bumpUp = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }, { scale: 0.8 }] },
  25: { opacity: 1, transform: [{ translateY: -8 }, { scale: 1.15 }] },
  100: { opacity: 0, transform: [{ translateY: -34 }, { scale: 1 }] },
}).duration(650);

export default function MenuSheet() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardState((state) => state.isVisible);
  // Капсула поиска парит над сеткой у нижнего края; с клавиатурой — прямо над ней.
  const searchBottom = keyboardOpen ? space.sm : Math.max(insets.bottom - 6, space.md);
  const listBottom = SEARCH_ON_TOP ? insets.bottom + space.xxxl : SEARCH_HEIGHT + searchBottom + space.lg;
  const menu = useMenu();
  const check = useCheck(checkId);
  const now = useNow(30_000);
  const [category, setCategory] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [width, setWidth] = useState(0);

  const categories = useMemo(() => {
    const list = menu.data?.categories ?? [];
    return [...list.filter((c) => !isTariffCategory(c)), ...list.filter(isTariffCategory)];
  }, [menu.data]);

  const inCheck = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of check.data?.items ?? []) {
      counts.set(row.checkItem.itemId, (counts.get(row.checkItem.itemId) ?? 0) + row.checkItem.quantity);
    }
    return counts;
  }, [check.data]);

  const { fontScale } = useWindowDimensions();
  const maxColumns = width >= 700 ? 5 : width >= 520 ? 4 : 3;
  const columns = Math.max(2, Math.min(maxColumns, Math.floor(width / (TILE_MIN_TEXT_WIDTH * effectiveTextScale(fontScale)))));
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const rows = useMemo<Row[]>(() => {
    const items = menu.data?.items ?? [];
    const q = query.trim().toLocaleLowerCase('ru');
    let sections: Section[];

    if (q) {
      const found = items.filter(
        (i) => i.name.toLocaleLowerCase('ru').includes(q) || (i.searchTags ?? []).some((t) => t.toLocaleLowerCase('ru').includes(q)),
      );
      sections = [{ key: 'search', title: '', symbol: 'magnifyingglass', color: '#8B5CF6', items: found }];
    } else if (category !== ALL) {
      const cat = byId.get(category);
      sections = [
        { key: category, title: '', symbol: categorySymbol(cat?.icon), color: categoryHex(cat?.color), items: items.filter((i) => i.category === category) },
      ];
    } else {
      // «Все»: популярное, затем категории как в веб-кассе — обычные, «Прочее», тарифы.
      const top = items.filter((i) => i.isTop);
      const regular = categories.filter((c) => !isTariffCategory(c));
      const tariffs = categories.filter(isTariffCategory);
      const other = items.filter((i) => !i.category || !byId.has(i.category));
      const toSection = (c: MenuCategory): Section => ({
        key: c.id,
        title: c.name,
        symbol: categorySymbol(c.icon),
        color: categoryHex(c.color),
        items: items.filter((i) => i.category === c.id),
      });
      sections = [
        ...(top.length ? [{ key: TOP, title: 'Популярное', symbol: 'star.fill' as SFSymbol, color: '#F59E0B', items: top }] : []),
        ...regular.map(toSection),
        ...(other.length ? [{ key: OTHER, title: 'Прочее', symbol: 'square.grid.2x2' as SFSymbol, color: '#64748B', items: other }] : []),
        ...tariffs.map(toSection),
      ];
    }

    const result: Row[] = [];
    for (const section of sections) {
      if (section.items.length === 0) continue;
      if (section.title) result.push({ type: 'header', key: `h-${section.key}`, section });
      for (let i = 0; i < section.items.length; i += columns) {
        result.push({ type: 'row', key: `${section.key}-${i}`, items: section.items.slice(i, i + columns) });
      }
    }
    return result;
  }, [menu.data, query, category, categories, byId, columns]);

  const closed = check.data && check.data.status !== 'open';
  const total = check.data ? checkTotals(check.data, now).total : 0;

  const add = (item: MenuItem) => {
    if (closed) return;
    haptic.light();
    addItem(checkId, item.id).catch((error: Error) => {
      haptic.error();
      Alert.alert('Позиция не добавлена', error.message === 'Check not open' ? 'Чек уже закрыт.' : error.message);
    });
  };

  const selectCategory = (id: string) => {
    haptic.selection();
    setCategory(id);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.sheet} onLayout={(e) => setWidth(e.nativeEvent.layout.width - space.lg * 2)}>
      <View style={styles.top}>
        <View style={styles.titleRow}>
          <Text style={[type.title2, sheetStyles.label]}>Меню</Text>
          {check.data && (
            <GlassView style={styles.totalPill}>
              <Text style={[type.caption1, sheetStyles.secondary]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
                {closed ? 'чек закрыт' : 'в чеке'}
              </Text>
              <RollingText text={formatMoney(total)} style={[type.subhead, type.amount, styles.totalText]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact} />
            </GlassView>
          )}
          <View style={styles.flex} />
          <CircleButton icon="xmark" label="Закрыть" onPress={() => router.back()} />
        </View>

        {SEARCH_ON_TOP && <SearchField value={query} onChange={setQuery} />}

        {!query && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips}>
            <GlassChip label="Все" icon="square.grid.2x2" active={category === ALL} onPress={() => selectCategory(ALL)} />
            {categories.map((c) => (
              <GlassChip
                key={c.id}
                label={c.name}
                icon={categorySymbol(c.icon)}
                tint={categoryHex(c.color)}
                active={category === c.id}
                onPress={() => selectCategory(c.id)}
              />
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.flex}>
      <FlashList
        data={rows}
        keyExtractor={(row) => row.key}
        getItemType={(row) => row.type}
        contentContainerStyle={{ ...styles.listContent, paddingBottom: listBottom }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        renderItem={({ item: row }) =>
          row.type === 'header' ? (
            <View style={styles.sectionHeader}>
              <SymbolView name={row.section.symbol} size={14} weight="semibold" tintColor={row.section.color} />
              <Text style={[type.headline, sheetStyles.label]}>{row.section.title}</Text>
              <Text style={[type.subhead, sheetStyles.tertiary]}>{row.section.items.length}</Text>
            </View>
          ) : (
            <View style={styles.row}>
              {row.items.map((item) => {
                const cat = item.category ? byId.get(item.category) : undefined;
                return (
                  <MenuTile
                    key={item.id}
                    item={item}
                    color={categoryHex(cat?.color)}
                    symbol={categorySymbol(cat?.icon)}
                    inCheck={inCheck.get(item.id) ?? 0}
                    disabled={!!closed}
                    onPress={() => add(item)}
                  />
                );
              })}
              {Array.from({ length: columns - row.items.length }, (_, i) => (
                <View key={`filler-${i}`} style={styles.flex} />
              ))}
            </View>
          )
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <SymbolView name={menu.isLoading ? 'hourglass' : 'magnifyingglass'} size={28} tintColor={colors.tertiaryLabel} />
            <Text style={[type.subhead, sheetStyles.secondary]}>
              {menu.isLoading ? 'Загружаем меню…' : query ? 'Ничего не нашлось' : 'В этой категории пусто'}
            </Text>
          </View>
        }
      />

      {/* Поиск внизу, как в iOS 26: стеклянная капсула поверх сетки, плитки прокручиваются под ней. */}
      {!SEARCH_ON_TOP && (
        <View pointerEvents="box-none" style={[styles.floatingSearch, { bottom: searchBottom }]}>
          <SearchField value={query} onChange={setQuery} />
        </View>
      )}
      </View>
    </KeyboardAvoidingView>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  return (
    <GlassView style={styles.search}>
      <SymbolView name="magnifyingglass" size={16} weight="medium" tintColor={colors.secondaryLabel} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Позиция или тег"
        placeholderTextColor={colors.tertiaryLabel}
        selectionColor={colors.accent}
        style={[type.body, styles.searchInput]}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
        accessibilityLabel="Поиск по меню"
      />
      <ClearButton visible={value.length > 0} onPress={() => onChange('')} />
    </GlassView>
  );
}

function MenuTile({
  item,
  color,
  symbol,
  inCheck,
  disabled,
  onPress,
}: {
  item: MenuItem;
  color: string;
  symbol: SFSymbol;
  inCheck: number;
  disabled: boolean;
  onPress: () => void;
}) {
  const [bumps, setBumps] = useState(0);
  const stock = item.trackStock ? item.stockQuantity : null;

  return (
    <Pressable
      style={styles.flex}
      disabled={disabled}
      onPress={() => {
        setBumps((n) => n + 1);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${formatMoney(item.price)}${inCheck ? `, в чеке ${inCheck}` : ''}`}>
      <GlassView isInteractive tintColor={inCheck > 0 ? `${color}3D` : undefined} style={styles.tile}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.photo} contentFit="cover" transition={150} />
        ) : (
          <View style={[styles.tileIcon, { backgroundColor: `${color}2E` }]}>
            <SymbolView name={symbol} size={15} weight="semibold" tintColor={color} />
          </View>
        )}
        <Text style={[type.subhead, styles.tileName]} numberOfLines={2}>
          {item.name}
        </Text>
        <View style={styles.tileFooter}>
          <Text style={[type.headline, type.amount, sheetStyles.label]} numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(item.price)}
          </Text>
          {stock !== null && (
            <Text style={[type.caption1, stock <= 0 ? styles.stockOut : stock <= 3 ? styles.stockLow : sheetStyles.tertiary]}>
              {stock <= 0 ? 'нет' : `×${stock}`}
            </Text>
          )}
        </View>
        <InCheckBadge count={inCheck} color={color} />
        {bumps > 0 && (
          <Animated.Text key={bumps} entering={bumpUp} pointerEvents="none" style={[styles.bump, { color }]} {...textScaleProps(styles.bump, FONT_SCALE_MAX.compact)}>
            +1
          </Animated.Text>
        )}
      </GlassView>
    </Pressable>
  );
}

/** Счётчик «уже в чеке» цветом категории: подпрыгивает при каждом добавлении. */
function InCheckBadge({ count, color }: { count: number; color: string }) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (count > 0) scale.set(withSequence(withTiming(1.35, { duration: 90 }), withSpring(1, springs.bouncy)));
  }, [count, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  if (count <= 0) return null;
  return (
    <Animated.View style={[styles.badge, { backgroundColor: color }, style]}>
      <Text style={styles.badgeText} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {count}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  flex: { flex: 1 },
  top: { paddingHorizontal: space.lg, paddingTop: space.xl, gap: space.md, paddingBottom: space.sm },
  listContent: { paddingHorizontal: space.lg },
  floatingSearch: { position: 'absolute', left: space.lg, right: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  totalPill: { flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingVertical: 4, paddingHorizontal: space.md, borderRadius: 16 },
  totalText: { color: colors.label, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, height: SEARCH_HEIGHT, paddingHorizontal: space.lg, borderRadius: SEARCH_HEIGHT / 2 },
  searchInput: { flex: 1, color: colors.label, height: SEARCH_HEIGHT, paddingVertical: 0 },
  // Ряд категорий фиксированной высоты: горизонтальный ScrollView иначе может сжаться и наехать на соседей.
  chipsScroll: { flexGrow: 0, flexShrink: 0, height: 44, marginHorizontal: -space.lg },
  chips: { gap: space.sm, paddingHorizontal: space.lg, alignItems: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.md, paddingBottom: space.sm, paddingHorizontal: space.xs },
  row: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  tile: { minHeight: 122, padding: space.md, gap: 6, borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden' },
  tileIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 28, height: 28, borderRadius: 9 },
  tileName: { flex: 1, color: colors.label, fontWeight: '600' },
  tileFooter: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4 },
  stockLow: { color: colors.orange, fontWeight: '600' },
  stockOut: { color: colors.red, fontWeight: '600' },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    minWidth: 24,
    minHeight: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: 'white', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bump: { position: 'absolute', top: 38, left: 0, right: 0, textAlign: 'center', fontSize: 24, fontWeight: '800', fontFamily: 'ui-rounded' },
  empty: { alignItems: 'center', gap: space.sm, paddingTop: space.xxxl },
});
