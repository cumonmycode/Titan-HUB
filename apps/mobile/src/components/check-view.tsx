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
import type { CheckTotals } from '@/lib/checks';
import { promptText } from '@/lib/dialog';
import { eventErrorMessage, eventTitle, updateEvent, useEvent, useEventRates } from '@/lib/events-api';
import { formatDuration, formatMoney, formatTime, plural, toNumber } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { PosPlayer } from '@/lib/payment';
import { addItem, reloadCheck, TIER_LABEL, useCheckSuggestions } from '@/lib/pos-api';
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

const rowLayout = LinearTransition.springify().damping(22).stiffness(220);
const ORDER_TINT = 'rgba(255,149,0,0.20)';
/** Фиолетовое стекло Tai — как карточки предчеков. */
const TAI_TINT = 'rgba(139,92,246,0.18)';

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
  const discountsTotal = check.discounts.reduce((sum, d) => sum + toNumber(d.amount), 0);
  const guests = check.guestNames ?? [];
  // Списание на персонал: сервер закрывает чек за 0 ₽ (аренда, база и предоплата не берутся,
  // как payTotals) — иначе сверху «тикала» бы живая аренда как долг гостя.
  const due = check.staffCompId ? 0 : totals.due;
  const prepaid = check.staffCompId ? 0 : totals.prepaid;
  // Сумма позиций нужна отдельно, только когда к оплате добавляются аренда или мероприятие
  // (их суммы — в своих карточках) или вычитается предоплата; иначе она равна сумме сверху.
  const hasExtras = totals.rental > 0 || totals.eventBase > 0 || prepaid > 0;
  const itemsDetail = [
    itemRows.length > 0 ? `${itemRows.length} ${plural(itemRows.length, ['позиция', 'позиции', 'позиций'])}` : null,
    hasExtras && itemRows.length > 0 ? formatMoney(totals.items) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const opened = isOpen ? `Открыт в ${formatTime(check.createdAt)} · ${formatDuration(check.createdAt, now)}` : `Открыт в ${formatTime(check.createdAt)}`;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior={contentInsetAdjustmentBehavior}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      showsVerticalScrollIndicator={false}>
      {/* При открытии чек появляется целиком; анимации — только на изменения. */}
      <LayoutAnimationConfig skipEntering skipExiting>
        <View style={styles.hero}>
          <Text style={[type.footnote, styles.heroCaption]}>{isOpen ? 'К ОПЛАТЕ' : check.status === 'closed' ? 'ОПЛАЧЕН' : 'ОТМЕНЁН'}</Text>
          <RollingText text={formatMoney(due)} style={[styles.heroAmount, type.amount]} maxFontSizeMultiplier={FONT_SCALE_MAX.display} />
          <Text style={[type.subhead, styles.secondary]}>
            {prepaid > 0 ? `${opened} · предоплата ${formatMoney(-prepaid)}` : opened}
          </Text>
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
                <View style={styles.flex}>
                  <Text style={[type.headline, styles.label]} numberOfLines={1}>
                    {check.playerId ? (player?.nickname ?? 'Клиент') : 'Добавить клиента'}
                  </Text>
                  <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
                    {check.playerId
                      ? player
                        ? (TIER_LABEL[player.clientTier] ?? player.clientTier)
                        : 'Загружаем…'
                      : 'Бонусы, депозит и долг — только с клиентом'}
                  </Text>
                </View>
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

        <GlassView style={styles.card}>
          <CardHeader title="Позиции" detail={itemsDetail || undefined} />
          {itemRows.length === 0 ? (
            <Text style={[type.subhead, styles.secondary, styles.empty]}>{isOpen ? 'Чек пуст — нажмите «Добавить» внизу' : 'Позиций нет'}</Text>
          ) : (
            itemRows.map((row, index) => (
              <Animated.View key={row.checkItem.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
                {index > 0 && <View style={styles.divider} />}
                <ItemRow
                  name={row.item?.name ?? '—'}
                  checkItemId={row.checkItem.id}
                  quantity={row.checkItem.quantity}
                  price={toNumber(row.checkItem.priceAtTime)}
                  isOpen={isOpen}
                  onQuantity={actions.onQuantity}
                />
              </Animated.View>
            ))
          )}
        </GlassView>

        {isOpen && check.playerId && <TaiSuggestions checkId={check.id} itemIds={new Set(itemRows.map((row) => row.checkItem.itemId))} />}

        {check.linkedEventId && <LinkedEventCard check={check} isOpen={isOpen} base={totals.eventBase} />}

        {/* Скидка добавляется из меню «…», здесь — только уже применённые (снимаются свайпом). */}
        {check.discounts.length > 0 && (
          <Animated.View entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
            <GlassView style={styles.card}>
              <CardHeader title="Скидки" detail={formatMoney(-discountsTotal)} detailColor={colors.green} />
              {check.discounts.map((d, index) => (
                <Animated.View key={d.id} entering={FadeIn} exiting={FadeOut} layout={rowLayout}>
                  {index > 0 && <View style={styles.divider} />}
                  <SwipeToDelete enabled={isOpen} label="Снять" onDelete={() => actions.onRemoveDiscount(d.id)}>
                    <View style={styles.lineRow}>
                      <View style={styles.flex}>
                        <Text style={[type.body, styles.label]} numberOfLines={1}>
                          {d.name}
                        </Text>
                        {d.discountId && <Text style={[type.caption1, styles.tertiary]}>автоматическая</Text>}
                      </View>
                      <Text style={[type.body, type.amount, styles.green]}>{formatMoney(-toNumber(d.amount))}</Text>
                    </View>
                  </SwipeToDelete>
                </Animated.View>
              ))}
            </GlassView>
          </Animated.View>
        )}

        {check.spaceId && check.spaceStartAt && (
          <GlassView style={styles.card}>
            <CardHeader icon="timer" title="Аренда зоны" detail={check.spaceEndAt ? 'завершена' : 'идёт'} detailColor={check.spaceEndAt ? undefined : colors.green} />
            <RentalTimer startAt={check.spaceStartAt} endAt={check.spaceEndAt} />
            <View style={styles.lineRow}>
              <Text style={[type.subhead, styles.secondary, styles.flex]}>
                {check.spaceEndAt ? `${formatTime(check.spaceStartAt)} – ${formatTime(check.spaceEndAt)}` : `с ${formatTime(check.spaceStartAt)}`}
                {check.spaceHourlyRate ? ` · ${formatMoney(check.spaceHourlyRate)}/ч` : ''}
              </Text>
              <RollingText text={formatMoney(totals.rental)} style={[type.headline, type.amount, styles.label]} />
            </View>
            {isOpen && (
              <Pressable onPress={actions.onEditRental} style={({ pressed }) => [styles.softButton, pressed && styles.pressed]} accessibilityRole="button">
                <SymbolView name="clock.arrow.circlepath" size={15} weight="semibold" tintColor={colors.accent} />
                <Text style={[type.subhead, styles.softButtonText]}>Изменить время</Text>
              </Pressable>
            )}
          </GlassView>
        )}
      </LayoutAnimationConfig>
    </ScrollView>
  );
}

