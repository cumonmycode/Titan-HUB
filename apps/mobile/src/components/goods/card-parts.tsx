import { Chart } from '@expo/ui/swift-ui';
import { frame } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { IconPlate, LevelBar, MOVEMENT_LOOK } from '@/components/goods/parts';
import { Text } from '@/components/text';
import { formatMoney, plural } from '@/lib/format';
import { LEVEL_LOOK, daysLeft, formatQty, margin, stockLevel, unitPrice, type DaySeries, type GoodsItem, type GoodsMovement, itemQty } from '@/lib/goods-api';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type, useAccentHex } from '@/lib/theme';

/**
 * Части карточки позиции: шапка (цена и маржа позиции меню или остаток сырья), строка
 * журнала движений и график по дням. Рисуются внутри секций формы.
 */

const money = (n: number) => formatMoney(n, { kopecks: 'auto' });

/** Где позицию видят: касса, Titan Home, экран ТВ — галочкой или перечёркнутым глазом. */
function Place({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={styles.place}>
      <SymbolView name={on ? 'checkmark.circle.fill' : 'eye.slash'} size={14} tintColor={on ? colors.green : colors.tertiaryLabel} />
      <Text style={[type.footnote, on ? styles.label : styles.tertiary]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {label}
      </Text>
    </View>
  );
}

/** Шапка позиции меню: цена крупно, себестоимость и маржа, где продаётся. */
export function ItemHero({ item, categoryName }: { item: GoodsItem; categoryName: string | null }) {
  const m = margin(item.price, item.costPrice);
  const costNote =
    item.stockMode === 'recipe'
      ? 'по составу'
      : item.stockMode === 'pieces' && item.hasReceipts
        ? 'средняя по приходам'
        : item.costPrice > 0
          ? 'задана вручную'
          : 'не задана';
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.flex}>
          <Text style={[type.footnote, styles.secondary]}>
            {[categoryName ?? 'Без категории', item.isTop ? 'хит продаж' : null].filter(Boolean).join(' · ')}
          </Text>
          <Text style={[type.title1, type.amount, styles.label]} maxFontSizeMultiplier={FONT_SCALE_MAX.display}>
            {money(item.price)}
          </Text>
        </View>
        {m !== null ? (
          <View style={[styles.badge, { backgroundColor: m < 0 ? colors.red : colors.fill }]}>
            <Text
              style={[type.headline, type.amount, { color: m < 0 ? 'white' : colors.label }]}
              maxFontSizeMultiplier={FONT_SCALE_MAX.compact}
            >{`${m}%`}</Text>
            <Text style={[type.caption2, { color: m < 0 ? 'white' : colors.secondaryLabel }]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
              маржа
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[type.subhead, styles.secondary]}>{`Себестоимость ${item.costPrice > 0 ? money(item.costPrice) : '—'} · ${costNote}`}</Text>
      <View style={styles.places}>
        <Place label="Касса" on={item.isActive} />
        <Place label="Titan Home" on={item.isTabletVisible} />
        <Place label="Экран ТВ" on={item.isScreenVisible} />
      </View>
    </View>
  );
}

/** Шапка остатка (сырьё или штучный товар): количество крупно, на сумму, на сколько хватит. */
export function StockHero({ item }: { item: GoodsItem }) {
  const level = stockLevel(item);
  const look = LEVEL_LOOK[level];
  const days = daysLeft(item);
  const price = unitPrice(item.costPrice, item.unit, item.unitLabel);
  return (
    <View style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.flex}>
          <Text style={[type.footnote, { color: look.color }]}>{look.label}</Text>
          <Text style={[type.title1, type.amount, { color: level === 'ok' ? colors.label : look.color }]} maxFontSizeMultiplier={FONT_SCALE_MAX.display}>
            {itemQty(item, item.stockQuantity)}
          </Text>
        </View>
        {days !== null ? (
          <View style={[styles.badge, { backgroundColor: colors.fill }]}>
            <Text style={[type.headline, type.amount, styles.label]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
              {String(days)}
            </Text>
            <Text style={[type.caption2, styles.secondary]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
              {plural(days, ['день', 'дня', 'дней'])}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[type.subhead, styles.secondary]}>
        {[
          item.costPrice > 0 ? `${money(Math.max(0, item.stockQuantity) * item.costPrice)} на складе` : null,
          item.costPrice > 0 ? `${money(price.value)} ${price.label}` : 'себестоимость появится с первым приходом',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {item.reorderPoint || item.parLevel ? (
        <View style={styles.levelLine}>
          <LevelBar item={item} />
          <Text style={[type.footnote, styles.secondary]}>
            {[item.reorderPoint ? `заказ при ${itemQty(item, item.reorderPoint)}` : null, item.parLevel ? `до ${itemQty(item, item.parLevel)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const movementDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

/** Подпись движения без служебных id: «Продажа · Капучино», «Приход · Метро». */
function movementText(m: GoodsMovement): string {
  const look = MOVEMENT_LOOK[m.type];
  if (m.soldItemName) return `${look.label} · ${m.soldItemName}`;
  const reason = (m.reason ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '')
    .replace(/(Продажа|Приёмка|Возврат позиции|Отмена чека)[: ·]*(чек)?\s*$/i, '$1')
    .trim();
  if (!reason || reason === look.label) return look.label;
  if (reason.startsWith('Приёмка')) return reason.replace('Приёмка', 'Приход');
  return reason.startsWith(look.label) ? reason : `${look.label} · ${reason}`;
}

export function MovementLine({ movement: m, unit, label }: { movement: GoodsMovement; unit: GoodsItem['unit']; label?: GoodsItem['unitLabel'] }) {
  const look = MOVEMENT_LOOK[m.type];
  return (
    <View style={styles.movement}>
      <IconPlate symbol={look.symbol as SFSymbol} color={look.color} size={28} />
      <View style={styles.flex}>
        <Text style={[type.body, styles.label]} numberOfLines={2}>
          {movementText(m)}
        </Text>
        <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
          {[movementDate.format(new Date(m.createdAt)).replace('.', ''), m.author].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.trailing}>
        <Text
          style={[type.body, type.amount, { color: m.delta > 0 ? colors.green : colors.red }]}
        >{`${m.delta > 0 ? '+' : '−'}${formatQty(Math.abs(m.delta), unit, label)}`}</Text>
        <Text style={[type.footnote, styles.secondary]}>{`→ ${formatQty(m.qtyAfter, unit, label)}`}</Text>
      </View>
    </View>
  );
}

/** Столбики по дням за 30 дней (Swift Charts); ось — дней назад, 0 — сегодня. */
export function DaysChart({ series }: { series: DaySeries }) {
  const accent = useAccentHex();
  if (series.every((p) => p.qty === 0)) return null;
  return (
    <Chart
      type="bar"
      animate
      showGrid={false}
      data={series.map((point, index) => ({ x: index - (series.length - 1), y: point.qty, color: accent }))}
      barStyle={{ cornerRadius: 3 }}
      modifiers={[frame({ height: 140 })]}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.sm },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  badge: { minWidth: 64, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center' },
  places: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, paddingTop: 2 },
  place: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  levelLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: 2 },
  movement: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10, minHeight: 52 },
  trailing: { alignItems: 'flex-end', gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
});
