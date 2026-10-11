import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ColorValue } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text, TextInput } from '@/components/text';
import { formatMoney, plural } from '@/lib/format';
import {
  LEVEL_LOOK,
  daysLeft,
  itemQty,
  margin,
  packText,
  servings,
  stockLevel,
  type Catalog,
  type DocType,
  type GoodsDocument,
  type GoodsItem,
  type MovementType,
} from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX, useTextLayout } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/**
 * Строки раздела «Товары»: позиция меню, остаток, документ склада и строка состава
 * документа с полями количества. Рисуются внутри Section формы: отступы ячейки — свои,
 * как у строк «Настроек» (16 по краям, минимум 52 pt по высоте), текст растёт с системным.
 */

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });

/* ─────────────────────────── Справочники вида ─────────────────────────── */

export const MOVEMENT_LOOK: Record<MovementType, { label: string; symbol: SFSymbol; color: string }> = {
  receipt: { label: 'Приход', symbol: 'shippingbox.fill', color: '#10B981' },
  sale: { label: 'Продажа', symbol: 'cart.fill', color: '#3B82F6' },
  return: { label: 'Возврат', symbol: 'arrow.uturn.backward', color: '#06B6D4' },
  write_off: { label: 'Списание', symbol: 'trash.fill', color: '#F43F5E' },
  count: { label: 'Ревизия', symbol: 'checklist', color: '#F59E0B' },
  adjustment: { label: 'Корректировка', symbol: 'slider.horizontal.3', color: '#8B5CF6' },
  opening: { label: 'Начальный остаток', symbol: 'flag.fill', color: '#94A3B8' },
  transfer: { label: 'Перемещение', symbol: 'arrow.left.arrow.right', color: '#94A3B8' },
};

export const DOC_LOOK: Record<DocType, { label: string; symbol: SFSymbol; color: string }> = {
  supply: { label: 'Приход', symbol: 'shippingbox.fill', color: '#10B981' },
  write_off: { label: 'Списание', symbol: 'trash.fill', color: '#F43F5E' },
  revision: { label: 'Ревизия', symbol: 'checklist', color: '#F59E0B' },
};

export const positionsText = (n: number) => `${n} ${plural(n, ['позиция', 'позиции', 'позиций'])}`;

/* ─────────────────────────── Мелкие элементы ─────────────────────────── */

/** Цветная плашка со значком, как у пунктов «Настроек». */
export function IconPlate({ symbol, color, size = 30 }: { symbol: SFSymbol; color: ColorValue; size?: number }) {
  return (
    <View style={[styles.plate, { width: size, height: size, borderRadius: size * 0.27, backgroundColor: color }]}>
      <SymbolView name={symbol} size={size * 0.5} weight="semibold" tintColor="white" />
    </View>
  );
}

/** Полоска запаса: сколько осталось до целевого уровня (или двойной точки заказа). */
export function LevelBar({ item }: { item: Pick<GoodsItem, 'stockQuantity' | 'reorderPoint' | 'parLevel'> }) {
  const max = item.parLevel ?? (item.reorderPoint ? item.reorderPoint * 2 : 0);
  if (max <= 0) return null;
  const share = Math.max(0, Math.min(1, item.stockQuantity / max));
  const color = LEVEL_LOOK[stockLevel(item)].color;
  return (
    <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.fill, { flex: share, backgroundColor: color }]} />
      <View style={{ flex: 1 - share }} />
    </View>
  );
}

/** Нажимаемая строка секции с откликом касания. */
function RowButton({ onPress, children, label }: { onPress?: () => void; children: ReactNode; label: string }) {
  if (!onPress) return <View style={styles.row}>{children}</View>;
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

function Chevron() {
  return <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} />;
}

/* ─────────────────────────── Позиция меню ─────────────────────────── */

/** Что сказать про запас позиции меню: штуки, порции по составу или ничего. */
export function stockCaption(item: GoodsItem, catalog: Catalog): { text: string; color?: ColorValue } | null {
  if (item.stockMode === 'pieces') {
    const level = stockLevel(item);
    return { text: level === 'out' ? 'нет на складе' : itemQty(item, item.stockQuantity), color: level === 'ok' ? undefined : LEVEL_LOOK[level].color };
  }
  if (item.stockMode === 'recipe') {
    const s = servings(item, catalog.byId);
    if (!s) return { text: 'по составу' };
    if (s.count === 0) return { text: `не хватает: ${s.limitedBy?.name ?? 'состава'}`, color: LEVEL_LOOK.out.color };
    return { text: `≈ ${s.count} ${plural(s.count, ['порция', 'порции', 'порций'])}` };
  }
  return null;
}

