// RN-двойники компонентов @expo/ui/swift-ui: на Android — вместо SwiftUI, на iOS — ради
// скорости переходов (см. IOS ниже).
//
// На Android нативных вью SwiftUI нет: `requireNativeView('ExpoUI', 'PickerView')`
// и остальные падают. Здесь те же 23 компонента собраны на React Native — так, чтобы
// 43 экрана, написанных под SwiftUI, работали без правок. Выбор даты и времени отдан
// нативным диалогам Material из @expo/ui/jetpack-compose, остальное — RN-примитивы,
// стилизованные под сгруппированные списки iOS, чтобы вёрстка экранов не разъехалась.
import { NavigationContext } from 'expo-router/react-navigation';
import { Children, cloneElement, createContext, Fragment, isValidElement, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator, DynamicColorIOS, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch,
  useWindowDimensions, View,
  type ColorValue, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';

import { SwipeToDelete } from '@/components/swipe-to-delete';
import { Text as RNText, TextInput } from '@/components/text';
import { FONT_SCALE_MAX, useScaledSize, useTextLayout } from '@/lib/text-scale';
import { useAutoFocus } from '@/lib/auto-focus';
import { haptic } from '@/lib/haptics';
import { useTabBarClearance } from '@/lib/tab-bar';
import { colors, radius, space } from '@/lib/theme';

import { SymbolView } from '../symbols';
import Animated, { Easing, Keyframe, SlideInDown, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChartIsland, ColorIsland, DateIsland, HAS_ISLANDS } from './islands';
import { resolve, type ViewModifier } from './modifiers';

/**
 * На iOS слой тоже рисует формы: SwiftUI Form строился по 110–220 мс на каждый переход
 * и анимации дёргались, RN-разметка тех же экранов — в 2–3 раза быстрее. Отличия iOS —
 * размеры и отступы iOS 26 и нативные вставки для меню, сегментов, даты и графиков.
 */
const IOS = Platform.OS === 'ios';

/** Когда экран впервые показал вставку: считаем «доехал ли» он от этого момента. */
const screenBorn = new WeakMap<object, number>();
/** Экраны, уже закончившие въезд: новые вставки и длинные списки в них рисуются сразу. */
const settledScreens = new WeakSet<object>();
const NO_SCREEN = {};
/** Push-анимация iOS идёт ~0,35–0,5 с; у вкладок события конца перехода нет — ждём столько же. */
const SETTLE_MS = 450;

/**
 * Очередь подстановки вставок: одна вставка стоит 12–17 мс, пять разом давали паузу
 * 60–110 мс сразу после въезда экрана. По одной через кадр — та же работа без рывка.
 */
const slotQueue: (() => void)[] = [];
let pumping = false;
function pumpSlots() {
  const next = slotQueue.shift();
  if (!next) {
    pumping = false;
    return;
  }
  next();
  requestAnimationFrame(() => requestAnimationFrame(pumpSlots));
}
function requestSlot(grant: () => void): () => void {
  slotQueue.push(grant);
  if (!pumping) {
    pumping = true;
    requestAnimationFrame(pumpSlots);
  }
  return () => {
    const index = slotQueue.indexOf(grant);
    if (index >= 0) slotQueue.splice(index, 1);
  };
}

/**
 * Готов ли экран к нативной вставке SwiftUI. Хост SwiftUI пересчитывает раскладку на
 * каждом кадре въезда экрана — вставки дёргали анимацию перехода. Пока экран едет,
 * рисуем RN-копию вставки, настоящую подставляем по окончании перехода.
 */
function useSettled(enabled = true): boolean {
  const navigation = useContext(NavigationContext);
  const key = (navigation as object | undefined) ?? NO_SCREEN;
  const [settled, setSettled] = useState(() => settledScreens.has(key));
  useEffect(() => {
    if (settled || !enabled) return;
    const now = Date.now();
    const born = screenBorn.get(key) ?? now;
    if (!screenBorn.has(key)) screenBorn.set(key, now);
    let cancelSlot: (() => void) | undefined;
    const done = () => {
      settledScreens.add(key);
      cancelSlot ??= requestSlot(() => setSettled(true));
    };
    const timer = setTimeout(done, Math.max(0, born + SETTLE_MS - now));
    const unsubscribe = navigation?.addListener('transitionEnd' as never, done);
    return () => {
      clearTimeout(timer);
      unsubscribe?.();
      cancelSlot?.();
    };
  }, [navigation, key, settled, enabled]);
  return settled;
}

type Mods = { modifiers?: ViewModifier[] };
type WithChildren = { children?: ReactNode };

const TintContext = createContext<ColorValue>(colors.accent);

/**
 * Пункт меню сперва выполняет своё действие, потом закрывает меню. Раньше меню
 * закрывалось по касанию (onTouchStart) — модалка исчезала раньше, чем кнопка получала
 * нажатие, и пункт «Мероприятие / Миникап» не срабатывал вовсе.
 */
const MenuCloseContext = createContext<(() => void) | null>(null);

/** Текст в подписи секции — мелкий и серый, как footer у SwiftUI Section. */
const FootnoteContext = createContext(false);

/**
 * Ось родительского стека — для frame(maxWidth: .infinity): в ряду (HStack) такие вью делят
 * ширину поровну, в столбце (VStack, секция) — растягиваются на всю ширину.
 */
const AxisContext = createContext<'row' | 'column'>('column');
function useFill(fill: boolean | undefined): ViewStyle | undefined {
  const axis = useContext(AxisContext);
  if (!fill) return undefined;
  return axis === 'row' ? styles.fillRow : styles.fillColumn;
}

/**
 * Место в строке секции. В SwiftUI отступы строке даёт ячейка List/Form, а здесь их
 * добавляем сами: 'root' — строка собрана своим компонентом (LinkRow, TextRow, InputRow…),
 * и отступы ячейки берёт первый стек или текст внутри него; 'inside' — отступы уже есть,
 * поле ввода в такой строке компактное; 'none' — вне секции.
 */
type CellPlace = 'none' | 'root' | 'inside' | 'control';
const CellContext = createContext<CellPlace>('none');

/** Корень строки-обёртки получает отступы ячейки, его потомки — уже «внутри». */
function useCellRoot(): boolean {
  return useContext(CellContext) === 'root';
}
function insideCell(node: ReactElement): ReactElement {
  return <CellContext.Provider value="inside">{node}</CellContext.Provider>;
}

/** Оттенок берётся из seedColor ближайшего Host, если компонент не задал свой. */
function useTint(own?: ColorValue): ColorValue {
  const inherited = useContext(TintContext);
  return own ?? inherited;
}

// ——— контейнеры ———

export type HostProps = Mods & WithChildren & {
  style?: StyleProp<ViewStyle>;
  matchContents?: boolean | { vertical?: boolean; horizontal?: boolean };
  useViewportSizeMeasurement?: boolean;
  seedColor?: ColorValue;
  colorScheme?: 'light' | 'dark';
  layoutDirection?: 'leftToRight' | 'rightToLeft';
  ignoreSafeArea?: 'all' | 'container' | 'keyboard';
  pointerEvents?: 'box-none' | 'none' | 'box-only' | 'auto';
  onLayoutContent?: (event: { nativeEvent: { width: number; height: number } }) => void;
};

/** В SwiftUI Host — мост в UIHostingController; на Android достаточно обычной вьюхи. */
export function Host({ style, children, seedColor, pointerEvents, modifiers }: HostProps) {
  const m = resolve(modifiers);
  const content = <View style={[style, m.style]} pointerEvents={pointerEvents}>{children}</View>;
  return seedColor ? <TintContext.Provider value={seedColor}>{content}</TintContext.Provider> : content;
}

export function VStack({ children, spacing, alignment, modifiers, style }: Mods & WithChildren & { spacing?: number; alignment?: string; style?: StyleProp<ViewStyle> }) {
  const align = alignment === 'leading' ? 'flex-start' : alignment === 'trailing' ? 'flex-end' : 'center';
  const root = useCellRoot();
  const m = resolve(modifiers);
  // Столбец с растягивающимся рядом (ряд со Spacer) тоже растягивается, как в SwiftUI:
  // иначе время в уведомлении стояло вплотную к заголовку, а не у правого края.
  const fill = useFill(m.fill || Children.toArray(children).some(isGreedyRow));
  // flexShrink: в строке (HStack) столбец текста должен переноситься, а не вылезать за карточку.
  const view = (
    <View style={[root && styles.cell, { gap: spacing, alignItems: align, flexShrink: 1 }, m.style, fill, style]}>
      <AxisContext.Provider value="column">{children}</AxisContext.Provider>
    </View>
  );
  return root ? insideCell(view) : view;
}

export function HStack({ children, spacing, alignment, modifiers, style }: Mods & WithChildren & { spacing?: number; alignment?: string; style?: StyleProp<ViewStyle> }) {
  const align = alignment === 'top' ? 'flex-start' : alignment === 'bottom' ? 'flex-end' : 'center';
  const root = useCellRoot();
  const parentAxis = useContext(AxisContext);
  // Как в SwiftUI: значение справа от Spacer не сжимается — сжимается и обрезается подпись слева.
  // Но не больше 60 % строки: на «Увеличенном» виде и с крупным текстом длинное значение
  // иначе вытесняло подпись целиком.
  const list = Children.toArray(children);
  const spacerAt = list.findIndex((child) => isValidElement(child) && child.type === Spacer);
  const items =
    spacerAt < 0
      ? list
      : list.map((child, index) =>
          index > spacerAt && isValidElement(child) && (child.type === VStack || child.type === Text)
            ? cloneElement(child as ReactElement<{ style?: StyleProp<ViewStyle> }>, { style: [(child.props as { style?: StyleProp<ViewStyle> }).style, styles.noShrink] })
            : child,
        );
  const m = resolve(modifiers);
  const fill = useFill(m.fill);
  // Как в SwiftUI: ряд со Spacer занимает всю доступную ширину. Раньше он был шириной по
  // содержимому, и время в уведомлениях уезжало за край строки.
  const greedy = spacerAt >= 0 ? (parentAxis === 'row' ? styles.greedyRow : styles.fillColumn) : undefined;
  const view = (
    <View style={[root && styles.cell, { flexDirection: 'row', gap: spacing, alignItems: align }, greedy, m.style, fill, style]}>
      <AxisContext.Provider value="row">{items}</AxisContext.Provider>
    </View>
  );
  return root ? insideCell(view) : view;
}

/** Ряд со Spacer — в SwiftUI он забирает всю ширину. */
function isGreedyRow(child: ReactNode): boolean {
  return isValidElement(child) && child.type === HStack && Children.toArray((child.props as WithChildren).children).some((c) => isValidElement(c) && c.type === Spacer);
}

export function Spacer({ modifiers }: Mods) {
  return <View style={[styles.spacer, resolve(modifiers).style]} />;
}

/** RN-разметка внутри SwiftUI-дерева; на Android дерево и так из RN — просто дети. */
export function RNHostView({ children }: { matchContents?: boolean; children: ReactElement }) {
  return children;
}

// ——— текст и иконки ———

export function Text({ children, modifiers, style }: Mods & WithChildren & { style?: StyleProp<TextStyle> }) {
  const m = resolve(modifiers);
  const footnote = useContext(FootnoteContext);
  const root = useCellRoot();
  // В ряду текст переносится, как в SwiftUI, а не выталкивает соседей за край.
  const inRow = useContext(AxisContext) === 'row';
  return (
    <RNText numberOfLines={m.lineLimit} style={[styles.text, inRow && styles.shrink, footnote && styles.footnote, root && styles.cellText, m.text, style]}>
      {children}
    </RNText>
  );
}

/** SwiftUI Image(systemName:) — SF Symbol; на Android его рисует наш SymbolView. */
export function Image({ systemName, size = 17, color, modifiers, onPress }: Mods & { systemName?: string; size?: number; color?: ColorValue; onPress?: () => void }) {
  const m = resolve(modifiers);
  const inner = <SymbolView name={systemName ?? ''} size={size} tintColor={color ?? m.text.color ?? colors.label} />;
  // frame + background из модификаторов образуют «плашку» вокруг иконки — как в SwiftUI.
  const framed = Object.keys(m.style).length > 0 ? <View style={[styles.center, m.style]}>{inner}</View> : inner;
  // В SwiftUI Image принимает onPress — например, иконка уведомления открывает чек.
  if (!onPress) return framed;
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      {framed}
    </Pressable>
  );
}

