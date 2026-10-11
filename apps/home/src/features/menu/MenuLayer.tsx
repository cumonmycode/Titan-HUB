// Меню: разделы в стеклянной колонке слева, плитки без фото справа, плавающая
// плашка корзины. Заказ уходит администратору на подтверждение; без открытого
// счёта меню можно только посмотреть.
import { ArrowLeft, ArrowRight, Check, Info, Plus, Search, ShoppingBag, X } from 'lucide-react-native';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOutDown, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { sendOrder } from '@/data/actions';
import { useMenu } from '@/data/menu';
import type { MenuItem } from '@/data/types';
import { sessionCheckId, useVisit } from '@/features/visit/store';
import { money, plural } from '@/lib/format';
import { Button, IconButton } from '@/ui/button';
import { Loader, Stepper } from '@/ui/controls';
import { Glass, glassStyle } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { Layer } from '@/ui/layer';
import { Press } from '@/ui/press';
import { useScreen } from '@/ui/screen';
import { T } from '@/ui/text';
import { color, font, GUTTER, motion, radius } from '@/ui/tokens';

import { cartSummary, qtyOf, useCart } from './cart';

const ALL = '__all';
const TOP = '__top';
const GAP = 14;
// Узкий экран (книжная ориентация Honor, 686 dp) — колонка разделов уже и плитки
// мельче, чтобы плиток было две в ряд, а не одна.
const NARROW = 800;
const layoutFor = (width: number) => (width < NARROW ? { rail: 168, tile: 180, compact: true } : { rail: 212, tile: 210, compact: false });

/**
 * Меню собирается один раз при запуске и остаётся смонтированным: открытие —
 * только проявление на UI-потоке (раньше каждое открытие строило все плитки —
 * рывок на Honor). Закрытое меню прозрачно, и Android его не рисует.
 * Своего фона нет — меню лежит на общем фоне экрана гостя.
 */
export function MenuLayer() {
  const open = useVisit((s) => s.layer === 'menu');
  // Новый визит — меню с чистого листа (поиск и раздел прошлого гостя не переносятся).
  const visit = useVisit((s) => (s.phase.kind === 'idle' ? 'idle' : s.phase.checkId));
  const fade = useAnimatedStyle(
    () => ({
      opacity: withTiming(open ? 1 : 0, { duration: open ? motion.enter : motion.exit }),
      transform: [{ translateY: withTiming(open ? 0 : 16, { duration: open ? motion.enter : motion.exit }) }],
    }),
    [open],
  );
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, fade]}
      pointerEvents={open ? 'auto' : 'none'}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      <MenuScreen key={visit} open={open} />
    </Animated.View>
  );
}