/** Позиция меню: название (звёздочка у хита), запас и скрытость, справа цена и маржа. */
export function MenuRow({ item, catalog, onPress }: { item: GoodsItem; catalog: Catalog; onPress: () => void }) {
  const { stacked } = useTextLayout();
  const stock = stockCaption(item, catalog);
  const m = margin(item.price, item.costPrice);
  const notes = [!item.isActive ? 'скрыта из кассы' : null, item.role === 'rental' ? 'аренда' : null].filter(Boolean).join(' · ');
  return (
    <RowButton onPress={onPress} label={item.name}>
      <View style={styles.titles}>
        <View style={styles.nameLine}>
          {item.isTop ? <SymbolView name="star.fill" size={12} tintColor="#F59E0B" /> : null}
          <Text style={[type.body, item.isActive ? styles.label : styles.secondary, styles.shrink]} numberOfLines={stacked ? 3 : 1}>
            {item.name}
          </Text>
        </View>
        {stock || notes ? (
          <Text style={[type.footnote, styles.secondary]} numberOfLines={2}>
            {stock ? <Text style={stock.color ? { color: stock.color } : undefined}>{stock.text}</Text> : null}
            {stock && notes ? ' · ' : ''}
            {notes}
          </Text>
        ) : null}
      </View>
      <View style={styles.trailing}>
        <Text style={[type.body, styles.label, styles.amount]}>{money(item.price)}</Text>
        {m !== null ? <Text style={[type.caption1, m < 0 ? styles.red : styles.secondary]}>{`маржа ${m}%`}</Text> : null}
      </View>
      <Chevron />
    </RowButton>
  );
}

/* ─────────────────────────── Остаток ─────────────────────────── */