/* ─────────────────────────── Строка позиции ─────────────────────────── */

function ItemRow({
  name,
  checkItemId,
  quantity,
  price,
  isOpen,
  onQuantity,
}: {
  name: string;
  checkItemId: string;
  quantity: number;
  price: number;
  isOpen: boolean;
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
        <View style={[styles.flex, stacked && styles.itemNameStacked]}>
          <Text style={[type.body, styles.label]} numberOfLines={2}>
            {name}
          </Text>
          {qty > 1 && <RollingText text={`${isOpen ? '' : `${qty} × `}${formatMoney(price)}${isOpen ? ' за шт.' : ''}`} style={[type.footnote, styles.secondary]} />}
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
      <GlassView tintColor={TAI_TINT} style={styles.card}>
        <CardHeader icon="sparkles" iconColor={colors.accent} title="Tai предлагает" detail="обычно берёт" />
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
      </GlassView>
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
function RentalTimer({ startAt, endAt }: { startAt: string; endAt: string | null }) {
  const now = useNow(1000);
  const end = endAt ? new Date(endAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(startAt).getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return <Text style={[styles.timer, type.amount]} maxFontSizeMultiplier={FONT_SCALE_MAX.display}>{`${h}:${pad(m)}:${pad(s)}`}</Text>;
}

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
