import { BlurView } from 'expo-blur';
import { GlassContainer } from 'expo-glass-effect';
import { Link, useNavigation, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { makeImageFromView } from '@shopify/react-native-skia';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  LayoutAnimationConfig,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { AmbientBackdrop } from '@/components/ambient-backdrop';
import { BirthdaysBanner } from '@/components/birthdays-banner';
import { CheckCard, type CheckCardModel } from '@/components/check-card';
import { CheckPanel } from '@/components/check-panel';
import { Dissolve, type DissolveFrame } from '@/components/dissolve';
import { HEM_RADIUS, HEM_SPACE, HomeShade, useHomeShade } from '@/components/home/home-shade';
import { PrecheckCard } from '@/components/precheck-card';
import { Unavailable } from '@/components/unavailable';
import { cardLines, checkTitle, checkTotals, openedLabel } from '@/lib/checks';
import { createAccessoryScrollHandler } from '@/lib/chrome';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { SPLIT_MIN_WIDTH, useSplitLayout } from '@/lib/layout';
import { effectiveTextScale } from '@/lib/text-scale';
import { useTabBarClearance } from '@/lib/tab-bar';
import { checkNeedsAttention } from '@/lib/notifications';
import { usePosSelection } from '@/lib/pos-selection';
import { createCheckErrorMessage } from '@/lib/new-check';
import { chooseAction } from '@/lib/dialog';
import { openPrecheck, usePrechecks, type Precheck } from '@/lib/pos-api';
import { useChecks, useNotifications } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';
import type { AppNotification, CheckListItem } from '@/lib/types';
import { useNow } from '@/lib/use-now';

/** systemChromeMaterial — тинт UIKit: на Android expo-blur его не знает и подложка выходит пустой. */
const BLUR_TINT = Platform.OS === 'ios' ? 'systemChromeMaterial' : 'dark';

const LONG_STAY_MIN = 480;
const IS_PAD = Platform.OS === 'ios' && Platform.isPad;
/** С какой ширины окна касса делится на сетку и открытый чек (iPad, Split View). */
const GRID_PADDING = space.md - 2;
/** Высота плашки смены над таб-баром (bottom accessory iOS 26). */
const ACCESSORY_HEIGHT = 72;
/**
 * Самая узкая карточка чека в единицах текста (ширина / множитель шрифта). Уже — сетка
 * теряет колонку: на «Увеличенном» виде с крупным текстом карточки встают по одной.
 */
const CARD_MIN_TEXT_WIDTH = 145;
/** Карточка уже этого (в единицах текста) — плотная: меньше отступы, имя в две строки. */
const CARD_COMPACT_TEXT_WIDTH = 175;

/**
 * Новый чек появляется из точки. Закрытый рассыпается пылью, как удалённое сообщение
 * в Telegram (components/dissolve.tsx), а соседи встают на его место.
 */
const cardEntering: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.86 }] },
    animations: {
      opacity: withTiming(1, { duration: 220 }),
      transform: [{ scale: withSpring(1, { damping: 17, stiffness: 190 }) }],
    },
  };
};

const cardExiting: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withTiming(0, { duration: 160 }),
      transform: [{ scale: withTiming(0.9, { duration: 160 }) }],
    },
  };
};

/** Закрытая карточка: держим её в сетке, пока не сняли снимок для распыления. */
type DyingCard = { model: CheckCardModel; index: number };
type Ghost = { id: string; image: NonNullable<Awaited<ReturnType<typeof makeImageFromView>>>; frame: DissolveFrame };

/** Ячейка сетки: открытый чек или предчек (предчеки — после чеков). */
type GridItem = { kind: 'check'; key: string; model: CheckCardModel } | { kind: 'precheck'; key: string; precheck: Precheck };
/** Рамка ячейки внутри её ряда и номер ряда: пыль ложится по ним в координатах сетки. */
type CellFrame = DissolveFrame & { row: number };
/** Какие ячейки были в прошлой раскладке — анимацию появления получают только новые. */
type GridIds = { key: string; ids: ReadonlySet<string>; fresh: ReadonlySet<string> };

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

type TransitionEvents = {
  addListener: (type: 'transitionStart' | 'transitionEnd', callback: (e: { data: { closing: boolean } }) => void) => () => void;
};