export function Label({ title, systemImage, modifiers }: Mods & { title?: string; systemImage?: string }) {
  const m = resolve(modifiers);
  const root = useCellRoot();
  return (
    <View style={[styles.row, root && styles.cell, m.style]}>
      {systemImage ? <SymbolView name={systemImage} size={17} tintColor={m.text.color ?? colors.accent} /> : null}
      <RNText style={[styles.text, m.text]}>{title}</RNText>
    </View>
  );
}

// ——— управление ———

export function Button({ label, systemImage, onPress, modifiers, children, role }: Mods & WithChildren & { label?: string; systemImage?: string; onPress?: () => void; role?: string }) {
  const m = resolve(modifiers);
  const fill = useFill(m.fill);
  const tint = useTint(m.tint);
  const closeMenu = useContext(MenuCloseContext);
  const destructive = role === 'destructive';
  // Кнопка — сама строка секции или корень строки-обёртки (ActionRow «Добавить тариф»):
  // высота и отступы как у соседних строк.
  const place = useContext(CellContext);
  const asRow = place === 'control' || place === 'root';
  const color = destructive ? colors.red : (m.text.color ?? tint);
  const large = m.controlSize === 'large' || m.controlSize === 'extraLarge';
  // «Стеклянные» стили iOS 26 на Android — их ближайшие Material-аналоги: залитая и тональная кнопки.
  const filled = m.buttonStyle === 'borderedProminent' || m.buttonStyle === 'glassProminent';
  const tonal = m.buttonStyle === 'bordered' || m.buttonStyle === 'glass';
  // Кнопка со своей разметкой (без label) в SwiftUI-форме — строка во всю ширину ячейки,
  // как переход в «Настройках». Раньше разметка сжималась, и Spacer не отодвигал шеврон.
  if (children && !label && !systemImage) {
    return insideCell(
      <Pressable
        onPress={() => {
          closeMenu?.();
          onPress?.();
        }}
        disabled={m.disabled}
        style={({ pressed }) => [styles.rowButton, m.style, fill, pressed && styles.rowPressed, m.disabled && styles.pressed]}>
        <View style={styles.rowButtonContent}>{children}</View>
      </Pressable>,
    );
  }
  return (
    <Pressable
      onPress={() => {
        closeMenu?.();
        onPress?.();
      }}
      disabled={m.disabled}
      style={({ pressed }) => [
        styles.button,
        asRow && styles.actionRow,
        closeMenu && styles.menuItem,
        large && styles.buttonLarge,
        (filled || tonal) && styles.buttonPill,
        tonal && { backgroundColor: colors.fill },
        filled && { backgroundColor: tint as string },
        m.style,
        fill,
        (pressed || m.disabled) && styles.pressed,
      ]}>
      {systemImage ? <SymbolView name={systemImage} size={large ? 19 : 17} tintColor={filled ? '#FFFFFF' : color} /> : null}
      {label ? <RNText style={[styles.text, { color: filled ? '#FFFFFF' : color }, large && styles.textLarge, m.text]}>{label}</RNText> : null}
      {children}
    </Pressable>
  );
}

export function Toggle({ label, isOn, onIsOnChange, modifiers, children }: Mods & WithChildren & { label?: string; isOn?: boolean; onIsOnChange?: (on: boolean) => void }) {
  const m = resolve(modifiers);
  const tint = useTint(m.tint) as string;
  return (
    <View style={[styles.listRow, m.style]}>
      <View style={styles.rowLabel}>
        {label ? <RNText style={[styles.text, m.text]}>{label}</RNText> : <CellContext.Provider value="inside">{children}</CellContext.Provider>}
      </View>
      <Switch value={!!isOn} onValueChange={onIsOnChange} disabled={m.disabled} trackColor={{ true: tint, false: colors.fill }} thumbColor="#FFFFFF" />
    </View>
  );
}

/**
 * Сегмент iOS 26 на RN: капсула-дорожка и скользящий ползунок. Нативная вставка SwiftUI
 * стоила десятки миллисекунд на каждом переходе, а сегмент обычно стоит вверху экрана —
 * подменять его после въезда нельзя.
 */