function MenuScreen({ open }: { open: boolean }) {
  const menu = useMenu();
  const canOrder = useVisit((s) => s.phase.kind === 'session');
  const [cat, setCat] = useState(ALL);
  const [query, setQuery] = useState('');
  const [review, setReview] = useState(false);
  const [sent, setSent] = useState(false);
  // Ширина сетки — от окна, а не замером: список строится сразу, без второго прохода.
  const { width } = useScreen();
  const sizes = layoutFor(width);
  const gridWidth = width - GUTTER * 2 - sizes.rail - 16;
  const count = useCart((s) => cartSummary(s.lines).count);

  const data = menu.data;
  const hasTop = !!data?.items.some((i) => i.isTop);
  const items = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (q) return data.items.filter((i) => i.name.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q)));
    if (cat === TOP) return data.items.filter((i) => i.isTop);
    if (cat === ALL) {
      // «Все» — по порядку разделов, внутри раздела — как в кассе.
      const rank = new Map(data.categories.map((c, i) => [c.id, i]));
      const order = (id: string | null) => (id && rank.has(id) ? rank.get(id)! : data.categories.length);
      return data.items.map((item, i) => ({ item, i })).sort((a, b) => order(a.item.categoryId) - order(b.item.categoryId) || a.i - b.i).map((x) => x.item);
    }
    return data.items.filter((i) => i.categoryId === cat);
  }, [data, cat, query]);

  const columns = Math.max(1, Math.floor((gridWidth + GAP) / (sizes.tile + GAP)));
  const tileWidth = Math.floor((gridWidth - GAP * (columns - 1)) / columns);
  const close = () => useVisit.getState().close();

  if (sent) return <SentView onDone={() => { setSent(false); close(); }} />;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Button title="Счёт" icon={ArrowLeft} onPress={close} />
        <T variant="title" style={{ fontSize: 30 }}>Меню</T>
        <View style={[styles.search, glassStyle('control', radius.pill)]}>
          <Icon as={Search} size={20} tone={color.textTertiary} stroke={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Найти блюдо или напиток"
            placeholderTextColor={color.textTertiary}
            style={styles.searchInput}
            returnKeyType="search"
            accessibilityLabel="Поиск по меню"
          />
          {query ? <IconButton icon={X} label="Очистить поиск" size={36} variant="quiet" onPress={() => setQuery('')} /> : null}
        </View>
      </View>

      <View style={styles.body}>
        <Glass kind="panel" radius={32} style={[styles.rail, { width: sizes.rail }]}>
          <ScrollView contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator={false}>
            <Category compact={sizes.compact} id={ALL} name="Все" count={data?.items.length ?? 0} active={!query && cat === ALL} onPress={() => { setCat(ALL); setQuery(''); }} />
            {hasTop ? <Category compact={sizes.compact} id={TOP} name="Популярное" count={data?.items.filter((i) => i.isTop).length ?? 0} active={!query && cat === TOP} onPress={() => { setCat(TOP); setQuery(''); }} /> : null}
            {(data?.categories ?? []).map((c) => (
              <Category
                compact={sizes.compact}
                key={c.id}
                id={c.id}
                name={c.name}
                count={data?.items.filter((i) => i.categoryId === c.id).length ?? 0}
                active={!query && cat === c.id}
                onPress={() => { setCat(c.id); setQuery(''); }}
              />
            ))}
          </ScrollView>
        </Glass>

        <View style={{ flex: 1 }}>
          {!data && menu.isLoading ? (
            <Loader label="Загружаем меню…" />
          ) : !data ? (
            <View style={styles.empty}>
              <T variant="body" tone="secondary">Не удалось загрузить меню</T>
              <Button title="Повторить" onPress={() => void menu.refetch()} />
            </View>
          ) : (
            // Плитки — в одном родителе с переносом строк, а не FlatList с колонками:
            // при повороте FlatList перемонтировал всю сетку (key={columns}), и
            // Reanimated секундами разбирал обновления ещё не смонтированных плиток.
            // Меню небольшое — все плитки строятся сразу, при прокрутке ничего не достраивается.
            <ScrollView contentContainerStyle={styles.grid} keyboardShouldPersistTaps="handled">
              {items.length ? (
                items.map((item) => <ItemTile key={item.id} item={item} width={tileWidth} canOrder={canOrder} />)
              ) : (
                <T variant="body" tone="secondary" style={styles.nothing}>Ничего не нашлось</T>
              )}
            </ScrollView>
          )}
        </View>
      </View>

      {canOrder ? (
        count > 0 ? <CartBar left={GUTTER + sizes.rail + 16} onOrder={() => setReview(true)} /> : null
      ) : (
        <View style={[styles.bottomCenter, { left: GUTTER + sizes.rail + 16 }]} pointerEvents="none">
          <Glass kind="overlay" radius={radius.pill} style={styles.notice}>
            <Icon as={Info} size={20} tone={color.accentSoft} />
            <T variant="label" tone="secondary">Заказать можно, когда администратор откроет счёт</T>
          </Glass>
        </View>
      )}

      <Layer visible={open && review} onClose={() => setReview(false)} variant="dialog" style={styles.reviewDialog}>
        <OrderReview onClose={() => setReview(false)} onSent={() => { setReview(false); setSent(true); }} />
      </Layer>
    </View>
  );
}

