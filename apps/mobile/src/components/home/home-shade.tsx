import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { cancelAnimation, Easing, runOnJS, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBanner } from '@/lib/banner';
import { connectHa, disconnectHa } from '@/lib/home-assistant';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { useSmartHome, useSmartHomeToken, zoneDevices, zoneEntityIds, type Zone } from '@/lib/smart-home-api';

import { ShadeLayer, ShadePanel, shadeTravel, type ShadeFrame } from './home-panel';
import { IS_IOS } from './home-surface';

export { HEM_RADIUS, HEM_SPACE } from './home-hem';

/**
 * Шторка «Свет и климат» на главной кассы — одна панель (home-panel.tsx). Свёрнутая поднята
 * так, что под строкой состояния виден только её подол: что горит. Потянув подол вниз (или
 * коснувшись), кассир опускает всю шторку на окно, поверх таб-бара и плашки смены.
 * Сворачивается движением вверх за заголовок или подол, касанием ручки, кнопкой «Назад» на
 * Android и сама — при уходе с кассы.
 *
 * Где живёт слой шторки:
 * - iOS — FullWindowOverlay, смонтированный из самой кассы (HomeShade), пока касса в фокусе:
 *   так шторка всегда над системным таб-баром и не висит над чеком, шторками и вкладками;
 * - Android — HomeShadeHost в app/(app)/_layout.tsx: прозрачный для касаний вид поверх своей
 *   панели вкладок, пока путь — «/pos». Modal держать открытым нельзя: он забирает касания.
 *
 * Связь с Home Assistant держит HomeShade — пока касса смонтирована, независимо от слоя.
 */

const SPRING = { damping: 28, stiffness: 280, mass: 1 } as const;
/** Скорость пальца (pt/с), при которой шторка доезжает сама, даже если вытянута чуть-чуть. */
const FLING = 450;
/** Отпустили: свёрнутая доезжает вниз, если вытянута на 30 % пути; раскрытая — если поднята меньше чем на 30 %. */
const OPEN_AT = 0.3;
const KEEP_OPEN_AT = 0.7;
/** Сдвиг пальца (pt), с которого подол берёт движение, и боковой — с которого отдаёт. */
const ACTIVATE = 6;
const SIDEWAYS = 24;
/** Касание подола, а не смах: смах вверх по свёрнутому подолу шторку не открывает. */
const TAP_SLOP = 12;
const APPEAR = { duration: 260, easing: Easing.out(Easing.cubic) };
const TUCK = { duration: 180, easing: Easing.in(Easing.quad) };
const IS_PAD = Platform.OS === 'ios' && Platform.isPad;

/**
 * Только локальный стенд: `EXPO_PUBLIC_LOCAL_SHADE=0.5` (0…1) при `EXPO_PUBLIC_LOCAL_STACK=1`
 * открывает шторку на эту долю сразу после появления — снимки симулятора без касаний.
 * Переменные подставляются при сборке, в обычной сборке здесь NaN и крючок ничего не делает.
 */
const LOCAL_SHADE = process.env.EXPO_PUBLIC_LOCAL_STACK === '1' ? Number.parseFloat(process.env.EXPO_PUBLIC_LOCAL_SHADE ?? '') : Number.NaN;
const INITIAL_PROGRESS = LOCAL_SHADE >= 0 && LOCAL_SHADE <= 1 ? LOCAL_SHADE : 0;

export type HomeShadeModel = { ready: boolean; zones: Zone[]; url: string | null; token: string | null };

/**
 * Есть ли что показывать: Home Assistant подключён в «Интеграциях» и хотя бы в одном
 * помещении выбраны устройства. Иначе касса выглядит как раньше, без шторки.
 */
export function useHomeShade(): HomeShadeModel {
  const role = useSession((s) => s.user?.role);
  const allowed = role === 'owner' || role === 'staff';
  const config = useSmartHome(allowed);
  const token = useSmartHomeToken();
  const data = config.data;
  const zones = useMemo(() => (data?.zones ?? []).filter((zone) => zoneDevices(zone).length > 0), [data]);
  const url = data?.url ?? null;
  return { ready: allowed && !!data?.hasToken && !!url && !!token && zones.length > 0, zones, url, token };
}

/** Касса: связь с домом, а на iOS — ещё и сама шторка. */
export function HomeShade({ home }: { home: HomeShadeModel }) {
  // Связь с Home Assistant живёт, пока на кассе есть шторка, — не пока смонтирован её слой.
  const idsKey = zoneEntityIds(home.zones).join(',');
  useEffect(() => {
    if (!home.url || !home.token) return;
    connectHa({ url: home.url, token: home.token, entityIds: idsKey ? idsKey.split(',') : [] });
  }, [home.url, home.token, idsKey]);
  useEffect(() => () => disconnectHa(), []);

  return IS_IOS ? <IosShade zones={home.zones} /> : null;
}

/**
 * iOS: рамка шторки — экран кассы в координатах окна (на iPad с боковой панелью он сдвинут
 * вправо). На iPhone шторка уходит за верх экрана; на iPad — под верхний таб-бар, который
 * остаётся над ней и доступен. Слоя нет, пока касса не в фокусе, приложение не активно
 * (переключатель приложений) или касса заблокирована: шторка не висит над заслонкой.
 */
