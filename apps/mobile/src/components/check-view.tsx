import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View, type ScrollViewProps } from 'react-native';
import Animated, { FadeIn, FadeOut, LayoutAnimationConfig, LinearTransition } from 'react-native-reanimated';
import type { SFSymbol } from 'sf-symbols-typescript';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { Avatar, BalanceChips } from '@/components/new-check-parts';
import { RollingText } from '@/components/rolling-text';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { TaiGlass } from '@/components/tai/aura';
import { TaiMark } from '@/components/tai/mark';
import type { CheckTotals } from '@/lib/checks';
import { promptText } from '@/lib/dialog';
import { eventErrorMessage, eventTitle, updateEvent, useEvent, useEventRates } from '@/lib/events-api';
import { formatDuration, formatMoney, formatTime, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { PosPlayer } from '@/lib/payment';
import { categoryHex, categorySymbol } from '@/lib/catalog-api';
import { addItem, reloadCheck, setCheckNote, TIER_LABEL, useCheckSuggestions, useMenu, usePopularItems } from '@/lib/pos-api';
import { parseAmount } from '@/lib/shift-api';
import { FONT_SCALE_MAX, useTextLayout } from '@/lib/text-scale';
import { colors, radius, space, type } from '@/lib/theme';
import type { CheckDetail } from '@/lib/types';
import type { CheckActions } from '@/lib/use-check-actions';
import { useNow } from '@/lib/use-now';

/**
 * Открытый чек в стиле Liquid Glass: сумма крупно на фирменном фоне, дальше стеклянные
 * карточки — клиент, заказ из кабинки, позиции, подсказки Tai, скидки, аренда. Общий для
 * экрана чека на iPhone и правой панели на iPad. Цифры сменяются «прокруткой», строки
 * появляются и уходят анимацией, позиции и скидки снимаются свайпом.
 *
 * У каждого действия одно место: позиции добавляются кнопкой внизу (плашка над таб-баром,
 * на iPad — панель под чеком), скидка и отмена чека — в меню «…», клиенты — тапом по
 * карточке клиента. Сумма к оплате — только крупно сверху и на кнопке оплаты; пустые
 * карточки (скидок нет) не показываются.
 */

const NOTE_MAX = 500;
const rowLayout = LinearTransition.springify().damping(22).stiffness(220);
const ORDER_TINT = 'rgba(255,149,0,0.20)';

type Props = {
  check: CheckDetail;
  totals: CheckTotals;
  actions: CheckActions;
  player?: PosPlayer | null;
  now: number;
} & Pick<ScrollViewProps, 'contentInsetAdjustmentBehavior' | 'contentContainerStyle'>;

export function CheckView({ check, totals, actions, player, now, contentInsetAdjustmentBehavior, contentContainerStyle }: Props) {
  // «Увеличенный» вид и крупный текст: подпись «участник» под именем, а не рядом с ним.
  const guestTwoLines = useTextLayout().layout !== 'regular';
  const isOpen = check.status === 'open';
  const itemRows = check.items.filter((row) => row.checkItem.quantity > 0);
  const guests = check.guestNames ?? [];
  // Списание на персонал: сервер закрывает чек за 0 ₽ (аренда, база и предоплата не берутся,
  // как payTotals) — иначе сверху «тикала» бы живая аренда как долг гостя.
  const due = check.staffCompId ? 0 : totals.due;
  const prepaid = check.staffCompId ? 0 : totals.prepaid;
  const hasRental = !!(check.spaceId && check.spaceStartAt);
  // Значок позиции — иконка и цвет её категории, как на плитках меню (меню уже в кэше).
  const menu = useMenu();
  // Заранее: шторка «Добавить» откроется уже с блоком «Популярное».
  usePopularItems(isOpen ? check.id : '', check.playerId ?? null);
  const categories = new Map((menu.data?.categories ?? []).map((c) => [c.id, c]));
  const itemCategory = new Map((menu.data?.items ?? []).map((i) => [i.id, i.category]));
  const iconFor = (row: CheckDetail['items'][number]): RowIconLook => {
    if (row.checkItem.customName) return CUSTOM_ICON;
    const itemId = row.checkItem.itemId;
    const cat = categories.get(itemCategory.get(itemId) ?? '');
    return { symbol: categorySymbol(cat?.icon), color: categoryHex(cat?.color) };
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      showsVerticalScrollIndicator={false}>
      {/* При открытии чек появляется целиком; анимации — только на изменения. */}
      <LayoutAnimationConfig skipEntering skipExiting>
        {/* Сумма крупно, под ней — капсулы со значками вместо строки «Открыт в 19:40 · 2 ч 05 мин». */}
        <View style={styles.hero}>
          {!isOpen ? <Text style={[type.footnote, styles.heroCaption, check.status === 'closed' && styles.green]}>{check.status === 'closed' ? 'ОПЛАЧЕН' : 'ОТМЕНЁН'}</Text> : null}
          <RollingText text={formatMoney(due)} style={[styles.heroAmount, type.amount]} maxFontSizeMultiplier={FONT_SCALE_MAX.display} />
          <View style={styles.capsules}>
            {isOpen ? <Capsule icon="timer" text={formatDuration(check.createdAt, now)} strong /> : null}
            <Capsule text={`с ${formatTime(check.createdAt)}`} />
            {prepaid > 0 ? <Capsule text={`предоплата ${formatMoney(-prepaid)}`} /> : null}
          </View>
          {check.staffCompId && <Pill icon="person.badge.shield.checkmark" text="Списание на персонал — гостю бесплатно" color={colors.indigo} />}
        </View>

        {(isOpen || check.playerId) && (
          <Pressable onPress={actions.onOpenPlayer} disabled={!isOpen} accessibilityRole="button" accessibilityLabel="Клиенты чека">
            <GlassView isInteractive={isOpen} style={styles.card}>
              <View style={styles.clientRow}>
                {check.playerId ? (
                  <Avatar name={player?.nickname ?? '··'} photoUrl={player?.photoUrl} size={44} />
                ) : (
                  <View style={styles.addClientIcon}>
                    <SymbolView name="person.crop.circle.badge.plus" size={24} tintColor={colors.accent} />
                  </View>
                )}
                {check.playerId ? (
                  // Статус — меткой рядом с именем, а не отдельной серой строкой под ним.
                  <View style={[styles.flex, styles.nameRow]}>
                    <Text style={[type.headline, styles.label, styles.shrink]} numberOfLines={1}>
                      {player?.nickname ?? 'Клиент'}
                    </Text>
                    {player ? (
                      <View style={styles.tierPill}>
                        <Text style={[type.caption2, styles.tierText]} numberOfLines={1}>
                          {(TIER_LABEL[player.clientTier] ?? player.clientTier).toUpperCase()}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.flex}>
                    <Text style={[type.headline, styles.label]} numberOfLines={1}>
                      Добавить клиента
                    </Text>
                    <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
                      Бонусы, депозит и долг — только с клиентом
                    </Text>
                  </View>
                )}
                {player && <BalanceChips balance={player.balance} bonusPoints={player.bonusPoints} />}
                {isOpen && <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} />}
              </View>

              {guests.map((name) => (
                <Animated.View key={name} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
                  <View style={styles.divider} />
                  <View style={styles.guestRow}>
                    <View style={styles.guestIcon}>
                      <SymbolView name="person.fill" size={13} tintColor={colors.secondaryLabel} />
                    </View>
                    <View style={[styles.flex, !guestTwoLines && styles.guestTexts]}>
                      <Text style={[type.body, styles.label, !guestTwoLines && styles.flex]} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={[type.footnote, styles.tertiary]}>участник</Text>
                    </View>
                    {isOpen && (
                      <Pressable hitSlop={10} onPress={() => actions.onRemoveGuest(name)} accessibilityRole="button" accessibilityLabel={`Убрать ${name}`}>
                        <SymbolView name="xmark.circle.fill" size={20} tintColor={colors.tertiaryLabel} />
                      </Pressable>
                    )}
                  </View>
                </Animated.View>
              ))}
            </GlassView>
          </Pressable>
        )}

        {isOpen &&
          check.pendingOrders.map((order) => {
            const orderTotal = order.items.reduce((sum, item) => sum + toNumber(item.price) * item.quantity, 0);
            const busy = actions.busyOrderId === order.id;
            return (
              <Animated.View key={order.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
                <GlassView tintColor={ORDER_TINT} style={styles.card}>
                  <CardHeader icon="bell.badge.fill" iconColor={colors.orange} title="Заказ из кабинки" detail={formatTime(order.createdAt)} />
                  {order.items.map((item, i) => (
                    <View key={`${order.id}-${i}`} style={styles.lineRow}>
                      <Text style={[type.body, styles.label, styles.flex]} numberOfLines={1}>
                        {item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name}
                      </Text>
                      <Text style={[type.body, type.amount, styles.label]}>{formatMoney(toNumber(item.price) * item.quantity)}</Text>
                    </View>
                  ))}
                  <View style={styles.divider} />
                  <View style={styles.lineRow}>
                    <Text style={[type.subhead, styles.secondary, styles.flex]}>Итого по заказу</Text>
                    <Text style={[type.headline, type.amount, styles.label]}>{formatMoney(orderTotal)}</Text>
                  </View>
                  <View style={styles.orderButtons}>
                    <Pressable
                      disabled={busy}
                      onPress={() => actions.onRejectOrder(order.id)}
                      style={({ pressed }) => [styles.orderButton, styles.rejectButton, pressed && styles.pressed]}
                      accessibilityRole="button">
                      <Text style={[type.headline, styles.rejectText]}>Отклонить</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={() => actions.onConfirmOrder(order.id)}
                      style={({ pressed }) => [styles.orderButton, styles.confirmButton, pressed && styles.pressed]}
                      accessibilityRole="button">
                      {busy ? <ActivityIndicator color="white" /> : <SymbolView name="checkmark" size={15} weight="bold" tintColor="white" />}
                      <Text style={[type.headline, styles.confirmText]}>Подтвердить</Text>
                    </Pressable>
                  </View>
                </GlassView>
              </Animated.View>
            );
          })}

        {/* Счёт — одной карточкой в порядке денег: аренда, позиции, скидки. Итога внутри нет:
            он один — крупно сверху. Раньше аренда и скидки были отдельными карточками, аренда — в самом низу. */}
        <GlassView style={[styles.card, styles.billCard]}>
          {hasRental ? <RentalRow check={check} amount={totals.rental} isOpen={isOpen} onEdit={actions.onEditRental} /> : null}
          {itemRows.length === 0 && !hasRental ? (
            <Text style={[type.subhead, styles.secondary, styles.empty]}>{isOpen ? 'Чек пуст — нажмите «Добавить» внизу' : 'Позиций нет'}</Text>
          ) : (
            itemRows.map((row, index) => (
              <Animated.View key={row.checkItem.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
                {index > 0 || hasRental ? <View style={[styles.divider, styles.billDivider]} /> : null}
                <ItemRow
                  name={row.item?.name ?? '—'}
                  checkItemId={row.checkItem.id}
                  quantity={row.checkItem.quantity}
                  price={toNumber(row.checkItem.priceAtTime)}
                  isOpen={isOpen}
                  icon={iconFor(row)}
                  onQuantity={actions.onQuantity}
                />
              </Animated.View>
            ))
          )}
          {check.discounts.map((d) => (
            <Animated.View key={d.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
              <View style={[styles.divider, styles.billDivider]} />
              <SwipeToDelete enabled={isOpen} label="Снять" onDelete={() => actions.onRemoveDiscount(d.id)}>
                <View style={styles.billRow}>
                  <RowIcon symbol="tag" color={GREEN_HEX} />
                  <View style={styles.flex}>
                    <Text style={[type.body, styles.label]} numberOfLines={1}>
                      {d.name}
                    </Text>
                    {d.discountId ? <Text style={[type.footnote, styles.secondary]}>автоматическая</Text> : null}
                  </View>
                  <Text style={[type.body, type.amount, styles.green, styles.itemSum]}>{formatMoney(-toNumber(d.amount))}</Text>
                </View>
              </SwipeToDelete>
            </Animated.View>
          ))}
        </GlassView>

        {(isOpen || check.note) && <NoteCard checkId={check.id} note={check.note} isOpen={isOpen} />}

        {isOpen && check.playerId && <TaiSuggestions checkId={check.id} itemIds={new Set(itemRows.map((row) => row.checkItem.itemId))} />}

        {check.linkedEventId && <LinkedEventCard check={check} isOpen={isOpen} base={totals.eventBase} />}

      </LayoutAnimationConfig>
    </ScrollView>
  );
}

/* ─────────────────────────── Подписи и строки счёта ─────────────────────────── */

type RowIconLook = { symbol: SFSymbol; color: string };
/** Значкам нужен hex: к нему добавляется прозрачность подложки, а системные цвета iOS — не строки. */
const GREEN_HEX = '#34C759';
const PURPLE_HEX = '#AF52DE';
const GRAY_HEX = '#8E8E93';
/** Свободная позиция «Другое» — своим значком, у неё нет категории меню. */
const CUSTOM_ICON: RowIconLook = { symbol: 'square.and.pencil', color: GRAY_HEX };

/** Капсула под суммой: сколько идёт чек, с какого времени, предоплата. */
function Capsule({ icon, text, strong }: { icon?: SFSymbol; text: string; strong?: boolean }) {
  return (
    <View style={styles.capsule}>
      {icon ? <SymbolView name={icon} size={13} weight="semibold" tintColor={colors.accent} /> : null}
      <Text style={[type.subhead, type.amount, strong ? styles.capsuleStrong : styles.secondary]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
        {text}
      </Text>
    </View>
  );
}

/** Значок типа строки счёта: зона, категория позиции, скидка. */
function RowIcon({ symbol, color }: RowIconLook) {
  return (
    <View style={[styles.rowIcon, { backgroundColor: `${color}29` }]}>
      <SymbolView name={symbol} size={15} weight="semibold" tintColor={color} />
    </View>
  );
}

/** Аренда — первой строкой счёта: живая точка вместо «идёт», время меняется кнопкой-часами. */
function RentalRow({ check, amount, isOpen, onEdit }: { check: CheckDetail; amount: number; isOpen: boolean; onEdit: () => void }) {
  const live = !check.spaceEndAt;
  const now = useNow(30_000);
  const minutes = Math.max(0, Math.floor(((check.spaceEndAt ? Date.parse(check.spaceEndAt) : now) - Date.parse(check.spaceStartAt!)) / 60_000));
  const hours = Math.ceil(minutes / 60);
  const rate = check.spaceHourlyRate ? `${formatMoney(check.spaceHourlyRate)}/ч` : null;
  return (
    <View style={styles.billRow}>
      <RowIcon symbol="house" color={GREEN_HEX} />
      <View style={styles.flex}>
        <Text style={[type.body, styles.label]} numberOfLines={1}>
          {check.spaceName ? `Аренда · ${check.spaceName}` : 'Аренда'}
        </Text>
        <View style={styles.rentalMeta}>
          {live ? <View style={styles.liveDot} /> : null}
          <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
            {[`${hours} ч`, rate].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </View>
      {isOpen ? (
        <Pressable onPress={onEdit} hitSlop={8} style={({ pressed }) => [styles.clockButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Изменить время аренды">
          <SymbolView name="clock" size={14} weight="semibold" tintColor={colors.accent} />
        </Pressable>
      ) : null}
      <RollingText text={formatMoney(amount)} style={[type.body, type.amount, styles.label, styles.itemSum]} />
    </View>
  );
}

/* ─────────────────────────── Строка позиции ─────────────────────────── */

function ItemRow({
  name,
  checkItemId,
  quantity,
  price,
  isOpen,
  icon,
  onQuantity,
}: {
  name: string;
  checkItemId: string;
  quantity: number;
  price: number;
  isOpen: boolean;
  icon: RowIconLook;
  onQuantity: CheckActions['onQuantity'];
}) {
  // Количество меняется сразу, сервер подтверждает следом; быстрые нажатия не прыгают назад.
  const [pending, setPending] = useState<number | null>(null);
  const inflight = useRef(0);
  const qty = pending ?? quantity;

  const change = (next: number) => {
    const value = Math.max(0, next);
    haptic.selection();
    setPending(value);
    inflight.current += 1;
    void onQuantity(checkItemId, value).finally(() => {
      inflight.current -= 1;
      if (inflight.current === 0) setPending(null);
    });
  };

  // Одна строка: название, степпер, сумма. Цена за штуку — только когда штук больше одной
  // (иначе она совпадает с суммой); в закрытом чеке степпера нет — там «× N».
  // «Увеличенный» вид и крупный текст: степпер и сумма — строкой ниже, иначе название
  // сжималось до «Чай облепи…».
  const stacked = useTextLayout().layout !== 'regular';
  return (
    <SwipeToDelete enabled={isOpen} label="Удалить" onDelete={() => change(0)}>
      <View style={[styles.itemRow, stacked && styles.itemRowStacked, qty === 0 && styles.removing]}>
        {!stacked ? <RowIcon symbol={icon.symbol} color={icon.color} /> : null}
        <View style={[styles.flex, stacked && styles.itemNameStacked]}>
          <Text style={[type.body, styles.label]} numberOfLines={2}>
            {name}
          </Text>
          {/* «× 360 ₽» вместо «360 ₽ за шт.»; при одной штуке подписи нет — цена справа. */}
          {qty > 1 && <RollingText text={isOpen ? `× ${formatMoney(price)}` : `${qty} × ${formatMoney(price)}`} style={[type.footnote, styles.secondary]} />}
        </View>
        {isOpen && (
          <View style={styles.stepper}>
            <Pressable
              hitSlop={6}
              onPress={() => change(qty - 1)}
              style={({ pressed }) => [styles.stepperButton, pressed && styles.stepperPressed]}
              accessibilityRole="button"
              accessibilityLabel={qty <= 1 ? `Удалить ${name}` : `Меньше: ${name}`}>
              <SymbolView name={qty <= 1 ? 'trash' : 'minus'} size={13} weight="semibold" tintColor={qty <= 1 ? colors.red : colors.label} />
            </Pressable>
            <RollingText text={String(qty)} style={[type.subhead, styles.stepperValue]} maxFontSizeMultiplier={FONT_SCALE_MAX.compact} />
            <Pressable
              hitSlop={6}
              onPress={() => change(qty + 1)}
              style={({ pressed }) => [styles.stepperButton, pressed && styles.stepperPressed]}
              accessibilityRole="button"
              accessibilityLabel={`Больше: ${name}`}>
              <SymbolView name="plus" size={13} weight="semibold" tintColor={colors.label} />
            </Pressable>
          </View>
        )}
        <RollingText text={formatMoney(price * qty)} style={[type.body, type.amount, styles.label, styles.itemSum, stacked && styles.itemSumStacked]} />
      </View>
    </SwipeToDelete>
  );
}

/* ─────────────────────────── Комментарий ─────────────────────────── */

/**
 * Комментарий к чеку — одной строкой под счётом: тап открывает ввод. В закрытом чеке
 * виден только текст. Пустой открытый чек показывает приглашение «Добавить комментарий».
 */
function NoteCard({ checkId, note, isOpen }: { checkId: string; note: string | null; isOpen: boolean }) {
  const [saving, setSaving] = useState(false);
  const text = note?.trim() ?? '';

  const edit = () => {
    haptic.light();
    promptText(
      'Комментарий к чеку',
      undefined,
      [
        { text: 'Отмена', style: 'cancel' },
        ...(text ? [{ text: 'Удалить', style: 'destructive' as const, onPress: () => save('') }] : []),
        { text: 'Сохранить', onPress: (value?: string) => save(value ?? '') },
      ],
      'plain-text',
      text,
    );
  };

  const save = (value: string) => {
    const next = value.trim().slice(0, NOTE_MAX);
    if (next === text) return;
    setSaving(true);
    setCheckNote(checkId, next)
      .then(() => haptic.success())
      .catch((error: Error) => {
        haptic.error();
        Alert.alert('Комментарий не сохранён', error.message === 'Чек уже закрыт' ? 'Чек уже закрыт.' : error.message);
      })
      .finally(() => setSaving(false));
  };

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
      <Pressable onPress={edit} disabled={!isOpen || saving} accessibilityRole="button" accessibilityLabel={text ? `Комментарий: ${text}` : 'Добавить комментарий'}>
        <GlassView isInteractive={isOpen} style={styles.card}>
          <View style={styles.billRow}>
            <RowIcon symbol="text.bubble" color={GRAY_HEX} />
            <Text style={[type.body, text ? styles.label : styles.secondary, styles.flex]} numberOfLines={4}>
              {text || 'Добавить комментарий'}
            </Text>
            {saving ? <ActivityIndicator size="small" /> : isOpen ? <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} /> : null}
          </View>
        </GlassView>
      </Pressable>
    </Animated.View>
  );
}

/* ─────────────────────────── Tai предлагает ─────────────────────────── */

/**
 * Частые заказы резидента, которых ещё нет в чеке, — как «Tai предлагает» в веб-кассе.
 * Компактно: чипсы в одну-две строки вместо строки на каждую позицию. Тап добавляет позицию.
 * Сервер сам отдаёт пусто без подписки Tai и для не-резидентов.
 */
function TaiSuggestions({ checkId, itemIds }: { checkId: string; itemIds: Set<string> }) {
  const suggestions = useCheckSuggestions(checkId, true);
  const [adding, setAdding] = useState<string | null>(null);
  const list = (suggestions.data ?? []).filter((s) => !itemIds.has(s.itemId));
  if (list.length === 0) return null;

  const add = (itemId: string) => {
    haptic.light();
    setAdding(itemId);
    addItem(checkId, itemId)
      .catch((error: Error) => {
        haptic.error();
        Alert.alert('Позиция не добавлена', error.message === 'Check not open' ? 'Чек уже закрыт.' : error.message);
      })
      .finally(() => setAdding(null));
  };

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
      <TaiGlass proposal style={styles.card}>
        <View style={styles.cardHeader}>
          <TaiMark size={20} />
          <Text style={[type.headline, styles.label, styles.cardTitle]}>Tai предлагает</Text>
          <View style={styles.flex} />
          <Text style={[type.subhead, styles.secondary]} numberOfLines={1}>
            обычно берёт
          </Text>
        </View>
        <View style={styles.chips}>
          {list.map((s) => (
            <Animated.View key={s.itemId} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
              <Pressable
                disabled={adding !== null}
                onPress={() => add(s.itemId)}
                style={({ pressed }) => [styles.suggestionChip, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Добавить ${s.name}, ${formatMoney(toNumber(s.price))}`}>
                {adding === s.itemId ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <SymbolView name="plus" size={12} weight="bold" tintColor={colors.accent} />
                )}
                <Text style={[type.subhead, styles.label]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={[type.subhead, type.amount, styles.secondary]}>{formatMoney(toNumber(s.price))}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </View>
      </TaiGlass>
    </Animated.View>
  );
}

/* ─────────────────────────── Мероприятие чека ─────────────────────────── */

/**
 * Чек мероприятия: база (фикс-сумма или почасовой тариф) и её правка прямо из чека,
 * как в веб-кассе. Сервер пересчитывает базу только в собственном чеке мероприятия,
 * поэтому правка доступна лишь там; у миникапа база — взнос участника, его меняют в карточке миникапа.
 */
function LinkedEventCard({ check, isOpen, base }: { check: CheckDetail; isOpen: boolean; base: number }) {
  const event = useEvent(check.linkedEventId ?? undefined);
  const data = event.data;
  const hourly = data?.billingMode === 'hourly';
  // «По ставке зоны»: денег у мероприятия нет — их считает аренда зоны в этом же чеке.
  const rental = data?.billingMode === 'rental';
  const rates = useEventRates();
  const [busy, setBusy] = useState(false);
  const editable = isOpen && !!data && data.checkId === check.id && data.format !== 'minicap' && data.status !== 'completed' && data.status !== 'cancelled';
  if (!data && base <= 0) return null;

  const save = async (input: { plannedHours: number } | { fixedAmount: number }) => {
    if (!data || busy) return;
    haptic.selection();
    setBusy(true);
    try {
      await updateEvent(data.id, input);
      await reloadCheck(check.id);
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Мероприятие не изменено', eventErrorMessage(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  };

  const editAmount = () =>
    promptText(
      'Сумма мероприятия',
      'Фиксированная сумма — основа этого чека',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Сохранить',
          onPress: (value?: string) => {
            const amount = parseAmount(value ?? '');
            if (amount === null) return Alert.alert('Введите сумму');
            void save({ fixedAmount: amount });
          },
        },
      ],
      'plain-text',
      String(data?.fixedAmount != null ? toNumber(data.fixedAmount) : base || ''),
      'decimal-pad',
    );

  return (
    <GlassView style={styles.card}>
      <CardHeader
        icon="calendar"
        iconColor={colors.accent}
        title={data ? eventTitle(data) : 'Мероприятие'}
        detail={hourly && data?.plannedHours ? `${data.plannedHours} ч` : undefined}
      />
      <View style={styles.lineRow}>
        <Text style={[type.subhead, styles.secondary, styles.flex]}>{rental ? 'Оплата по ставке зоны' : hourly ? 'Пакет по часам' : 'Сумма мероприятия'}</Text>
        {busy ? <ActivityIndicator /> : rental ? (
          <Text style={[type.subhead, styles.secondary]}>по факту</Text>
        ) : (
          <RollingText text={formatMoney(base)} style={[type.headline, type.amount, styles.label]} />
        )}
      </View>
      {editable && hourly && (rates.data?.length ?? 0) > 0 && (
        <View style={styles.hoursGrid}>
          {rates.data!.map((rate) => {
            const active = data!.plannedHours === rate.hours;
            return (
              <Pressable
                key={rate.hours}
                disabled={busy || active}
                onPress={() => void save({ plannedHours: rate.hours })}
                style={({ pressed }) => [styles.hourChip, active && styles.hourChipActive, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${rate.hours} ч, ${formatMoney(toNumber(rate.price))}`}>
                <Text style={[type.subhead, styles.hourText, active && styles.hourTextActive]}>{rate.hours} ч</Text>
                <Text style={[type.caption1, active ? styles.hourTextActive : styles.secondary]} numberOfLines={1}>
                  {formatMoney(toNumber(rate.price))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {editable && !hourly && !rental && (
        <Pressable onPress={editAmount} disabled={busy} style={({ pressed }) => [styles.softButton, pressed && styles.pressed]} accessibilityRole="button">
          <SymbolView name="pencil" size={15} weight="semibold" tintColor={colors.accent} />
          <Text style={[type.subhead, styles.softButtonText]}>Изменить сумму</Text>
        </Pressable>
      )}
    </GlassView>
  );
}

/* ─────────────────────────── Мелкие части ─────────────────────────── */

/** Заголовок карточки. Значок — только у особых карточек (Tai, заказ, аренда, мероприятие). */
function CardHeader({
  icon,
  iconColor = colors.secondaryLabel,
  title,
  detail,
  detailColor,
}: {
  icon?: SFSymbol;
  iconColor?: typeof colors.secondaryLabel;
  title: string;
  detail?: string;
  detailColor?: typeof colors.green;
}) {
  return (
    <View style={styles.cardHeader}>
      {icon && <SymbolView name={icon} size={15} weight="semibold" tintColor={iconColor} />}
      <Text style={[type.headline, styles.label, styles.cardTitle]}>{title}</Text>
      <View style={styles.flex} />
      {detail && (
        <Text style={[type.subhead, type.amount, detailColor ? { color: detailColor } : styles.secondary]} numberOfLines={1}>
          {detail}
        </Text>
      )}
    </View>
  );
}

function Pill({ icon, text, color }: { icon: SFSymbol; text: string; color: typeof colors.indigo }) {
  return (
    <View style={styles.pill}>
      <SymbolView name={icon} size={13} tintColor={color} />
      <Text style={[type.footnote, styles.label]}>{text}</Text>
    </View>
  );
}

/** Живой таймер аренды: обновляется каждую секунду, не перерисовывая весь чек. */
const styles = StyleSheet.create({
  // Низ: на iOS отступ под таб-бар и плашку чека даёт сам UIKit (contentInsetAdjustmentBehavior),
  // прежние 120 pt добавлялись сверху и оставляли пустоту под последней карточкой.
  content: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.md },
  flex: { flex: 1 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  tertiary: { color: colors.tertiaryLabel },
  green: { color: colors.green },
  pressed: { opacity: 0.6 },

  hero: { alignItems: 'center', gap: 2, paddingTop: space.sm, paddingBottom: space.sm },
  heroCaption: { color: colors.secondaryLabel, letterSpacing: 0.6, fontWeight: '600' },
  heroAmount: { fontSize: 52, lineHeight: 62, color: colors.label },
  capsules: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginTop: space.xs },
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30, paddingHorizontal: 11, borderRadius: 15, backgroundColor: colors.fill },
  capsuleStrong: { color: colors.label, fontWeight: '600' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  shrink: { flexShrink: 1 },
  tierPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9, backgroundColor: `${PURPLE_HEX}33` },
  tierText: { color: PURPLE_HEX, fontWeight: '700', letterSpacing: 0.3 },
  billCard: { paddingVertical: space.xs },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, minHeight: 52 },
  billDivider: { marginLeft: 44 },
  rowIcon: { width: 32, height: 32, borderRadius: 10, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  rentalMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  clockButton: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  pill: {
    marginTop: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.fill,
  },

  card: { borderRadius: radius.card, borderCurve: 'continuous', padding: space.lg, gap: space.sm, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  // Заголовок карточки сжимается и переносится, а не выталкивает пояснение справа за край.
  cardTitle: { flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  empty: { paddingVertical: space.sm },

  clientRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  addClientIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  guestRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.sm },
  guestIcon: { width: 44, alignItems: 'center' },
  guestTexts: { flexDirection: 'row', alignItems: 'center', gap: space.md },

  lineRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 30 },
  orderButtons: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  orderButton: { flex: 1, minHeight: 44, paddingVertical: space.sm, borderRadius: 14, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  rejectButton: { backgroundColor: colors.fill },
  rejectText: { color: colors.red },
  confirmButton: { backgroundColor: colors.accent },
  confirmText: { color: 'white' },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  removing: { opacity: 0.4 },
  // Суммы в столбик выравниваются по правому краю и не прыгают при смене количества.
  itemSum: { minWidth: 64, textAlign: 'right' },
  itemRowStacked: { flexWrap: 'wrap', rowGap: space.sm },
  itemNameStacked: { flexBasis: '100%' },
  itemSumStacked: { flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', minHeight: 32, borderRadius: 999, backgroundColor: colors.fill, paddingHorizontal: 2 },
  stepperButton: { width: 32, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepperPressed: { backgroundColor: colors.fill },
  stepperValue: { minWidth: 22, textAlign: 'center', color: colors.label, fontWeight: '600', fontVariant: ['tabular-nums'] },

  timer: { fontSize: 34, lineHeight: 40, color: colors.label },
  softButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.fill,
  },
  softButtonText: { color: colors.accent, fontWeight: '600' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: 999,
    backgroundColor: colors.fill,
  },
  hoursGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  hourChip: { flexGrow: 1, minWidth: 64, alignItems: 'center', gap: 2, paddingVertical: space.sm, paddingHorizontal: space.sm, borderRadius: 14, borderCurve: 'continuous', backgroundColor: colors.fill },
  hourChipActive: { backgroundColor: colors.accent },
  hourText: { color: colors.label, fontWeight: '700' },
  hourTextActive: { color: 'white' },
});
