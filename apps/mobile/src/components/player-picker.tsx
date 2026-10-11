import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Text, TextInput } from '@/components/text';
import { GlassView } from '@/components/glass';
import { ClearButton } from '@/components/clear-button';
import { Avatar, BalanceChips, GlassCard, sheetStyles } from '@/components/new-check-parts';
import { useAutoFocus } from '@/lib/auto-focus';
import { formatMoney } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { preselectTariff, sortTariffs, TIER_LABEL, usePlayerSearch, useTariffs, type PlayerSearchItem, type Tariff } from '@/lib/pos-api';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/** Поиск игрока и выбор тарифа — общие для «Нового чека» и смены клиента в открытом чеке. */

const RESULT_ROW_HEIGHT = 60;
/** Палитра веб-кассы для тарифов без своего цвета. */
const PALETTE = ['#8B5CF6', '#10B981', '#F59E0B', '#3B82F6', '#F43F5E', '#06B6D4'];

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Поле поиска с фокусом при появлении и список найденных игроков под ним. */
export function PlayerSearch({
  query,
  onQuery,
  onPlayer,
  onCreate,
  excludeId,
  excludeIds,
}: {
  query: string;
  onQuery: (q: string) => void;
  onPlayer: (player: PlayerSearchItem) => void;
  /** Если задан — при пустом результате предлагаем создать клиента с этим ником. */
  onCreate?: (nickname: string) => void;
  /** Игрок, которого не показываем (уже плательщик чека). */
  excludeId?: string | null;
  /** Игроки, которых не показываем (уже в составе). */
  excludeIds?: string[];
}) {
  const trimmed = query.trim();
  const debounced = useDebounced(trimmed, 250);
  const search = usePlayerSearch(debounced);
  const players = (search.data ?? []).filter((p) => p.id !== excludeId && !excludeIds?.includes(p.id));
  const typing = trimmed.length > 0;
  const waiting = typing && (debounced !== trimmed || search.isLoading);
  const focus = useAutoFocus();

  return (
    // column-reverse: поле поиска внизу блока, у клавиатуры, результаты растут вверх —
    // как системный поиск в нижнем тулбаре iOS 26.
    <View style={styles.searchBlock}>
      <GlassView style={styles.searchField}>
        <SymbolView name="magnifyingglass" size={16} weight="medium" tintColor={colors.secondaryLabel} />
        <TextInput
          {...focus}
          value={query}
          onChangeText={onQuery}
          placeholder="Ник, имя или @telegram"
          placeholderTextColor={colors.tertiaryLabel}
          selectionColor={colors.accent}
          style={[type.body, styles.searchInput]}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Поиск игрока"
        />
        <ClearButton visible={query.length > 0} onPress={() => onQuery('')} />
      </GlassView>

      {typing && (
        <Animated.View entering={FadeIn.duration(150)}>
          <GlassCard>
          {players.length === 0 ? (
            waiting ? (
              <View style={styles.resultState}>
                <ActivityIndicator />
                <Text style={[type.subhead, sheetStyles.secondary]}>Ищем…</Text>
              </View>
            ) : onCreate ? (
              <Pressable
                style={({ pressed }) => [styles.resultState, pressed && sheetStyles.pressedRow]}
                onPress={() => onCreate(trimmed)}
                accessibilityRole="button">
                <SymbolView name="person.badge.plus" size={18} tintColor={colors.accent} />
                <Text style={[type.subhead, styles.createText]} numberOfLines={1}>
                  {search.isError ? 'Поиск не удался — создать клиента' : `Не нашли. Создать «${trimmed}»`}
                </Text>
              </Pressable>
            ) : (
              <View style={styles.resultState}>
                <Text style={[type.subhead, sheetStyles.secondary]}>{search.isError ? 'Поиск не удался' : 'Никого не нашли'}</Text>
              </View>
            )
          ) : (
            <ScrollView style={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {players.map((player, index) => (
                <View key={player.id}>
                  {index > 0 && <View style={[sheetStyles.separator, styles.resultSeparator]} />}
                  <Pressable
                    style={({ pressed }) => [styles.resultRow, pressed && sheetStyles.pressedRow]}
                    onPress={() => onPlayer(player)}
                    accessibilityRole="button"
                    accessibilityLabel={player.nickname}>
                    <Avatar name={player.nickname} photoUrl={player.photoUrl} size={40} />
                    <View style={styles.flex}>
                      <Text style={[type.body, styles.playerName]} numberOfLines={1}>
                        {player.nickname}
                      </Text>
                      <Text style={[type.footnote, sheetStyles.secondary]} numberOfLines={1}>
                        {TIER_LABEL[player.clientTier] ?? player.clientTier}
                      </Text>
                    </View>
                    <BalanceChips balance={player.balance} bonusPoints={player.bonusPoints} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
          </GlassCard>
        </Animated.View>
      )}
    </View>
  );
}

/** Карточка выбранного игрока: аватар, ник, статус, депозит и бонусы. */
export function PlayerCard({
  player,
  caption,
}: {
  player: Pick<PlayerSearchItem, 'nickname' | 'clientTier' | 'balance' | 'bonusPoints' | 'photoUrl'>;
  caption?: string;
}) {
  return (
    <GlassCard style={styles.playerCard}>
      <Avatar name={player.nickname} photoUrl={player.photoUrl} size={44} />
      <View style={styles.flex}>
        <Text style={[type.headline, sheetStyles.label]} numberOfLines={1}>
          {player.nickname}
        </Text>
        <Text style={[type.subhead, sheetStyles.secondary]} numberOfLines={1}>
          {caption ?? TIER_LABEL[player.clientTier] ?? player.clientTier}
        </Text>
      </View>
      <BalanceChips balance={player.balance} bonusPoints={player.bonusPoints} />
    </GlassCard>
  );
}

/** Выбор тарифа: предвыбор по статусу игрока, как в веб-кассе; повторное нажатие снимает выбор. */
export function useTariffChoice(clientTier: string) {
  const tariffs = useTariffs();
  const list = sortTariffs(tariffs.data ?? []);
  /** undefined — кассир ещё не выбирал (действует предвыбор); null — «Без тарифа». */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const selectedId = picked !== undefined ? picked : tariffs.data ? preselectTariff(tariffs.data, clientTier) : undefined;

  return {
    list,
    isLoading: tariffs.isLoading,
    selectedId,
    /** Тариф к добавлению; null — без тарифа. */
    selectedTariff: list.find((t) => t.id === selectedId) ?? null,
    ready: selectedId !== undefined,
    choose: (id: string | null) => {
      haptic.selection();
      setPicked(selectedId === id ? null : id);
    },
  };
}

function tariffColor(tariff: Tariff, index: number): string {
  return /^#[0-9a-f]{6}$/i.test(tariff.color ?? '') ? tariff.color : PALETTE[index % PALETTE.length]!;
}

type Cell = { kind: 'tariff'; tariff: Tariff; color: string } | { kind: 'none' };

/**
 * Раскладка сетки — подряд: первый ряд из трёх, дальше по два, «Без тарифа» последней
 * плиткой. С порядком sortTariffs это:
 *   Резидент | Новичок | Гость
 *   Студент | Друзья клуба
 *   Одна игра | Без тарифа
 */
function tariffRows(list: Tariff[]): Cell[][] {
  const cells: Cell[] = [...list.map((tariff, index): Cell => ({ kind: 'tariff', tariff, color: tariffColor(tariff, index) })), { kind: 'none' }];
  const rows: Cell[][] = [cells.slice(0, 3)];
  for (let i = 3; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  return rows;
}

/** Название тарифа в плитке: в одну строку, на узкой плитке ужимается, а не режется до «Рези…». */
const TILE_NAME_FIT = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.75, maxFontSizeMultiplier: FONT_SCALE_MAX.compact } as const;

export function TariffGrid({
  choice,
  noTariffCaption = 'Открыть счёт без добавления позиции',
}: {
  choice: ReturnType<typeof useTariffChoice>;
  noTariffCaption?: string;
}) {
  if (choice.isLoading) return <ActivityIndicator style={styles.loading} />;

  const rows = tariffRows(choice.list);

  return (
    <View style={styles.grid}>
      {rows.map((row, r) => (
        <View key={row.map((cell) => (cell.kind === 'tariff' ? cell.tariff.id : 'none')).join()} style={styles.gridRow}>
          {row.map((cell) => {
            if (cell.kind === 'none') {
              const isSelected = choice.selectedId === null;
              return (
                <Pressable
                  key="none"
                  onPress={() => choice.choose(null)}
                  style={styles.flex}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel="Без тарифа"
                  accessibilityHint={noTariffCaption}>
                  <GlassView isInteractive tintColor={isSelected ? 'rgba(142,142,147,0.35)' : undefined} style={styles.tariffTile}>
                    <Text style={[type.subhead, styles.tariffName]} {...TILE_NAME_FIT}>
                      Без тарифа
                    </Text>
                    <Text style={[type.caption2, sheetStyles.secondary, styles.noTariffCaption]} numberOfLines={2}>
                      {noTariffCaption}
                    </Text>
                    {isSelected && (
                      <View style={styles.tileCheck}>
                        <SymbolView name="checkmark.circle.fill" size={16} tintColor={colors.secondaryLabel} />
                      </View>
                    )}
                  </GlassView>
                </Pressable>
              );
            }
            const { tariff, color } = cell;
            const isSelected = choice.selectedId === tariff.id;
            return (
              <Pressable
                key={tariff.id}
                onPress={() => choice.choose(tariff.id)}
                style={styles.flex}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${tariff.name}, ${formatMoney(tariff.price)}`}>
                <GlassView isInteractive tintColor={isSelected ? `${color}59` : undefined} style={styles.tariffTile}>
                  <Text style={[type.subhead, styles.tariffName]} {...TILE_NAME_FIT}>
                    {tariff.name}
                  </Text>
                  <Text
                    style={[type.headline, type.amount, isSelected ? styles.label : { color }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
                    {formatMoney(tariff.price)}
                  </Text>
                  {isSelected && (
                    <View style={styles.tileCheck}>
                      <SymbolView name="checkmark.circle.fill" size={16} tintColor={color} />
                    </View>
                  )}
                </GlassView>
              </Pressable>
            );
          })}
          {r > 0 && row.length === 1 && <View style={styles.flex} />}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { paddingVertical: space.xxl },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },

  label: { color: colors.label },
  searchBlock: { flexDirection: 'column-reverse', gap: space.md },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 46,
    paddingHorizontal: space.lg,
    borderRadius: 23,
  },
  searchInput: { flex: 1, color: colors.label, minHeight: 44 },
  resultState: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 52 },
  createText: { flex: 1, color: colors.accent, fontWeight: '600' },
  // Высоты строк — минимальные: с крупным текстом строки растут, а не обрезают ник и баланс.
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: RESULT_ROW_HEIGHT },
  resultSeparator: { marginLeft: 64 },
  // В шторке «по содержимому» ScrollView не должен сжиматься: его высота входит в высоту шторки.
  results: { maxHeight: RESULT_ROW_HEIGHT * 3.5, flexShrink: 0 },
  playerName: { color: colors.label, fontWeight: '600' },

  playerCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  grid: { gap: 10 },
  gridRow: { flexDirection: 'row', gap: 10 },
  tariffTile: {
    minHeight: 70,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: space.sm,
    paddingVertical: 10,
    borderRadius: 20,
    borderCurve: 'continuous',
  },
  tariffName: { color: colors.label, fontWeight: '600' },
  tileCheck: { position: 'absolute', top: 6, right: 6 },
  noTariffCaption: { textAlign: 'center' },
});