function IosShade({ zones }: { zones: Zone[] }) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const focused = useIsFocused();
  const locked = useSession((s) => s.locked);
  const active = useAppActive();
  const anchor = useRef<View>(null);
  const [screen, setScreen] = useState<ShadeFrame | null>(null);

  const measure = () => {
    anchor.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      setScreen((prev) => (prev && prev.x === x && prev.y === y && prev.width === width && prev.height === height ? prev : { x, y, width, height }));
    });
  };
  // Пока касса была не в фокусе, рамка могла поменяться (поворот, боковая панель iPad).
  const remeasure = useEffectEvent(measure);
  useEffect(() => {
    if (focused) remeasure();
  }, [focused]);

  const clipTop = IS_PAD ? insets.top : 0;
  const frame = screen && { x: screen.x, y: screen.y + clipTop, width: screen.width, height: Math.max(0, window.height - screen.y - clipTop) };

  return (
    <>
      <View ref={anchor} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={measure} />
      {frame && focused && active && !locked && <Shade zones={zones} frame={frame} hemTop={insets.top - clipTop} />}
    </>
  );
}

/**
 * Android: слой шторки над своей панелью вкладок, пока на экране касса. Монтируется в
 * app/(app)/_layout.tsx последним, прозрачным для касаний видом во всё окно.
 */
export function HomeShadeHost() {
  const home = useHomeShade();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  if (!home.ready) return null;
  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
      }}>
      {size && <Shade zones={home.zones} frame={{ x: 0, y: 0, width: size.width, height: size.height }} hemTop={insets.top} />}
    </View>
  );
}

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

const clamp = (value: number) => {
  'worklet';
  return Math.min(1, Math.max(0, value));
};

/** Состояние и жесты шторки. Смонтирована — значит касса на экране; при уходе всё сбрасывается. */
function Shade({ zones, frame, hemTop }: { zones: Zone[]; frame: ShadeFrame; hemTop: number }) {
  const [engaged, setEngaged] = useState(INITIAL_PROGRESS > 0);
  const progress = useSharedValue(INITIAL_PROGRESS);
  const presence = useSharedValue(INITIAL_PROGRESS > 0 ? 1 : 0);
  const dragStart = useSharedValue(0);
  const travel = shadeTravel(frame, hemTop);

  // Появилась (вернулись на кассу) — подол съезжает сверху. iOS: пока виден баннер
  // уведомления, свёрнутая шторка уходит за верх — слой окна лежит над баннером.
  const bannerUp = useBanner((s) => s.current !== null);
  const tucked = IS_IOS && bannerUp && !engaged;
  useEffect(() => {
    presence.set(withTiming(tucked ? 0 : 1, tucked ? TUCK : APPEAR));
  }, [tucked, presence]);

  const onSettled = (open: boolean) => {
    if (open) haptic.light();
    else setEngaged(false);
  };

  const settle = (open: boolean, velocity = 0) => {
    'worklet';
    progress.set(
      withSpring(open ? 1 : 0, { ...SPRING, velocity }, (finished) => {
        if (finished) runOnJS(onSettled)(open);
      }),
    );
  };
  const open = () => {
    setEngaged(true);
    settle(true);
  };
  const close = () => settle(false);

  const onBack = useEffectEvent(() => {
    close();
    return true;
  });
  useEffect(() => {
    if (!engaged) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [engaged]);

  // Низ шторки идёт за пальцем 1:1: сдвиг пальца / путь = доля раскрытия.
  const pan = (offsetY: number | [number, number]) =>
    Gesture.Pan()
      .activeOffsetY(offsetY)
      .failOffsetX([-SIDEWAYS, SIDEWAYS])
      .onStart(() => {
        cancelAnimation(progress);
        dragStart.set(progress.get());
        runOnJS(setEngaged)(true);
      })
      .onUpdate((e) => {
        progress.set(clamp(dragStart.get() + e.translationY / travel));
      })
      .onEnd((e) => {
        const keepAt = dragStart.get() > 0.5 ? KEEP_OPEN_AT : OPEN_AT;
        const toOpen = e.velocityY > FLING || (e.velocityY > -FLING && progress.get() > keepAt);
        settle(toOpen, e.velocityY / travel);
      });

  // Свёрнутый подол тянут только вниз; у раскрытой шторки — в обе стороны.
  const hemGesture = Gesture.Exclusive(
    pan(engaged ? [-ACTIVATE, ACTIVATE] : ACTIVATE),
    Gesture.Tap()
      .maxDistance(TAP_SLOP)
      .onEnd((_e, success) => {
        if (!success) return;
        const toOpen = progress.get() < 0.5;
        if (toOpen) runOnJS(setEngaged)(true);
        settle(toOpen);
      }),
  );
  const headerGesture = pan(-ACTIVATE);

  return (
    <ShadeLayer modal={engaged}>
      <ShadePanel
        zones={zones}
        frame={frame}
        hemTop={hemTop}
        progress={progress}
        presence={presence}
        engaged={engaged}
        hemGesture={hemGesture}
        headerGesture={headerGesture}
        onOpen={open}
        onClose={close}
      />
    </ShadeLayer>
  );
}