function Category({ name, count, active, onPress, compact }: { id: string; name: string; count: number; active: boolean; onPress: () => void; compact?: boolean }) {
  return (
    <Press
      onPress={onPress}
      scaleTo={0.97}
      accessibilityRole="tab"
      accessibilityLabel={name}
      accessibilityState={{ selected: active }}
      style={[styles.category, compact && { paddingHorizontal: 12 }, active && styles.categoryActive]}
    >
      <T variant="label" numberOfLines={2} style={{ flex: 1, fontSize: compact ? 15 : 17, color: active ? color.ground : 'rgba(236,232,245,0.88)' }}>{name}</T>
      {compact ? null : <T variant="small" numeric style={{ color: active ? 'rgba(12,10,17,0.6)' : color.textTertiary }}>{count}</T>}
    </Press>
  );
}

function ItemTile({ item, width, canOrder }: { item: MenuItem; width: number; canOrder: boolean }) {
  const qty = useCart((s) => qtyOf(s.lines, item.id));
  const add = () => useCart.getState().add(item);
  return (
    <Press
      onPress={canOrder ? add : undefined}
      scaleTo={canOrder ? 0.96 : 1}
      accessibilityLabel={`${item.name}, ${money(item.price)}`}
      style={[styles.tile, { width }, glassStyle(qty > 0 ? 'accent' : 'control', radius.card), qty > 0 && styles.tileInCart]}
    >
      <T variant="subheading" numberOfLines={2} style={{ lineHeight: 23 }}>{item.name}</T>
      <View style={styles.tileFoot}>
        <T variant="subheading" numeric>{money(item.price)}</T>
        {canOrder ? (
          qty > 0 ? (
            <Stepper value={qty} onMinus={() => useCart.getState().remove(item.id)} onPlus={add} />
          ) : (
            <View style={[styles.addDot, glassStyle('raised', radius.pill)]}>
              <Icon as={Plus} size={22} stroke={2.2} />
            </View>
          )
        ) : null}
      </View>
    </Press>
  );
}

function CartBar({ left, onOrder }: { left: number; onOrder: () => void }) {
  // Селектор возвращает сам массив (стабильная ссылка), сумму считаем здесь —
  // новый объект из селектора zustand зациклил бы перерисовку.
  const lines = useCart((s) => s.lines);
  const { count, total } = cartSummary(lines);
  return (
    <View style={[styles.bottomCenter, { left }]} pointerEvents="box-none">
      <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(160)} style={[styles.cartBar, glassStyle('overlay', radius.pill)]}>
        <Icon as={ShoppingBag} size={26} tone={color.accentSoft} />
        <View style={{ flex: 1 }}>
          <T variant="subheading" numeric>{count} {plural(count, 'позиция', 'позиции', 'позиций')} · {money(total)}</T>
          <T variant="small" tone="secondary">Администратор подтвердит заказ</T>
        </View>
        <Button title="Заказать" iconRight={ArrowRight} variant="primary" size="lg" onPress={onOrder} />
      </Animated.View>
    </View>
  );
}