function toModel(check: CheckListItem, notifications: AppNotification[] | undefined, now: number): CheckCardModel {
  const { lines, moreCount } = cardLines(check);
  const minutes = Math.floor((now - new Date(check.createdAt).getTime()) / 60_000);
  return {
    id: check.id,
    title: checkTitle(check),
    photoUrl: check.guestPhotoUrl,
    subtitle: check.spaceName,
    lines,
    moreCount,
    total: checkTotals(check, now).total,
    openedLabel: openedLabel(check, now),
    longStay: minutes >= LONG_STAY_MIN,
    hasRental: check.hasRental,
    attention: checkNeedsAttention(notifications, check),
  };
}

export default function PosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const checks = useChecks();
  const notifications = useNotifications();
  const prechecks = usePrechecks();
  const [openingPrecheck, setOpeningPrecheck] = useState<string | null>(null);
  const now = useNow(30_000);
  const [listWidth, setListWidth] = useState(0);
  // Ширина самого экрана, а не окна: на iPad пользователь может раскрыть боковую панель вкладок.
  const [screenWidth, setScreenWidth] = useState(0);
  // Индикатор — только когда кассир сам потянул список. Фоновые обновления (опрос, SSE)
  // идут молча: иначе системный спиннер сдвигает контент и касса дёргается.
  const [pulling, setPulling] = useState(false);
  const selectedId = usePosSelection((s) => s.selectedCheckId);
  const setSelectedId = usePosSelection((s) => s.select);
  const onAccessoryScroll = useRef(createAccessoryScrollHandler()).current;
  const scrolledRef = useRef(false);
  // Android: сетка прокручивается под плавающей панелью с плашкой смены.
  const tabBarClearance = useTabBarClearance(true);
  const topBlur = useSharedValue(0);
  // Свет и климат (Home Assistant): подол свёрнутой шторки лежит поверх кассы под строкой
  // состояния, шапка (и панель чека на iPad) опускается только на его видимую часть.
  const home = useHomeShade();
  const topSpace = insets.top + (home.ready ? HEM_SPACE : 0);

  const wide = screenWidth === 0 ? window.width : screenWidth;
  const split = useSplitLayout() && wide >= SPLIT_MIN_WIDTH;
  // Как в веб-кассе: узкая колонка не должна ломать карточки (iPad Slide Over, боковая панель).
  // Колонки считаются в единицах текста: «Увеличенный» вид и крупный текст оставляют карточке
  // меньше места под имя и сумму, и сетка переходит на одну колонку.
  const textScale = effectiveTextScale(window.fontScale);
  const maxColumns = listWidth >= 980 ? 4 : listWidth >= 620 ? 3 : 2;
  const fitColumns = Math.floor((listWidth - GRID_PADDING * 2) / (CARD_MIN_TEXT_WIDTH * textScale));
  const columns = Math.max(1, Math.min(maxColumns, fitColumns));
  const cellWidth = Math.floor((listWidth - GRID_PADDING * 2) / columns);
  const compactCards = cellWidth / textScale < CARD_COMPACT_TEXT_WIDTH;
  const unreadCount = (notifications.data ?? []).filter((n) => !n.isRead).length;
  const count = checks.data?.length ?? 0;

  const liveData = useMemo(() => (checks.data ?? []).map((c) => toModel(c, notifications.data, now)), [checks.data, notifications.data, now]);

  // Пока поверх кассы открыт чек, сетку не меняем: при закрытии чек должен свернуться
  // зумом обратно в свою карточку. Оплаченная карточка растворяется уже после возврата.
  const navigation = useNavigation() as unknown as TransitionEvents;
  const [frozen, setFrozen] = useState<CheckCardModel[] | null>(null);
  // Зум-переход на время прячет карточку-источник — стекло после него бывает пустым.
  // Каждый возврат в кассу заново применяет стекло карточек (components/glass.tsx).
  const [glassKey, setGlassKey] = useState(0);
  const freeze = useEffectEvent(() => setFrozen(liveData));
  const release = useEffectEvent(() => {
    setFrozen(null);
    setGlassKey((k) => k + 1);
  });
  useEffect(() => {
    const offStart = navigation.addListener('transitionStart', (e) => {
      if (e.data.closing) freeze();
    });
    const offEnd = navigation.addListener('transitionEnd', (e) => {
      if (!e.data.closing) release();
    });
    return () => {
      offStart();
      offEnd();
    };
  }, [navigation]);
  const data = frozen ?? liveData;

  // Исчезнувший из списка чек не убираем сразу: снимаем карточку, кладём поверх снимок,
  // который рассыпается, и только потом вынимаем её из сетки — соседи съезжают под пылью.
  const [dying, setDying] = useState<DyingCard[]>([]);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    const ids = new Set(data.map((m) => m.id));
    const gone = prevData.flatMap((model, index) => (ids.has(model.id) ? [] : [{ model, index }]));
    if (gone.length > 0 || dying.some((d) => ids.has(d.model.id))) {
      setDying((list) => [...list.filter((d) => !ids.has(d.model.id) && !gone.some((g) => g.model.id === d.model.id)), ...gone]);
    }
  }
  const shown = useMemo(() => {
    const out = [...data];
    for (const d of [...dying].sort((a, b) => a.index - b.index)) out.splice(Math.min(d.index, out.length), 0, d.model);
    return out;
  }, [data, dying]);
  const ghostIds = new Set(ghosts.map((g) => g.id));
  const dyingIds = new Set(dying.map((d) => d.model.id));

  const cellNodes = useRef(new Map<string, View>());
  const cellFrames = useRef(new Map<string, CellFrame>());
  // Верх каждого ряда в сетке: ячейка знает своё место только внутри ряда.
  const rowTops = useRef(new Map<number, number>());
  const snapping = useRef(new Set<string>());
  useEffect(() => {
    const frameInGrid = (id: string): DissolveFrame | null => {
      const cell = cellFrames.current.get(id);
      const rowTop = cell ? rowTops.current.get(cell.row) : undefined;
      if (!cell || rowTop === undefined) return null;
      return { x: cell.x, y: rowTop + cell.y, width: cell.width, height: cell.height };
    };
    const vanish = async (id: string) => {
      // Первый кадр отдаём сетке: карточка должна успеть отрисоваться на своём месте.
      await new Promise((r) => requestAnimationFrame(r));
      const node = cellNodes.current.get(id);
      const frame = frameInGrid(id);
      let image: Ghost['image'] | null = null;
      if (node && frame) image = await makeImageFromView({ current: node }).catch(() => null);
      if (image && frame) {
        setGhosts((list) => [...list, { id, image, frame }]);
        // Карточку вынимаем чуть позже: сначала читается пыль, потом соседи закрывают место.
        await new Promise((r) => setTimeout(r, 150));
      }
      setDying((list) => list.filter((d) => d.model.id !== id));
      snapping.current.delete(id);
    };
    for (const d of dying) {
      if (snapping.current.has(d.model.id)) continue;
      snapping.current.add(d.model.id);
      void vanish(d.model.id);
    }
  }, [dying]);

  const topBlurStyle = useAnimatedStyle(() => ({ opacity: topBlur.value }));

  const refresh = async () => {
    setPulling(true);
    await Promise.allSettled([checks.refetch(), notifications.refetch(), prechecks.refetch()]);
    setPulling(false);
  };

  const onOpenPrecheck = async (precheck: Precheck) => {
    setOpeningPrecheck(precheck.playerId);
    try {
      await openPrecheck(precheck);
    } catch (error) {
      haptic.error();
      Alert.alert('Чек не открыт', createCheckErrorMessage(error instanceof Error ? error.message : String(error)));
    } finally {
      setOpeningPrecheck(null);
    }
  };

  const precheckList = prechecks.data ?? [];

  // Сетка — явными рядами по `columns`: высоту ряда задаёт самая высокая карточка, а верх
  // следующего ряда — обычная раскладка. Анимации переезда (layout) нет: из-за неё ряды
  // оставались на старых местах, и подросшая карточка уходила под соседний ряд.
  const gridItems: GridItem[] = [
    ...shown.map((model) => ({ kind: 'check' as const, key: model.id, model })),
    ...precheckList.map((precheck) => ({ kind: 'precheck' as const, key: `pre-${precheck.playerId}`, precheck })),
  ];
  const gridRows = chunk(gridItems, columns);
  // Переехавшая в другой ряд карточка монтируется заново — появляется она без анимации,
  // «из точки» встают только новые чеки и предчеки.
  const gridKey = gridItems.map((item) => item.key).join('\n');
  const [gridIds, setGridIds] = useState<GridIds>({ key: '', ids: new Set(), fresh: new Set() });
  if (gridIds.key !== gridKey) {
    const ids = new Set(gridItems.map((item) => item.key));
    setGridIds({ key: gridKey, ids, fresh: new Set([...ids].filter((id) => !gridIds.ids.has(id))) });
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.titles}>
        <Text style={[type.largeTitle, styles.title]}>Касса</Text>
        <Text style={[type.subhead, styles.subtitle]}>
          {checks.isLoading
            ? 'Загружаем чеки…'
            : count === 0
              ? 'Открытых чеков нет'
              : `${count} ${plural(count, ['открытый чек', 'открытых чека', 'открытых чеков'])}`}
        </Text>
      </View>
      {/* Соседние стеклянные кнопки — в контейнере: при сближении система сливает их, как в iOS 26. */}
      <GlassContainer spacing={18} style={styles.headerActions}>
        <GlassView isInteractive style={styles.bell}>
          <Pressable
            style={styles.bellPress}
            onPress={() => {
              haptic.light();
              router.push({ pathname: '/tai', params: { screen: 'pos' } });
            }}
            accessibilityRole="button"
            accessibilityLabel="Спросить Tai">
            <SymbolView name="sparkles" size={19} weight="medium" tintColor={colors.accent} />
          </Pressable>
        </GlassView>
        <GlassView isInteractive style={styles.bell}>
          <Pressable
            style={styles.bellPress}
            onPress={() => {
              haptic.light();
              router.push('/pos/refunds');
            }}
            accessibilityRole="button"
            accessibilityLabel="Возвраты">
            <SymbolView name="arrow.uturn.backward" size={19} weight="medium" tintColor={colors.label} />
          </Pressable>
        </GlassView>
        <GlassView isInteractive style={styles.bell}>
          <Pressable
            style={styles.bellPress}
            onPress={() => {
              haptic.light();
              router.push('/notifications');
            }}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `Уведомления, новых: ${unreadCount}` : 'Уведомления'}>
            <SymbolView name={unreadCount > 0 ? 'bell.badge.fill' : 'bell'} size={21} tintColor={unreadCount > 0 ? colors.accent : colors.label} />
          </Pressable>
        </GlassView>
      </GlassContainer>
    </View>
  );

  const renderCard = (item: CheckCardModel) => {
    if (split) {
      return (
        <View style={[styles.fill, item.id === selectedId && styles.selected]}>
          <CheckCard
            model={item}
            glassKey={glassKey}
            compact={compactCards}
            onPress={() => {
              haptic.selection();
              setSelectedId(item.id);
            }}
          />
        </View>
      );
    }
    if (Platform.OS === 'android') {
      // Link.Preview и Link.Menu — жесты iOS: на Android долгое нажатие ничего не давало.
      // Те же быстрые действия — списком по долгому нажатию.
      return (
        <CheckCard
          model={item}
          glassKey={glassKey}
          compact={compactCards}
          onPress={() => {
            haptic.selection();
            router.push({ pathname: '/pos/[checkId]', params: { checkId: item.id } });
          }}
          delayLongPress={350}
          onLongPress={() => {
            haptic.medium();
            chooseAction(item.title, undefined, [
              { text: 'Добавить позицию', icon: 'plus.circle', onPress: () => router.push({ pathname: '/pos/menu', params: { checkId: item.id } }) },
              { text: 'Оплатить', icon: 'creditcard', onPress: () => router.push({ pathname: '/pay', params: { checkId: item.id } }) },
              ...(item.hasRental
                ? [{ text: 'Чат с кабинкой', icon: 'bubble.left', onPress: () => router.push({ pathname: '/chat', params: { checkId: item.id } }) }]
                : []),
              { text: 'Отмена', style: 'cancel' },
            ]);
          }}
        />
      );
    }
    return (
      <Link href={{ pathname: '/pos/[checkId]', params: { checkId: item.id } }} asChild>
        {/* Чек раскрывается из карточки и сворачивается обратно в неё (зум iOS 18+). */}
        <Link.Trigger withAppleZoom>
          <CheckCard model={item} glassKey={glassKey} compact={compactCards} />
        </Link.Trigger>
        <Link.Preview />
        <Link.Menu>
          {/* Чат есть только у чеков с арендованной кабинкой. */}
          {item.hasRental && (
            <Link.MenuAction icon="bubble.left" onPress={() => router.push({ pathname: '/chat', params: { checkId: item.id } })}>
              Чат с кабинкой
            </Link.MenuAction>
          )}
          <Link.MenuAction icon="plus.circle" onPress={() => router.push({ pathname: '/pos/menu', params: { checkId: item.id } })}>
            Добавить позицию
          </Link.MenuAction>
          <Link.MenuAction icon="creditcard" onPress={() => router.push({ pathname: '/pay', params: { checkId: item.id } })}>
            Оплатить
          </Link.MenuAction>
        </Link.Menu>
      </Link>
    );
  };

  const list = (
    <View style={styles.flex} onLayout={(e) => setListWidth(e.nativeEvent.layout.width)}>
      <Animated.ScrollView
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={[
          styles.content,
          { paddingTop: topSpace, paddingLeft: GRID_PADDING + insets.left, paddingRight: GRID_PADDING + insets.right },
          tabBarClearance > 0 && { paddingBottom: tabBarClearance + space.lg },
        ]}
        scrollEventThrottle={32}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          if (Platform.OS === 'android') onAccessoryScroll(y);
          // Анимацию размытия запускаем только при пересечении порога, а не на каждом событии.
          const blurred = y > 8;
          if (blurred !== scrolledRef.current) {
            scrolledRef.current = blurred;
            topBlur.set(withTiming(blurred ? 1 : 0, { duration: 160 }));
          }
        }}
        refreshControl={<RefreshControl tintColor={colors.accent} progressViewOffset={topSpace} refreshing={pulling} onRefresh={refresh} />}>
        {header}

        <BirthdaysBanner />

        {checks.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : data.length === 0 && precheckList.length === 0 ? (
          <View style={styles.empty}>
            <Unavailable
              title={checks.isError ? 'Нет связи с кассой' : 'Нет открытых чеков'}
              systemImage={checks.isError ? 'wifi.exclamationmark' : 'rublesign.circle'}
              description={checks.isError ? checks.error.message : IS_PAD ? 'Новый чек — кнопка в плашке смены внизу.' : 'Новый чек — кнопка «Новый» внизу.'}
            />
          </View>
        ) : null}

        {/* Первую загрузку не анимируем; дальше новые и закрытые чеки появляются и растворяются. */}
        {listWidth > 0 && !checks.isLoading && (
          <LayoutAnimationConfig skipEntering>
            <View>
              {gridRows.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.row} onLayout={(e) => rowTops.current.set(rowIndex, e.nativeEvent.layout.y)}>
                  {row.map((item) =>
                    item.kind === 'check' ? (
                      <Animated.View
                        key={item.key}
                        ref={(node: View | null) => {
                          if (node) cellNodes.current.set(item.key, node);
                          else cellNodes.current.delete(item.key);
                        }}
                        collapsable={false}
                        onLayout={(e) => cellFrames.current.set(item.key, { ...e.nativeEvent.layout, row: rowIndex })}
                        entering={gridIds.fresh.has(item.key) ? cardEntering : undefined}
                        // Чек уходит из сетки только через «умирание»: рассыпавшуюся карточку прячет
                        // пыль поверх неё, без снимка — короткое растворение.
                        exiting={dyingIds.has(item.key) && !ghostIds.has(item.key) ? cardExiting : undefined}
                        style={[styles.cell, { width: cellWidth }]}>
                        {renderCard(item.model)}
                      </Animated.View>
                    ) : (
                      <Animated.View
                        key={item.key}
                        entering={gridIds.fresh.has(item.key) ? cardEntering : undefined}
                        style={[styles.cell, { width: cellWidth }]}>
                        <PrecheckCard
                          precheck={item.precheck}
                          glassKey={glassKey}
                          compact={compactCards}
                          busy={openingPrecheck === item.precheck.playerId}
                          onOpen={() => void onOpenPrecheck(item.precheck)}
                        />
                      </Animated.View>
                    ),
                  )}
                </View>
              ))}
              {ghosts.length > 0 && (
                <View pointerEvents="none" style={styles.dust}>
                  {ghosts.map((g) => (
                    <Dissolve
                      key={g.id}
                      image={g.image}
                      frame={g.frame}
                      onDone={() => {
                        g.image.dispose();
                        setGhosts((list) => list.filter((x) => x.id !== g.id));
                      }}
                    />
                  ))}
                </View>
              )}
            </View>
          </LayoutAnimationConfig>
        )}
      </Animated.ScrollView>

      {/* Размытие под статус-баром, когда карточки уезжают под него; с краем шторки — его формы. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.topBlur, home.ready && styles.topBlurHem, { height: topSpace + (home.ready ? HEM_RADIUS : 0) }, topBlurStyle]}>
        <BlurView intensity={80} tint={BLUR_TINT} style={styles.blurFill} />
      </Animated.View>
    </View>
  );

  if (!split) {
    return (
      <AmbientBackdrop style={styles.screen} onLayout={(e) => setScreenWidth(e.nativeEvent.layout.width)}>
        {list}
        {home.ready && <HomeShade home={home} />}
      </AmbientBackdrop>
    );
  }

  const selectedExists = !!selectedId && (checks.data ?? []).some((c) => c.id === selectedId);
  // Под панелью парит плашка смены (bottom accessory). Если система не учла её в safe area,
  // добавляем высоту плашки сами — иначе «Добавить» и «Оплатить» оказываются под ней.
  const panelBottom = tabBarClearance > 0 ? tabBarClearance + space.md : (insets.bottom >= 60 ? insets.bottom : insets.bottom + ACCESSORY_HEIGHT) + space.md;

  return (
    <AmbientBackdrop style={[styles.screen, styles.splitRow]} onLayout={(e) => setScreenWidth(e.nativeEvent.layout.width)}>
      {list}
      {/* Шторка — во всю ширину кассы, поверх окна (слой окна на iOS). Место в ряду — то же,
          что без сплита: при повороте iPad шторка и связь с домом не пересоздаются. */}
      {home.ready && <HomeShade home={home} />}
      <View
        style={[
          styles.panelWrap,
          { paddingTop: topSpace + space.sm, paddingRight: space.md + insets.right, paddingBottom: panelBottom, width: Math.min(480, wide * 0.42) },
        ]}>
        <CheckPanel checkId={selectedExists ? selectedId : null} />
      </View>
    </AmbientBackdrop>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  flex: { flex: 1 },
  fill: { flex: 1 },
  splitRow: { flexDirection: 'row' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: 6,
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  titles: { flex: 1 },
  title: { color: colors.label },
  subtitle: { color: colors.secondaryLabel, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bell: { width: 44, height: 44, borderRadius: 22, overflow: 'hidden', marginBottom: 4 },
  bellPress: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: GRID_PADDING, paddingBottom: 140 },
  // Карточки одного ряда тянутся до самой высокой — сетка ровная.
  row: { flexDirection: 'row', alignItems: 'stretch' },
  cell: { padding: 6 },
  // Слой пыли над сеткой: пылинки разлетаются за края карточки, поэтому без обрезки.
  dust: { position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible', zIndex: 10, elevation: 10 },
  selected: { borderRadius: 24, borderWidth: 2, borderColor: colors.accent, margin: -2 },
  center: { paddingTop: 120, alignItems: 'center' },
  empty: { height: 420 },
  topBlur: { position: 'absolute', top: 0, left: 0, right: 0 },
  // Как край шторки (home-hem.tsx): выше экрана на радиус, скруглённый низ.
  topBlurHem: { top: -HEM_RADIUS, borderRadius: HEM_RADIUS, borderCurve: 'continuous', overflow: 'hidden' },
  blurFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  panelWrap: { paddingRight: space.md, paddingBottom: space.md },
});