function IosSegmented({ labels, index, disabled, style, onSelect }: { labels: string[]; index: number; disabled?: boolean; style?: StyleProp<ViewStyle>; onSelect: (index: number) => void }) {
  // Ширина сегментов — по подписям, как у системного: «Предстоящие · 3» не режется ради «Старые».
  const [frames, setFrames] = useState<{ x: number; width: number }[]>([]);
  const target = frames[index];
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const placed = useSharedValue(false);
  useEffect(() => {
    if (!target) return;
    // Первое размещение — без анимации, дальше ползунок едет пружиной.
    if (!placed.get()) {
      x.set(target.x);
      width.set(target.width);
      placed.set(true);
      return;
    }
    const spring = { damping: 26, stiffness: 320, mass: 0.8 };
    x.set(withSpring(target.x, spring));
    width.set(withSpring(target.width, spring));
  }, [target, x, width, placed]);
  const thumb = useAnimatedStyle(() => ({ width: width.get(), transform: [{ translateX: x.get() }] }));
  // Четыре сегмента («Остатки / Закупки / Ревизии / Расходы») на узком экране — поля уже.
  const { layout } = useTextLayout();
  const crowded = labels.length >= 4 || layout !== 'regular';
  return (
    <View style={[styles.iosSegments, disabled && styles.pressed, style]}>
      {target ? <Animated.View style={[styles.iosThumb, thumb]} /> : null}
      {labels.map((text, i) => (
        <Pressable
          key={i}
          disabled={disabled}
          onPress={() => i !== index && onSelect(i)}
          onLayout={(event) => {
            const { x: left, width: w } = event.nativeEvent.layout;
            setFrames((prev) => {
              if (prev[i]?.x === left && prev[i]?.width === w) return prev;
              const next = [...prev];
              next[i] = { x: left, width: w };
              return next;
            });
          }}
          style={[styles.iosSegment, crowded && styles.iosSegmentCrowded]}
          accessibilityRole="tab"
          accessibilityState={{ selected: i === index }}>
          {/* Не влезают — подписи ужимаются, а не режутся до «Оста…» («Увеличенный» вид, крупный текст). */}
          <RNText
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={FONT_SCALE_MAX.compact}
            style={[styles.iosSegmentText, i === index && styles.iosSegmentTextActive]}>
            {text}
          </RNText>
        </Pressable>
      ))}
    </View>
  );
}

const SEGMENT_PAD = 3;
/** Фон всплывающего меню: почти непрозрачный, как материал системных меню. */
const POPOVER_BG = IOS ? DynamicColorIOS({ light: 'rgba(250,250,252,0.98)', dark: 'rgba(40,40,42,0.98)' }) : colors.card;
/** Ползунок сегмента: белый в светлой теме, серый в тёмной — как у системного. */
const SEGMENT_THUMB = IOS ? DynamicColorIOS({ light: '#FFFFFF', dark: '#636366' }) : '#FFFFFF';

/** Собирает варианты выбора из детей: `<Text modifiers={[tag(value)]}>Подпись</Text>`. */
function readOptions(children: ReactNode): { value: unknown; label: ReactNode; systemImage?: string }[] {
  return Children.toArray(children)
    .filter((child): child is ReactElement<Mods & WithChildren> => isValidElement(child))
    // Вариант бывает Text (подпись — дети) и Label (подпись — title, как в SwiftUI-меню со значками).
    .map((child) => {
      const props = child.props as Mods & WithChildren & { title?: ReactNode; systemImage?: string };
      return { value: resolve(props.modifiers).tag, label: props.children ?? props.title, systemImage: props.systemImage };
    });
}

/** Подпись варианта строкой. */
const labelText = (label: ReactNode) => Children.toArray(label).join('');