function OrderReview({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const lines = useCart((s) => s.lines);
  const { total } = cartSummary(lines);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const checkId = sessionCheckId();
    if (!checkId || !lines.length || busy) return;
    setBusy(true);
    const ok = await sendOrder(checkId, lines.map((l) => ({ itemId: l.item.id, quantity: l.quantity })));
    setBusy(false);
    if (ok) {
      useCart.getState().clear();
      onSent();
    }
  };
  // Гость убрал всё степпером — окну больше нечего показывать.
  const closeEmpty = useEffectEvent(() => onClose());
  useEffect(() => {
    if (!lines.length) closeEmpty();
  }, [lines.length]);
  if (!lines.length) return null;
  return (
    <>
      <View style={styles.reviewHead}>
        <T variant="title" style={{ flex: 1 }}>Ваш заказ</T>
        <IconButton icon={X} label="Закрыть" onPress={onClose} />
      </View>
      <ScrollView style={{ flexGrow: 0, maxHeight: 360 }} contentContainerStyle={{ gap: 4 }}>
        {lines.map((l) => (
          <View key={l.item.id} style={styles.reviewLine}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="subheading" numberOfLines={2}>{l.item.name}</T>
              <T variant="caption" tone="secondary" numeric>{money(l.item.price * l.quantity)}</T>
            </View>
            <Stepper value={l.quantity} onMinus={() => useCart.getState().remove(l.item.id)} onPlus={() => useCart.getState().add(l.item)} />
          </View>
        ))}
      </ScrollView>
      <View style={styles.reviewTotal}>
        <T variant="label" tone="secondary">Итого</T>
        <T variant="title" numeric>{money(total)}</T>
      </View>
      <Button title="Отправить администратору" iconRight={ArrowRight} variant="primary" size="lg" loading={busy} onPress={() => void send()} />
    </>
  );
}

function SentView({ onDone }: { onDone: () => void }) {
  return (
    <View style={styles.sent}>
      <Animated.View entering={FadeIn.duration(220)} style={{ alignItems: 'center', gap: 16 }}>
        <View style={[styles.sentIcon, { backgroundColor: color.greenTint, borderColor: 'rgba(52,211,153,0.5)' }]}>
          <Icon as={Check} size={60} tone={color.green} stroke={2.4} />
        </View>
        <T variant="title" style={{ fontSize: 40, lineHeight: 46 }}>Заказ отправлен</T>
        <T variant="body" tone="secondary" style={{ textAlign: 'center', maxWidth: 480 }}>Администратор подтвердит его в течение пары минут — статус видно на экране счёта.</T>
        <Button title="К счёту" icon={ArrowLeft} onPress={onDone} style={{ marginTop: 8 }} />
      </Animated.View>
      <AutoClose ms={3500} onDone={onDone} />
    </View>
  );
}

function AutoClose({ ms, onDone }: { ms: number; onDone: () => void }) {
  const done = useEffectEvent(onDone);
  useEffect(() => {
    const t = setTimeout(done, ms);
    return () => clearTimeout(t);
  }, [ms]);
  return null;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: GUTTER, paddingTop: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 56 },
  search: { flex: 1, maxWidth: 460, marginLeft: 'auto', height: 52, paddingLeft: 18, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchInput: { flex: 1, minWidth: 0, fontSize: 16, fontFamily: font.regular, color: color.text, paddingVertical: 0 },
  body: { flex: 1, flexDirection: 'row', gap: 16, paddingTop: 16 },
  rail: { padding: 10, marginBottom: 22 },
  category: { minHeight: 56, paddingHorizontal: 16, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'transparent' },
  categoryActive: { backgroundColor: color.text, borderColor: color.text },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, paddingBottom: 120 },
  nothing: { width: '100%', textAlign: 'center', paddingTop: 48 },
  tile: { height: 136, paddingTop: 16, paddingBottom: 14, paddingLeft: 18, paddingRight: 14, justifyContent: 'space-between' },
  tileInCart: { backgroundColor: 'rgba(139,92,246,0.22)' },
  tileFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  addDot: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  bottomCenter: { position: 'absolute', right: GUTTER, bottom: 20, alignItems: 'center' },
  cartBar: { width: '100%', maxWidth: 640, height: 82, flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 24, paddingRight: 10 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 56, paddingHorizontal: 22 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  reviewDialog: { width: 620 },
  reviewHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reviewLine: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.10)' },
  reviewTotal: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 6 },
  sent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: GUTTER },
  sentIcon: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
});