/** Остаток товара или сырья: количество цветом уровня, полоска запаса, на сколько хватит. */
export function StockRow({ item, usedIn, onPress }: { item: GoodsItem; usedIn?: number; onPress: () => void }) {
  const { stacked } = useTextLayout();
  const level = stockLevel(item);
  const look = LEVEL_LOOK[level];
  const days = daysLeft(item);
  const caption = [
    item.kind === 'ingredient' && usedIn ? `в ${usedIn} ${plural(usedIn, ['блюде', 'блюдах', 'блюдах'])}` : null,
    item.kind === 'ingredient' ? packText(item) : null,
    level !== 'out' && days !== null ? `хватит на ${days} ${plural(days, ['день', 'дня', 'дней'])}` : null,
    item.reorderPoint ? `заказ при ${itemQty(item, item.reorderPoint)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <RowButton onPress={onPress} label={`${item.name}, ${itemQty(item, item.stockQuantity)}`}>
      <View style={styles.titles}>
        <Text style={[type.body, styles.label]} numberOfLines={stacked ? 3 : 1}>
          {item.name}
        </Text>
        {caption ? (
          <Text style={[type.footnote, styles.secondary]} numberOfLines={2}>
            {caption}
          </Text>
        ) : null}
      </View>
      <View style={[styles.trailing, styles.stockTrailing]}>
        <Text style={[type.body, styles.amount, { color: level === 'ok' ? colors.label : look.color }]}>{itemQty(item, item.stockQuantity)}</Text>
        <LevelBar item={item} />
      </View>
      <Chevron />
    </RowButton>
  );
}

/* ─────────────────────────── Документ ─────────────────────────── */

const dayTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

export function docTitle(doc: Pick<GoodsDocument, 'type' | 'title'>): string {
  const label = DOC_LOOK[doc.type].label;
  return doc.title ? `${label} · ${doc.title}` : label;
}

/** Сумма документа: приход и списание — по себестоимости, ревизия — итог расхождений со знаком. */
export function docAmount(doc: Pick<GoodsDocument, 'type' | 'amount' | 'surplus' | 'shortage' | 'status'>): { text: string; color?: ColorValue } {
  if (doc.type !== 'revision') return { text: doc.amount > 0 ? money(doc.amount) : doc.status === 'draft' ? '' : '—' };
  if (doc.status === 'draft') return { text: '' };
  if (!doc.surplus && !doc.shortage) return { text: 'сходится', color: colors.green };
  return { text: formatMoney(doc.amount, { sign: true, kopecks: 'auto' }), color: doc.amount >= 0 ? colors.green : colors.red };
}

export function DocRow({ doc, onPress }: { doc: GoodsDocument; onPress: () => void }) {
  const look = DOC_LOOK[doc.type];
  const date = new Date(doc.updatedAt && doc.status === 'draft' ? doc.updatedAt : doc.createdAt);
  const amount = docAmount(doc);
  const caption = [
    positionsText(doc.positions),
    Number.isNaN(date.getTime()) ? null : dayTime.format(date).replace('.', ''),
    doc.author,
    doc.fromRegister ? 'из кассы' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <RowButton onPress={onPress} label={docTitle(doc)}>
      <IconPlate symbol={doc.status === 'draft' ? 'pencil' : look.symbol} color={doc.status === 'draft' ? colors.accent : look.color} />
      <View style={styles.titles}>
        <Text style={[type.body, styles.label]} numberOfLines={1}>
          {docTitle(doc)}
        </Text>
        <Text style={[type.footnote, styles.secondary]} numberOfLines={2}>
          {caption}
        </Text>
      </View>
      {amount.text ? <Text style={[type.body, styles.amount, { color: amount.color ?? colors.label }]}>{amount.text}</Text> : null}
      <Chevron />
    </RowButton>
  );
}

/* ─────────────────────────── Поля состава ─────────────────────────── */

/** Поле числа с единицей справа: «2 кг», «18 г», «× 1 850 ₽». */
export function NumberInput({
  value,
  onChange,
  suffix,
  placeholder = '0',
  integer,
  invalid,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  suffix: string;
  placeholder?: string;
  integer?: boolean;
  invalid?: boolean;
  label: string;
}) {
  return (
    <View style={[styles.input, invalid && styles.inputInvalid]}>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(integer ? text.replace(/[^\d]/g, '') : text.replace(/[^\d.,]/g, '').replace('.', ','))}
        placeholder={placeholder}
        placeholderTextColor={colors.tertiaryLabel}
        keyboardType={integer ? 'number-pad' : 'decimal-pad'}
        selectTextOnFocus
        maxLength={10}
        maxFontSizeMultiplier={FONT_SCALE_MAX.compact}
        accessibilityLabel={label}
        style={[type.body, styles.inputText]}
      />
      <Text style={[type.subhead, styles.secondary]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {suffix}
      </Text>
    </View>
  );
}

/**
 * Строка состава документа: название и подсказка сверху, под ними поля (количество, цена)
 * и сумма справа. Две строки вместо четырёх полей на позицию — состав прихода виден целиком.
 */
export function DocLineRow({
  title,
  caption,
  captionColor,
  fields,
  total,
}: {
  title: string;
  caption?: string;
  captionColor?: ColorValue;
  fields: ReactNode;
  total?: string;
}) {
  return (
    <View style={styles.lineRow}>
      <View style={styles.lineHead}>
        <Text style={[type.body, styles.label, styles.shrink]} numberOfLines={2}>
          {title}
        </Text>
        {total ? <Text style={[type.body, styles.label, styles.amount]}>{total}</Text> : null}
      </View>
      {caption ? (
        <Text style={[type.footnote, captionColor ? { color: captionColor } : styles.secondary]} numberOfLines={2}>
          {caption}
        </Text>
      ) : null}
      <View style={styles.fields}>{fields}</View>
    </View>
  );
}

export const goodsStyles = StyleSheet.create({
  secondary: { color: colors.secondaryLabel },
  label: { color: colors.label },
  amount: { fontVariant: ['tabular-nums'], fontWeight: '600' },
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10, minHeight: 52 },
  pressed: { backgroundColor: colors.fill },
  plate: { alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  shrink: { flexShrink: 1 },
  trailing: { alignItems: 'flex-end', gap: 2 },
  stockTrailing: { minWidth: 72 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  red: { color: colors.red },
  amount: { fontVariant: ['tabular-nums'], fontWeight: '600' },
  track: { flexDirection: 'row', width: 64, height: 4, borderRadius: 2, backgroundColor: colors.fill, overflow: 'hidden' },
  fill: { borderRadius: 2 },
  input: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: colors.fill,
    flexGrow: 1,
    flexBasis: 110,
  },
  inputInvalid: { borderWidth: 1, borderColor: colors.red },
  inputText: { flex: 1, color: colors.label, paddingVertical: 8, fontVariant: ['tabular-nums'] },
  lineRow: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: 6 },
  lineHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, justifyContent: 'space-between' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: 2 },
});