export function Picker({ selection, onSelectionChange, options, modifiers, children, label }: Mods & WithChildren & {
  selection?: unknown;
  onSelectionChange?: (value: never) => void;
  options?: string[];
  label?: string;
}) {
  const m = resolve(modifiers);
  const tint = useTint(m.tint) as string;
  const items = options
    ? options.map((option, index) => ({ value: index, label: option }))
    : readOptions(children);
  const change = onSelectionChange as ((value: unknown) => void) | undefined;

  // Меню и колесо на телефоне одинаково неуместны — показываем выбор списком в модалке.
  const [open, setOpen] = useState(false);
  const { ref: popoverRef, anchor: popoverAnchor, open: openPopover, close: closePopover } = usePopover();
  // Сегмент — сама строка секции: как в SwiftUI-форме, с отступами ячейки, а не впритык к краям.
  const inCell = useContext(CellContext) === 'control';
  // С очень крупным текстом значение встаёт под подпись — как в «Настройках» iOS.
  const { stacked } = useTextLayout();
  // iOS: всплывающее меню выбора (RN) и сегмент iOS 26 на RN — без вставок SwiftUI.
  if (IOS && (m.pickerStyle === 'menu' || m.pickerStyle === 'wheel')) {
    const current = items.find((item) => item.value === selection);
    return (
      <>
        <Pressable
          ref={popoverRef}
          onPress={openPopover}
          disabled={m.disabled}
          style={({ pressed }) => [styles.listRow, stacked && styles.listRowStacked, m.style, pressed && styles.rowPressed, m.disabled && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityValue={{ text: labelText(current?.label) }}>
          {label ? <RNText style={[styles.text, stacked ? styles.stackedLabel : styles.rowLabel]}>{label}</RNText> : <View style={styles.rowLabel} />}
          <View style={styles.row}>
            <RNText style={[styles.text, { color: tint }]}>{current?.label ?? ''}</RNText>
            <SymbolView name="chevron.up.chevron.down" size={12} weight="semibold" tintColor={tint} />
          </View>
        </Pressable>
        <PopoverMenu
          anchor={popoverAnchor}
          onClose={closePopover}
          checks
          items={items.map((item) => ({ label: labelText(item.label), systemImage: (item as { systemImage?: string }).systemImage, checked: item.value === selection, onPress: () => change?.(item.value) }))}
        />
      </>
    );
  }
  if (IOS && m.pickerStyle === 'segmented') {
    return <IosSegmented labels={items.map((item) => Children.toArray(item.label).join(''))} index={items.findIndex((item) => item.value === selection)} disabled={m.disabled} style={[inCell && styles.segmentInCell, m.style]} onSelect={(index) => change?.(items[index]?.value)} />;
  }
  if (m.pickerStyle === 'menu' || m.pickerStyle === 'wheel') {
    const current = items.find((item) => item.value === selection);
    return (
      <>
        <Pressable style={[styles.listRow, m.style]} onPress={() => setOpen(true)} disabled={m.disabled}>
          {label ? <RNText style={[styles.text, styles.rowLabel]}>{label}</RNText> : null}
          <RNText style={[styles.text, { color: tint }]}>{current?.label ?? '—'}</RNText>
          <SymbolView name="chevron.up.chevron.down" size={13} tintColor={colors.tertiaryLabel} />
        </Pressable>
        <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
          {items.map((item, index) => (
            <Pressable
              key={index}
              style={styles.listRow}
              onPress={() => { change?.(item.value); setOpen(false); }}>
              <RNText style={[styles.text, styles.rowLabel]}>{item.label}</RNText>
              {item.value === selection ? <SymbolView name="checkmark" size={16} tintColor={tint} /> : null}
            </Pressable>
          ))}
        </Sheet>
      </>
    );
  }

  // inline — как в SwiftUI-форме: варианты строками, выбранный отмечен галочкой.
  // Раньше рисовался сегмент, и пять вечеров при открытии смены сжимались до «Спортивн…».
  if (m.pickerStyle === 'inline') {
    return (
      <View style={m.style}>
        {items.map((item, index) => {
          const active = item.value === selection;
          return (
            <View key={index}>
              {index > 0 ? <View style={styles.separator} /> : null}
              <Pressable
                disabled={m.disabled}
                onPress={() => change?.(item.value)}
                style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}>
                <RNText style={[styles.text, styles.rowLabel]}>{item.label}</RNText>
                {active ? <SymbolView name="checkmark" size={17} tintColor={tint} /> : null}
              </Pressable>
            </View>
          );
        })}
      </View>
    );
  }

  // segmented — как UISegmentedControl: подсвеченная «таблетка» внутри дорожки.
  return (
    <View style={[styles.segments, inCell && styles.segmentInCell, m.style]}>
      {items.map((item, index) => {
        const active = item.value === selection;
        return (
          <Pressable
            key={index}
            disabled={m.disabled}
            onPress={() => change?.(item.value)}
            style={[styles.segment, active && styles.segmentActive]}>
            <RNText
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
              maxFontSizeMultiplier={FONT_SCALE_MAX.compact}
              style={[styles.segmentText, active && { color: tint, fontWeight: '600' }]}>
              {item.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Дни месяца, выровненные по неделям с понедельника; null — пустые клетки. */
function monthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type DateRange = { start?: Date; end?: Date };

/** Высота строки в колонках часов и минут — по ней прокручиваем к выбранному значению. */
const TIME_CELL = 44;

/**
 * Выбор даты и/или времени. Нативный Compose-диалог требует особой границы композиции и
 * внутри обычного дерева RN падает с MissingHostException, поэтому выбор свой.
 *
 * Раньше при `['date', 'hourAndMinute']` показывался только календарь: время начала
 * мероприятия и аренды зоны на Android поменять было нельзя. Теперь календарь и время
 * в одной шторке, а `range` ограничивает выбор, как в SwiftUI.
 */
export function DatePicker({ title, selection, displayedComponents = 'date', onDateChange, modifiers, range }: Mods & {
  title?: string;
  selection?: Date | null;
  displayedComponents?: 'date' | 'hourAndMinute' | 'dateAndTime' | ('date' | 'hourAndMinute' | 'dateAndTime')[];
  onDateChange?: (date: Date) => void;
  range?: DateRange;
}) {
  const m = resolve(modifiers);
  const tint = useTint(m.tint) as string;
  const [open, setOpen] = useState(false);
  const kinds = Array.isArray(displayedComponents) ? displayedComponents : [displayedComponents];
  const withDate = kinds.includes('date') || kinds.includes('dateAndTime');
  const withTime = kinds.includes('hourAndMinute') || kinds.includes('dateAndTime');
  const value = selection ?? new Date();
  const [shownMonth, setShownMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const { stacked } = useTextLayout();
  if (HAS_ISLANDS) {
    // iOS: плашки как у компактного DatePicker; нативный календарь или колесо создаются
    // только в открытой панели — вставка SwiftUI не стоит ничего при переходе на экран.
    const components = kinds.flatMap((kind): ('date' | 'hourAndMinute')[] => (kind === 'dateAndTime' ? ['date', 'hourAndMinute'] : [kind]));
    const pill = (text: string, part: string) => (
      <Pressable
        onPress={() => setOpen(true)}
        disabled={m.disabled}
        style={({ pressed }) => [styles.datePill, (pressed || m.disabled) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${title ?? ''} ${part}: ${text}`}>
        <RNText style={[styles.text, open && { color: tint }]}>{text}</RNText>
      </Pressable>
    );
    return (
      <View style={[styles.listRow, stacked && styles.listRowStacked, m.style]}>
        {title ? <RNText style={[styles.text, stacked ? styles.stackedLabel : styles.rowLabel]}>{title}</RNText> : <View style={styles.rowLabel} />}
        <View style={[styles.row, styles.wrapRow]}>
          {components.includes('date') ? pill(value.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }), 'дата') : null}
          {components.includes('hourAndMinute') ? pill(value.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), 'время') : null}
        </View>
        <DateSheet visible={open} title={title} components={components} value={value} range={range} tint={tint} onChange={onDateChange} onClose={() => setOpen(false)} />
      </View>
    );
  }

  const time = value.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const shown = !withDate
    ? time
    : withTime
      ? `${value.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${time}`
      : value.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  const clamp = (date: Date) => {
    if (range?.start && date < range.start) return new Date(range.start);
    if (range?.end && date > range.end) return new Date(range.end);
    return date;
  };
  const dayDisabled = (day: number) => {
    const from = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day);
    const to = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day, 23, 59, 59, 999);
    return (!!range?.start && to < range.start) || (!!range?.end && from > range.end);
  };

  const pickDay = (day: number) => {
    const next = new Date(value);
    next.setFullYear(shownMonth.getFullYear(), shownMonth.getMonth(), day);
    onDateChange?.(clamp(next));
    if (!withTime) setOpen(false);
  };
  const pickTime = (hours: number, minutes: number) => {
    const next = new Date(value);
    next.setHours(hours, minutes, 0, 0);
    onDateChange?.(clamp(next));
  };

  // Минуты — шагом 5, плюс текущее значение, если оно между шагами (например, 18:37).
  const minutes = Array.from({ length: 12 }, (_, index) => index * 5);
  if (!minutes.includes(value.getMinutes())) {
    minutes.push(value.getMinutes());
    minutes.sort((a, b) => a - b);
  }

  return (
    <View style={[styles.listRow, m.style]}>
      {title ? <RNText style={[styles.text, styles.rowLabel]}>{title}</RNText> : null}
      <Pressable onPress={() => { setShownMonth(new Date(value.getFullYear(), value.getMonth(), 1)); setOpen(true); }} disabled={m.disabled} style={styles.dateValue}>
        <RNText style={[styles.text, { color: tint }]}>{shown}</RNText>
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        {withDate ? (
          <View style={styles.calendar}>
            <View style={styles.calendarHead}>
              <Pressable
                hitSlop={12}
                onPress={() => setShownMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}>
                <SymbolView name="chevron.left" size={18} tintColor={tint} />
              </Pressable>
              <RNText style={[styles.text, styles.calendarTitle]}>
                {`${MONTHS[shownMonth.getMonth()]} ${shownMonth.getFullYear()}`}
              </RNText>
              <Pressable
                hitSlop={12}
                onPress={() => setShownMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}>
                <SymbolView name="chevron.right" size={18} tintColor={tint} />
              </Pressable>
            </View>
            <View style={styles.calendarRow}>
              {WEEKDAYS.map((day) => (
                <RNText key={day} style={styles.weekday} maxFontSizeMultiplier={FONT_SCALE_MAX.compact}>
                  {day}
                </RNText>
              ))}
            </View>
            <View style={styles.calendarGrid}>
              {monthGrid(shownMonth.getFullYear(), shownMonth.getMonth()).map((day, index) => {
                const chosen =
                  day != null &&
                  value.getDate() === day &&
                  value.getMonth() === shownMonth.getMonth() &&
                  value.getFullYear() === shownMonth.getFullYear();
                const off = day != null && dayDisabled(day);
                return (
                  <Pressable
                    key={index}
                    disabled={day == null || off}
                    onPress={() => day != null && pickDay(day)}
                    style={styles.dayCell}>
                    {/* Кружок фиксированного размера: у ячейки ширина в процентах, и фон растягивался в овал. */}
                    <View style={[styles.dayDot, chosen && { backgroundColor: tint }]}>
                      <RNText maxFontSizeMultiplier={FONT_SCALE_MAX.compact} style={[styles.text, styles.dayText, off && styles.dayTextOff, chosen && styles.dayTextChosen]}>
                        {day ?? ''}
                      </RNText>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {withTime ? (
          <View style={[styles.timeColumns, withDate && styles.timeColumnsCompact]}>
            <ScrollView
              style={styles.timeColumn}
              contentContainerStyle={styles.timeColumnContent}
              contentOffset={{ x: 0, y: Math.max(0, (value.getHours() - 1) * TIME_CELL) }}>
              {Array.from({ length: 24 }, (_, hour) => (
                <Pressable key={hour} style={styles.timeCell} onPress={() => pickTime(hour, value.getMinutes())}>
                  <RNText maxFontSizeMultiplier={FONT_SCALE_MAX.compact} style={[styles.timeText, hour === value.getHours() && { color: tint, fontWeight: '700' }]}>
                    {String(hour).padStart(2, '0')}
                  </RNText>
                </Pressable>
              ))}
            </ScrollView>
            <RNText style={styles.timeColon}>:</RNText>
            <ScrollView
              style={styles.timeColumn}
              contentContainerStyle={styles.timeColumnContent}
              contentOffset={{ x: 0, y: Math.max(0, (minutes.indexOf(value.getMinutes()) - 1) * TIME_CELL) }}>
              {minutes.map((minute) => (
                <Pressable key={minute} style={styles.timeCell} onPress={() => pickTime(value.getHours(), minute)}>
                  <RNText maxFontSizeMultiplier={FONT_SCALE_MAX.compact} style={[styles.timeText, minute === value.getMinutes() && { color: tint, fontWeight: '700' }]}>
                    {String(minute).padStart(2, '0')}
                  </RNText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {withTime ? (
          <Pressable onPress={() => setOpen(false)} style={({ pressed }) => [styles.sheetDone, { backgroundColor: tint }, pressed && styles.pressed]}>
            <RNText style={styles.sheetDoneText}>Готово</RNText>
          </Pressable>
        ) : null}
      </Sheet>
    </View>
  );
}

type FieldProps = Mods & {
  text?: { value: string } | string;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  allowNewlines?: boolean;
  maxLength?: number;
  axis?: 'horizontal' | 'vertical';
  onTextChange?: (text: string) => void;
  onFocusChange?: (focused: boolean) => void;
};

function Field({ secure, ...props }: FieldProps & { secure?: boolean }) {
  const m = resolve(props.modifiers);
  const tint = useTint(m.tint) as string;
  // `text` бывает обычной строкой и наблюдаемым состоянием из useNativeState.
  const bound = typeof props.text === 'object' && props.text !== null ? props.text : null;
  const initial = bound ? bound.value : (typeof props.text === 'string' ? props.text : props.defaultValue);
  const [value, setValue] = useState(initial ?? '');
  const focus = useAutoFocus(!!props.autoFocus);
  // В строке, где отступы уже есть (TextRow, поиск), поле без своих — иначе строка двоится.
  const inRow = useContext(CellContext) === 'inside';
  // Обратно в наблюдаемое состояние не пишем: в SwiftUI биндинг задаёт полю начальное
  // значение, а дальше текст уходит через onTextChange — так он и используется в проекте.
  return (
    <TextInput
      style={[styles.input, inRow && styles.inputInRow, m.text, m.style]}
      value={value}
      placeholder={props.placeholder}
      placeholderTextColor={colors.tertiaryLabel}
      {...focus}
      editable={!m.disabled}
      multiline={props.multiline || props.axis === 'vertical'}
      numberOfLines={props.numberOfLines}
      maxLength={props.maxLength}
      onFocus={() => props.onFocusChange?.(true)}
      onBlur={() => props.onFocusChange?.(false)}
      secureTextEntry={secure}
      selectionColor={tint}
      keyboardType={m.keyboardType}
      autoCorrect={m.autocorrect}
      autoCapitalize={m.autocapitalize}
      returnKeyType={m.submitLabel === 'done' ? 'done' : m.submitLabel === 'search' ? 'search' : 'default'}
      onSubmitEditing={m.onSubmit}
      onChangeText={(next) => {
        setValue(next);
        props.onTextChange?.(next);
      }}
    />
  );
}

export const TextField = (props: FieldProps) => <Field {...props} />;
export const SecureField = (props: FieldProps) => <Field {...props} secure />;

export function ColorPicker({ selection, onSelectionChange, label, modifiers, supportsOpacity }: Mods & {
  selection?: string;
  supportsOpacity?: boolean;
  label?: string;
  onSelectionChange?: (color: string) => void;
}) {
  const m = resolve(modifiers);
  const [open, setOpen] = useState(false);
  const settled = useSettled();
  if (HAS_ISLANDS) {
    return (
      <View style={[styles.listRow, m.style]}>
        {label ? <RNText style={[styles.text, styles.rowLabel]}>{label}</RNText> : <View style={styles.rowLabel} />}
        {settled ? (
          <ColorIsland selection={selection ?? null} onSelectionChange={onSelectionChange} supportsOpacity={supportsOpacity} />
        ) : (
          <View style={[styles.swatch, { backgroundColor: selection ?? colors.accent }]} />
        )}
      </View>
    );
  }
  // Значение уезжает на сервер строкой, поэтому палитра — фиксированные hex, а не PlatformColor.
  const palette = ['#7C5CFF', '#0A84FF', '#30B0C7', '#34C759', '#FF9F0A', '#FF453A', '#FF375F', '#5E5CE6', '#8E8E93'];
  return (
    <>
      <Pressable style={[styles.listRow, m.style]} onPress={() => setOpen(true)}>
        {label ? <RNText style={[styles.text, styles.rowLabel]}>{label}</RNText> : <View style={styles.rowLabel} />}
        <View style={[styles.swatch, { backgroundColor: selection ?? colors.accent }]} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? 'Цвет'}>
        <View style={styles.palette}>
          {palette.map((color) => (
            <Pressable key={color} onPress={() => { onSelectionChange?.(color); setOpen(false); }}>
              <View style={[styles.swatchLarge, { backgroundColor: color }, selection === color && styles.swatchActive]} />
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  );
}

// ——— списки ———

/**
 * SwiftUI Form — прокручиваемый сгруппированный список. Раньше здесь был простой View:
 * на Android шторка смены и форма входа не прокручивались, а секции липли к краям.
 */
/** Сколько секций длинной формы рисуется сразу (аналитика — ~12 секций, это ~140 мс). */
const FIRST_SECTIONS = 4;

export function Form({ children, modifiers }: Mods & WithChildren) {
  const m = resolve(modifiers);
  // Секции ниже края экрана дорисовываются после въезда — как длинные списки в Section.
  const sections = Children.toArray(children);
  const long = sections.length > FIRST_SECTIONS;
  const settled = useSettled(long);
  // Форма в разделе прокручивается под плавающей панелью вкладок — последняя секция над ней.
  const tabBar = useTabBarClearance();
  return (
    <ScrollView
      style={[styles.list, !m.hideScrollBackground && styles.formBackground]}
      contentContainerStyle={[styles.form, tabBar > 0 && { paddingBottom: tabBar + space.xl }, m.style]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={IOS ? 'interactive' : 'on-drag'}
      // iOS: содержимое уходит под стеклянную шапку и панель вкладок, крупный заголовок
      // сворачивается при прокрутке, поле ввода не прячется за клавиатурой.
      contentInsetAdjustmentBehavior={IOS ? 'automatic' : undefined}
      automaticallyAdjustKeyboardInsets={IOS}
      refreshControl={m.refresh ? <Refresher onRefresh={m.refresh} /> : undefined}>
      {long && !settled ? sections.slice(0, FIRST_SECTIONS) : sections}
    </ScrollView>
  );
}

/** Индикатор обновления, который сам крутится, пока идёт `refreshable`. */
function Refresher({ onRefresh, ...rest }: { onRefresh: () => Promise<void> | void }) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <RefreshControl
      {...rest}
      refreshing={refreshing}
      colors={[colors.accent]}
      onRefresh={async () => {
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
        }
      }}
    />
  );
}

/** Сколько строк длинной секции рисуется сразу — остальные после въезда экрана. */
const FIRST_ROWS = 12;

export function Section({ title, footer, children, modifiers }: Mods & WithChildren & { title?: string; footer?: ReactNode }) {
  const m = resolve(modifiers);
  // Длинные списки (клиенты, товары) монтировались целиком прямо в анимации перехода.
  // Первые строки видны сразу, остальные ниже края экрана дорисовываются после въезда.
  const rows = rowsOf(children);
  const long = rows.length > FIRST_ROWS;
  const settled = useSettled(long);
  return (
    <View style={[styles.section, m.style]}>
      {title ? <RNText style={styles.sectionTitle}>{IOS ? title : title.toUpperCase()}</RNText> : null}
      <View style={styles.card}>{separated(long && !settled ? rows.slice(0, FIRST_ROWS) : rows)}</View>
      {footer ? (
        <View style={styles.sectionFooter}>
          {typeof footer === 'string' ? <RNText style={styles.footnote}>{footer}</RNText> : <FootnoteContext.Provider value>{footer}</FootnoteContext.Provider>}
        </View>
      ) : null}
    </View>
  );
}

type ForEachProps = WithChildren & {
  /** Как SwiftUI onMove: индексы источников и место вставки в исходном массиве. */
  onMove?: (sources: number[], destination: number) => void;
  onDelete?: (indices: number[]) => void;
};

/**
 * `List.ForEach` с перестановкой. На Android перетаскивания SwiftUI нет — строки
 * двигаются стрелками «выше / ниже». Раньше List.ForEach не существовал вовсе, и
 * экран «Порядок категорий» падал при открытии.
 */
function ForEach({ children, onMove, onDelete }: ForEachProps) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.card}>
      {rows.map((row, index) => (
        <View key={isValidElement(row) && row.key != null ? row.key : index}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <View style={styles.moveRow}>
            <View style={styles.rowLabel}>{row}</View>
            {onDelete ? (
              <Pressable hitSlop={8} onPress={() => onDelete([index])} accessibilityRole="button" accessibilityLabel="Удалить">
                <SymbolView name="minus.circle.fill" size={22} tintColor={colors.red} />
              </Pressable>
            ) : null}
            {onMove ? (
              <>
                <Pressable
                  hitSlop={6}
                  disabled={index === 0}
                  onPress={() => onMove([index], index - 1)}
                  style={({ pressed }) => [styles.moveButton, (pressed || index === 0) && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Выше">
                  <SymbolView name="chevron.up" size={16} tintColor={index === 0 ? colors.tertiaryLabel : colors.label} />
                </Pressable>
                <Pressable
                  hitSlop={6}
                  disabled={index === rows.length - 1}
                  onPress={() => onMove([index], index + 2)}
                  style={({ pressed }) => [styles.moveButton, (pressed || index === rows.length - 1) && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Ниже">
                  <SymbolView name="chevron.down" size={16} tintColor={index === rows.length - 1 ? colors.tertiaryLabel : colors.label} />
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function List({ children, modifiers, style }: Mods & WithChildren & { style?: StyleProp<ViewStyle> }) {
  const m = resolve(modifiers);
  const inset = m.listStyle !== 'plain';
  const tabBar = useTabBarClearance();
  return (
    <ScrollView
      style={[styles.list, !m.hideScrollBackground && styles.formBackground, style]}
      contentContainerStyle={[styles.listContent, inset && styles.listInset, tabBar > 0 && { paddingBottom: tabBar + space.xl }]}
      contentInsetAdjustmentBehavior={IOS ? 'automatic' : undefined}
      refreshControl={m.refresh ? <Refresher onRefresh={m.refresh} /> : undefined}>
      {children}
    </ScrollView>
  );
}

List.ForEach = ForEach;

type SwipeGroupProps = WithChildren & { edge?: 'leading' | 'trailing'; allowsFullSwipe?: boolean };

/** Слот действий: сам ничего не рисует, его кнопки читает SwipeActions. */
function SwipeActionsGroup(_props: SwipeGroupProps) {
  return null;
}

/**
 * Действия смахиванием строки. На Android — первое действие справа тем же свайпом влево
 * (RN Swipeable): «Удалить черновик», «Убрать позицию». Без действий — просто строка.
 */
function SwipeActionsView({ children }: WithChildren) {
  const parts = Children.toArray(children);
  const isGroup = (child: ReactNode): child is ReactElement<SwipeGroupProps> => isValidElement(child) && child.type === SwipeActionsGroup;
  const group = parts.filter(isGroup).find((g) => (g.props.edge ?? 'trailing') === 'trailing');
  const action = group ? Children.toArray(group.props.children).find((c): c is ReactElement<{ label?: string; onPress?: () => void }> => isValidElement(c)) : undefined;
  const body = parts.filter((child) => !isGroup(child)).map((child, index) => cellChild(child, index));
  if (!action) return <>{body}</>;
  return (
    <SwipeToDelete enabled label={action.props.label ?? 'Удалить'} onDelete={() => action.props.onPress?.()}>
      <View style={styles.swipeRow}>{body}</View>
    </SwipeToDelete>
  );
}

export const SwipeActions = Object.assign(SwipeActionsView, { Actions: SwipeActionsGroup });

export function LabeledContent({ label, children, modifiers }: Mods & WithChildren & { label?: string }) {
  const m = resolve(modifiers);
  const { stacked } = useTextLayout();
  return (
    <View style={[styles.listRow, stacked && styles.listRowStacked, m.style]}>
      <RNText style={[styles.text, stacked ? styles.stackedLabel : styles.rowLabel]}>{label}</RNText>
      <CellContext.Provider value="inside">
        <View style={styles.row}>{children}</View>
      </CellContext.Provider>
    </View>
  );
}

type MenuAction = { label: string; systemImage?: string; role?: string; onPress?: () => void };

/** Кнопки меню, включая вложенные во фрагменты и условия — для всплывающего меню iOS. */
function menuActions(children: ReactNode): MenuAction[] {
  const out: MenuAction[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { children?: ReactNode; label?: string; systemImage?: string; role?: string; onPress?: () => void };
    if (child.type === Fragment) out.push(...menuActions(props.children));
    else if (props.label) out.push({ label: props.label, systemImage: props.systemImage, role: props.role, onPress: props.onPress });
  });
  return out;
}

export function Menu({ label, systemImage, children, modifiers }: Mods & WithChildren & { label?: string; systemImage?: string }) {
  const m = resolve(modifiers);
  const tint = useTint(m.tint) as string;
  const [open, setOpen] = useState(false);
  const { ref: popoverRef, anchor: popoverAnchor, open: openPopover, close: closePopover } = usePopover();
  // glassProminent / borderedProminent + круглая форма — заметная круглая кнопка «+», как в iOS.
  const prominent = m.buttonStyle === 'glassProminent' || m.buttonStyle === 'borderedProminent';
  const round = prominent && (m.borderShape === 'circle' || m.labelStyle === 'iconOnly');
  const large = m.controlSize === 'large' || m.controlSize === 'extraLarge';
  const iconColor = prominent ? '#FFFFFF' : tint;
  return (
    <>
      <Pressable
        ref={popoverRef}
        onPress={IOS ? openPopover : () => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          round ? [styles.roundButton, large && styles.roundButtonLarge] : styles.button,
          prominent && { backgroundColor: tint },
          prominent && IOS && styles.prominentShadow,
          m.style,
          pressed && styles.pressed,
        ]}>
        {systemImage ? <SymbolView name={systemImage} size={large ? 22 : 19} tintColor={iconColor} /> : null}
        {label && !systemImage ? <RNText style={[styles.text, { color: iconColor }]}>{label}</RNText> : null}
      </Pressable>
      {IOS ? (
        <PopoverMenu
          anchor={popoverAnchor}
          onClose={closePopover}
          items={menuActions(children).map((action) => ({ label: action.label, systemImage: action.systemImage, destructive: action.role === 'destructive', onPress: action.onPress }))}
        />
      ) : null}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <MenuCloseContext.Provider value={() => setOpen(false)}>{separated(rowsOf(children))}</MenuCloseContext.Provider>
      </Sheet>
    </>
  );
}

export function ProgressView({ modifiers }: Mods & { value?: number; total?: number }) {
  const m = resolve(modifiers);
  const root = useCellRoot();
  return <ActivityIndicator color={(useTint(m.tint) as string) ?? colors.accent} style={[root && styles.cell, m.style]} />;
}

export function ContentUnavailableView({ title, systemImage, description, modifiers }: Mods & { title?: string; systemImage?: string; description?: string }) {
  const m = resolve(modifiers);
  return (
    <View style={[styles.unavailable, m.style]}>
      {systemImage ? <SymbolView name={systemImage} size={48} tintColor={colors.tertiaryLabel} /> : null}
      {title ? <RNText style={styles.unavailableTitle}>{title}</RNText> : null}
      {description ? <RNText style={styles.unavailableText}>{description}</RNText> : null}
    </View>
  );
}

// ——— графики ———

type ChartPoint = { x: string | number; y: number; color?: ColorValue };

type ChartProps = Mods & {
  type?: 'bar' | 'line' | 'pie' | 'area' | 'point';
  data?: ChartPoint[];
  animate?: boolean;
  showGrid?: boolean;
  barStyle?: { cornerRadius?: number };
  pieStyle?: { innerRadius?: number; angularInset?: number };
  lineStyle?: Record<string, unknown>;
  referenceLines?: ChartPoint[];
  ruleStyle?: Record<string, unknown>;
};

export function Chart(props: ChartProps) {
  const { type = 'bar', data = [], showGrid, barStyle, modifiers } = props;
  const m = resolve(modifiers);
  const settled = useSettled();
  if (HAS_ISLANDS) {
    const height = typeof m.style.height === 'number' ? m.style.height : 180;
    // Пока экран въезжает — пустое место той же высоты; график появится со своей анимацией.
    if (!settled) return <View style={{ height }} />;
    const { modifiers: _drop, ...chart } = props;
    return <ChartIsland {...chart} type={type} data={data} showGrid={showGrid} barStyle={barStyle} height={height} />;
  }
  const total = data.reduce((sum, point) => sum + Math.max(0, point.y), 0);

  // Круговую диаграмму на Android заменяет стековая полоса: те же доли и цвета,
  // а легенда на экранах аналитики уже нарисована рядом.
  if (type === 'pie') {
    return (
      <View style={[styles.stack, m.style]}>
        {data.map((point, index) => (
          <View key={index} style={{ flex: Math.max(0.0001, point.y / (total || 1)), backgroundColor: (point.color as string) ?? colors.accent }} />
        ))}
      </View>
    );
  }

  const max = data.reduce((peak, point) => Math.max(peak, point.y), 0) || 1;
  return (
    <View style={[styles.chart, m.style]}>
      {showGrid ? <View style={styles.grid}>{[0, 1, 2, 3].map((line) => <View key={line} style={styles.gridLine} />)}</View> : null}
      <View style={styles.bars}>
        {data.map((point, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              marginHorizontal: 1,
              height: `${Math.max(1, (point.y / max) * 100)}%`,
              borderRadius: barStyle?.cornerRadius ?? 3,
              backgroundColor: (point.color as string) ?? colors.accent,
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ——— состояние ———

export type ObservableState<T> = { value: T };

/** Двойник нативного биндинга SwiftUI: объект, чья запись в `.value` перерисовывает вьюху. */
export function useNativeState<T>(initialValue: T): ObservableState<T> {
  const [, bump] = useState(0);
  // Объект создаётся один раз: экраны передают его в поля как биндинг и ждут,
  // что запись в .value переживёт перерисовку.
  const [state] = useState<ObservableState<T>>(() => {
    let current = initialValue;
    return {
      get value() { return current; },
      set value(next: T) { current = next; bump((tick) => tick + 1); },
    };
  });
  return state;
}

// ——— вспомогательное ———

/** Сгруппированный список iOS: разделители между строками, но не после последней. */
type Row = { key: string; node: ReactNode };

/**
 * Строки секции: фрагменты `<>…</>` в SwiftUI прозрачны — каждая строка внутри отдельная.
 * Ключ — позиция в разметке (Children.toArray), а не номер среди видимых: иначе при
 * появлении условной строки соседние пересоздавались и теряли введённый текст.
 */
function rowsOf(children: ReactNode, prefix = ''): Row[] {
  const out: Row[] = [];
  Children.toArray(children).forEach((child, index) => {
    const key = prefix + (isValidElement(child) && child.key != null ? String(child.key) : `#${index}`);
    if (isValidElement(child) && child.type === Fragment) out.push(...rowsOf((child.props as WithChildren).children, `${key}/`));
    else if (child !== '') out.push({ key, node: child });
  });
  return out;
}

function separated(items: Row[]) {
  return items.map(({ key, node: child }, index) => (
    <View key={key}>
      {index > 0 ? <View style={[styles.separator, IOS && hasIcon(child) && styles.separatorAfterIcon]} /> : null}
      {cellChild(child)}
    </View>
  ));
}

/** Строка со значком-плашкой (LinkRow с icon): в iOS разделитель начинается от текста, а не от края. */
function hasIcon(child: ReactNode): boolean {
  return isValidElement(child) && !!(child.props as { icon?: unknown }).icon;
}

/**
 * Строка секции с отступами ячейки: стек или текст оборачиваем сразу, свой компонент-строку
 * помечаем 'root' — отступы возьмёт первый стек внутри него (см. CellContext).
 */
function cellChild(child: ReactNode, key?: number) {
  if (needsCellPadding(child)) {
    return (
      <CellContext.Provider key={key} value="inside">
        <View style={styles.cell}>{child}</View>
      </CellContext.Provider>
    );
  }
  // Контролы слоя сами рисуют строку с отступами — их подписи и дети уже «внутри».
  // 'control' — контрол и есть строка секции: кнопка-действие берёт высоту строки.
  const selfPadded = isValidElement(child) && SELF_PADDED.has(child.type as unknown);
  return (
    <CellContext.Provider key={key} value={selfPadded ? 'control' : 'root'}>
      {child}
    </CellContext.Provider>
  );
}

/** Контролы, которые сами рисуют строку ячейки. Поля ввода сюда не входят: одно поле в строке держит свои отступы. */
const SELF_PADDED = new Set<unknown>([Button, Toggle, Picker, DatePicker, ColorPicker, LabeledContent, Menu, ContentUnavailableView, Chart]);

/** Строки без собственных полей (стеки, текст) — в SwiftUI их отступы даёт ячейка. */
function needsCellPadding(child: ReactNode): boolean {
  if (!isValidElement(child)) return typeof child === 'string';
  return child.type === HStack || child.type === VStack || child.type === Text || child.type === Label || child.type === ProgressView;
}

type Anchor = { x: number; y: number; width: number; height: number };

/** Кнопка, открывающая всплывающее меню: где она на экране — туда меню и прикрепится. */
function usePopover() {
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const open = () => {
    haptic.selection();
    ref.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  };
  return { ref, anchor, open, close: () => setAnchor(null) };
}

type PopoverItem = { label: string; systemImage?: string; checked?: boolean; destructive?: boolean; onPress?: () => void };

const POPOVER_WIDTH = 250;
const POPOVER_ROW = 46;
/** Меню «вырастает» из кнопки: лёгкое увеличение и проявление, как контекстные меню iOS 26. */
const popIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.86 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: Easing.out(Easing.cubic) },
}).duration(180);

/**
 * Всплывающее меню iOS на RN — для выбора значения и меню действий. Раньше это были
 * вставки SwiftUI (Picker .menu, Menu): каждая стоила 50–100 мс на каждом переходе.
 * Выбранный вариант отмечен галочкой слева, значки — справа, как в системных меню.
 */
function PopoverMenu({ anchor, items, checks, onClose }: { anchor: Anchor | null; items: PopoverItem[]; checks?: boolean; onClose: () => void }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // Меню растёт вместе с текстом: строки выше, само меню шире (но не шире экрана).
  const rowHeight = useScaledSize(POPOVER_ROW, FONT_SCALE_MAX.text);
  const menuWidth = Math.min(screenWidth - 24, useScaledSize(POPOVER_WIDTH));
  if (!anchor) return null;
  const height = items.length * rowHeight;
  const below = anchor.y + anchor.height + 8 + height < screenHeight - 40;
  const top = below ? anchor.y + anchor.height + 6 : Math.max(56, anchor.y - height - 6);
  const left = Math.min(Math.max(12, anchor.x + anchor.width - menuWidth), screenWidth - menuWidth - 12);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрыть меню" />
      <Animated.View entering={popIn} style={[styles.popover, { top, left, width: menuWidth, transformOrigin: below ? 'top right' : 'bottom right' }]}>
        <View style={styles.popoverClip}>
          {items.map((item, index) => (
            <Pressable
              key={index}
              onPress={() => {
                onClose();
                item.onPress?.();
              }}
              style={({ pressed }) => [styles.popoverRow, { minHeight: rowHeight }, index > 0 && styles.popoverSeparator, pressed && styles.rowPressed]}
              accessibilityRole={checks ? 'radio' : 'button'}
              accessibilityState={checks ? { selected: !!item.checked } : undefined}>
              {checks ? <View style={styles.popoverCheck}>{item.checked ? <SymbolView name="checkmark" size={15} weight="semibold" tintColor={colors.label} /> : null}</View> : null}
              <RNText numberOfLines={2} style={[styles.popoverText, item.destructive && styles.destructiveText]}>
                {item.label}
              </RNText>
              {item.systemImage ? <SymbolView name={item.systemImage} size={17} tintColor={item.destructive ? colors.red : colors.label} /> : null}
            </Pressable>
          ))}
        </View>
      </Animated.View>
    </Modal>
  );
}

/**
 * Панель выбора даты на iOS: нативный календарь (или колесо для времени) в SwiftUI-вставке.
 * Вставка создаётся только при открытии — переход на экран с датами её не ждёт.
 */
function DateSheet({ visible, title, components, value, range, tint, onChange, onClose }: {
  visible: boolean;
  title?: string;
  components: ('date' | 'hourAndMinute')[];
  value: Date;
  range?: DateRange;
  tint: string;
  onChange?: (date: Date) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть" />
      <Animated.View entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))} style={[styles.dateSheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <View style={styles.dateSheetHead}>
          <RNText style={styles.dateSheetTitle} numberOfLines={1}>
            {title ?? ''}
          </RNText>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <RNText style={[styles.dateSheetDone, { color: tint }]}>Готово</RNText>
          </Pressable>
        </View>
        <DateIsland selection={value} displayedComponents={components} range={range} onDateChange={onChange} tintColor={tint} />
      </Animated.View>
    </Modal>
  );
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          {title ? <RNText style={styles.sheetTitle}>{title}</RNText> : null}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.label, fontSize: 17 },
  textLarge: { fontSize: 19 },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowLabel: { flex: 1 },
  spacer: { flexGrow: 1 },
  noShrink: { flexShrink: 0, maxWidth: '60%' },
  fillRow: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  fillColumn: { alignSelf: 'stretch' },
  greedyRow: { flexGrow: 1, flexShrink: 1 },
  shrink: { flexShrink: 1 },

  button: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.control },
  buttonLarge: { paddingVertical: space.md, justifyContent: 'center' },
  actionRow: { minHeight: IOS ? 52 : 48, paddingHorizontal: space.lg, borderRadius: 0 },
  buttonPill: { borderRadius: 999, paddingHorizontal: space.lg, justifyContent: 'center' },
  pressed: { opacity: 0.55 },
  rowButton: { paddingHorizontal: space.lg, paddingVertical: space.sm + 2, minHeight: IOS ? 52 : 48, justifyContent: 'center' },
  rowButtonContent: { flex: 1, justifyContent: 'center' },
  rowPressed: { backgroundColor: colors.fill },

  segments: { flexDirection: 'row', backgroundColor: colors.fill, borderRadius: 9, padding: 2 },
  segmentInCell: { marginHorizontal: space.lg, marginVertical: space.sm + 2 },
  iosSegments: { flexDirection: 'row', minHeight: 36, borderRadius: 18, padding: SEGMENT_PAD, backgroundColor: colors.fill },
  iosThumb: {
    position: 'absolute', top: SEGMENT_PAD, bottom: SEGMENT_PAD, left: 0, borderRadius: 15,
    backgroundColor: SEGMENT_THUMB, boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
  },
  iosSegment: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  iosSegmentCrowded: { paddingHorizontal: 6 },
  iosSegmentText: { fontSize: 14, fontWeight: '500', color: colors.label },
  iosSegmentTextActive: { fontWeight: '600' },
  datePill: { backgroundColor: colors.fill, borderRadius: 8, borderCurve: 'continuous', paddingHorizontal: 11, paddingVertical: 6 },
  popover: { position: 'absolute', borderRadius: 20, borderCurve: 'continuous', backgroundColor: POPOVER_BG, boxShadow: '0 12px 36px rgba(0,0,0,0.22)' },
  popoverClip: { borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden' },
  popoverRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, paddingVertical: space.sm, paddingHorizontal: space.lg - 2 },
  popoverSeparator: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  popoverCheck: { width: 18, alignItems: 'center' },
  popoverText: { flex: 1, fontSize: 17, color: colors.label },
  destructiveText: { color: colors.red },
  prominentShadow: { boxShadow: '0 4px 14px rgba(124,58,237,0.35)' },
  dateSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: space.md, paddingHorizontal: space.lg,
    backgroundColor: colors.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderCurve: 'continuous',
  },
  dateSheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingBottom: space.sm, paddingHorizontal: space.xs },
  dateSheetTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.label },
  dateSheetDone: { fontSize: 17, fontWeight: '600' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, borderRadius: 7 },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { fontSize: 14, color: colors.label },

  form: { gap: IOS ? space.xl + 4 : space.xl, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xxxl },
  formBackground: { backgroundColor: colors.groupedBackground },
  cellText: { paddingHorizontal: space.lg, paddingVertical: space.md + (IOS ? 3 : 0) },
  cell: { paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: IOS ? 52 : undefined, justifyContent: 'center' },
  menuItem: { paddingVertical: space.md, paddingHorizontal: space.lg },
  roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  roundButtonLarge: { width: 50, height: 50, borderRadius: 25 },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, minHeight: 52 },
  moveButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.fill },
  section: { gap: space.xs },
  // iOS 26: заголовок секции — крупный, полужирный, без капса; Android — мелкий капс Material.
  sectionTitle: IOS
    ? { color: colors.secondaryLabel, fontSize: 17, fontWeight: '600', marginLeft: space.lg, marginBottom: space.xs + 2 }
    : { color: colors.secondaryLabel, fontSize: 12, letterSpacing: 0.6, marginLeft: space.lg, marginBottom: space.xs },
  sectionFooter: { marginHorizontal: space.lg, marginTop: IOS ? space.xs + 2 : space.xs },
  footnote: { color: colors.secondaryLabel, fontSize: 13 },
  card: { backgroundColor: colors.card, borderRadius: IOS ? 26 : radius.card, borderCurve: 'continuous', overflow: 'hidden' },
  swipeRow: { backgroundColor: colors.card },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: space.lg, marginRight: IOS ? space.lg : 0 },
  separatorAfterIcon: { marginLeft: space.lg + 30 + 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: IOS ? 52 : 48 },
  // Очень крупный текст: подпись сверху, значение под ней. У подписи в столбике свой стиль:
  // `flex: 1` из rowLabel в колонке без высоты схлопнул бы её до нуля.
  listRowStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: space.xs },
  stackedLabel: { alignSelf: 'stretch' },
  wrapRow: { flexWrap: 'wrap' },
  list: { flex: 1 },
  listContent: { paddingVertical: space.md, gap: space.xl },
  listInset: { paddingHorizontal: space.lg },

  // alignSelf: в столбике (подпись над полем при крупном тексте) поле — во всю ширину, как в SwiftUI.
  input: { color: colors.label, fontSize: 17, paddingVertical: space.md, paddingHorizontal: space.lg, flex: 1, alignSelf: 'stretch' },
  inputInRow: { paddingVertical: 0, paddingHorizontal: 0 },
  dateValue: { paddingVertical: space.xs },

  calendar: { paddingHorizontal: space.lg, gap: space.sm },
  calendarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm },
  calendarTitle: { fontWeight: '600' },
  calendarRow: { flexDirection: 'row' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', color: colors.secondaryLabel, fontSize: 12 },
  dayCell: { width: `${100 / 7}%`, height: 48, alignItems: 'center', justifyContent: 'center' },
  dayDot: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 16 },
  dayTextChosen: { color: '#FFFFFF', fontWeight: '700' },
  timeColumns: { flexDirection: 'row', alignItems: 'center', height: TIME_CELL * 5, paddingHorizontal: space.xxl, gap: space.md },
  timeColumnsCompact: { height: TIME_CELL * 3, marginTop: space.sm },
  timeColumn: { flex: 1, alignSelf: 'stretch' },
  timeColumnContent: { paddingVertical: space.xs },
  timeCell: { height: TIME_CELL, alignItems: 'center', justifyContent: 'center' },
  timeText: { color: colors.label, fontSize: 20, fontVariant: ['tabular-nums'] },
  timeColon: { color: colors.secondaryLabel, fontSize: 22, fontWeight: '600' },
  dayTextOff: { color: colors.tertiaryLabel },
  sheetDone: { marginHorizontal: space.lg, marginTop: space.lg, minHeight: 48, paddingVertical: space.sm, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sheetDoneText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  swatchLarge: { width: 44, height: 44, borderRadius: 22 },
  swatchActive: { borderWidth: 3, borderColor: colors.label },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center', paddingVertical: space.md },

  unavailable: { alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xxl },
  unavailableTitle: { color: colors.label, fontSize: 19, fontWeight: '600', textAlign: 'center' },
  unavailableText: { color: colors.secondaryLabel, fontSize: 15, textAlign: 'center' },

  chart: { flex: 1, minHeight: 120, justifyContent: 'flex-end' },
  grid: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'space-between' },
  gridLine: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: '100%' },
  stack: { flexDirection: 'row', height: 18, borderRadius: 9, overflow: 'hidden' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.groupedBackground, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, paddingVertical: space.lg, paddingBottom: space.xxxl },
  sheetTitle: { color: colors.secondaryLabel, fontSize: 13, textAlign: 'center', marginBottom: space.sm },
});

