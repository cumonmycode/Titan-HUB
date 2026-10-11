// Панель «Свет и климат» на главном экране гостя. Свёрнута — аккуратный «язычок»
// у края экрана (справа в альбомной, снизу в книжной): ручка, свет, температура.
// Язычок прикреплён к панели: её вытягивают пальцем или открывают касанием, она
// идёт за пальцем на UI-потоке и доводится пружиной. Свернуть — обратным
// движением, касанием фона, «Назад»; без касаний 45 с сворачивается сама.
// В меню, окнах и на «спасибо» панели нет — только на главном экране.
import { ChevronLeft, ChevronUp, Lightbulb, Thermometer } from 'lucide-react-native';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { SmartRoom } from '@/data/types';
import { useVisit } from '@/features/visit/store';
import { Icon } from '@/ui/icon';
import { useScreen } from '@/ui/screen';
import { T } from '@/ui/text';
import { color } from '@/ui/tokens';

import { Kiosk } from '../../../modules/titan-kiosk';
import { ClimateCard, LightTile, STATUS_TEXT } from './controls';
import { useHa } from './ha';
import { climateInfo, fmtTemp, HVAC_ICON, HVAC_TONE, isOn } from './room';
import { useRoom } from './use-room';

/** Язычок (длина вдоль края × толщина) и ширина раскрытой панели в альбомной, dp. */
export const DOCK = { tabLong: 168, tabThick: 60, tabWide: 228, panelW: 400, gap: 8 } as const;

/** Панель видна только на главном экране: без открытых слоёв и не на «спасибо». */
const useDockVisible = () => useVisit((s) => s.layer === null && s.phase.kind !== 'finish');

/** Сколько места главному экрану оставить под язычок. */
export function useDockReserve(): { bottom: number; right: number } {
  const { configured } = useRoom();
  const onMain = useVisit((s) => s.phase.kind !== 'finish');
  const { width, height } = useScreen();
  if (!configured || !onMain) return { bottom: 0, right: 0 };
  return width >= height ? { bottom: 0, right: DOCK.tabThick + DOCK.gap } : { bottom: DOCK.tabThick + DOCK.gap, right: 0 };
}

const SPRING = { damping: 26, stiffness: 260, mass: 0.9, overshootClamping: true } as const;
/** Бросок быстрее этого (dp/с) решает направление, иначе — середина хода. */
const FLING = 600;

const setRoomOpen = (open: boolean) => useVisit.getState().setRoom(open);
const toggleRoom = () => useVisit.getState().setRoom(!useVisit.getState().roomOpen);

export function RoomDock() {
  const { room, configured } = useRoom();
  const visible = useDockVisible();
  const { width, height } = useScreen();
  if (!configured || !room || !visible) return null;
  // Поворот экрана — панель собирается заново сразу в нужном месте, без доезда анимацией.
  const landscape = width >= height;
  return <Dock key={landscape ? 'landscape' : 'portrait'} room={room} landscape={landscape} />;
}

function Dock({ room, landscape }: { room: SmartRoom; landscape: boolean }) {
  const open = useVisit((s) => s.roomOpen);
  const { width, height } = useScreen();
  const progress = useSharedValue(open ? 1 : 0);
  const start = useSharedValue(0);
  // Ход панели: в альбомной — её ширина, в книжной — высота (меряем; до замера —
  // за экраном, чтобы панель не мелькнула раскрытой).
  const travel = useSharedValue<number>(landscape ? DOCK.panelW : height);

  // Пружина — только если панель не там, где надо: при монтировании (поворот)
  // анимировать нечего, а лишнее обновление для ещё не смонтированных видов
  // заставляет Reanimated повторять его на каждом событии отрисовки.
  useEffect(() => {
    const target = open ? 1 : 0;
    if (progress.get() !== target) progress.set(withSpring(target, SPRING));
  }, [open, progress]);

  // Свайп от правого края — системный «Назад» при навигации жестами: над язычком
  // отключаем его, чтобы панель вытягивалась прямо от края. Нижний край (жест
  // «Домой») так не освободить — в книжной язычок берут чуть выше края.
  useEffect(() => {
    if (!landscape) return;
    const mid = height / 2;
    void Kiosk.setGestureExclusion([[width - DOCK.tabThick, mid - DOCK.tabLong / 2, width, mid + DOCK.tabLong / 2]]);
    return () => void Kiosk.setGestureExclusion([]);
  }, [landscape, width, height]);

  const pan = (landscape ? Gesture.Pan().activeOffsetX([-10, 10]).failOffsetY([-30, 30]) : Gesture.Pan().activeOffsetY([-10, 10]).failOffsetX([-30, 30]))
    .onBegin(() => {
      start.set(progress.get());
    })
    .onUpdate((e) => {
      const delta = landscape ? -e.translationX : -e.translationY;
      progress.set(Math.min(1, Math.max(0, start.get() + delta / Math.max(1, travel.get()))));
    })
    .onEnd((e) => {
      const v = landscape ? -e.velocityX : -e.velocityY;
      const target = v > FLING ? 1 : v < -FLING ? 0 : progress.get() > 0.5 ? 1 : 0;
      progress.set(withSpring(target, SPRING));
      scheduleOnRN(setRoomOpen, target === 1);
    });

  const tap = Gesture.Tap().onEnd((_e, ok) => {
    if (ok) scheduleOnRN(toggleRoom);
  });

  const slide = useAnimatedStyle(
    () => ({
      transform: landscape
        ? [{ translateX: (1 - progress.get()) * travel.get() }]
        : [{ translateY: (1 - progress.get()) * travel.get() }],
    }),
    [landscape],
  );
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.get() * 0.6 }));
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${progress.get() * 180}deg` }] }));

  const onPanelLayout = (e: LayoutChangeEvent) => {
    if (!landscape) travel.set(e.nativeEvent.layout.height);
  };

  return (
    <>
      <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setRoomOpen(false)} accessibilityLabel="Свернуть свет и климат" />
      </Animated.View>
      <View style={landscape ? styles.edgeRight : styles.edgeBottom} pointerEvents="box-none">
        <GestureDetector gesture={pan}>
          <Animated.View style={[landscape ? styles.rowDock : styles.columnDock, slide]}>
            <GestureDetector gesture={tap}>
              <View
                style={landscape ? styles.tabSide : styles.tabBottom}
                accessible
                accessibilityRole="button"
                accessibilityLabel={open ? 'Свернуть свет и климат' : 'Открыть свет и климат'}
                onAccessibilityTap={toggleRoom}
              >
                <Tab room={room} landscape={landscape} chevron={chevronStyle} />
              </View>
            </GestureDetector>
            <View style={landscape ? styles.panelSide : styles.panelBottom} onLayout={onPanelLayout}>
              <Title />
              {room.lights.length ? (
                <View style={styles.lights}>
                  {room.lights.map((l) => <LightTile key={l.entityId} device={l} wide={room.lights.length === 1} />)}
                </View>
              ) : null}
              {room.climate ? <ClimateCard device={room.climate} /> : null}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </>
  );
}

function Title() {
  const status = useHa((s) => s.status);
  const space = useVisit((s) => s.snapshot?.space.name ?? null);
  const st = STATUS_TEXT[status];
  return (
    <View style={{ gap: 4 }}>
      <T variant="title">Свет и климат</T>
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: st.tone }]} />
        <T variant="caption" tone="secondary" numberOfLines={2} style={{ flex: 1 }}>{space ? `${space} · ${st.text}` : st.text}</T>
      </View>
    </View>
  );
}

/** Язычок: ручка, свет, температура и стрелка, которая разворачивается при вытягивании. */
function Tab({ room, landscape, chevron }: { room: SmartRoom; landscape: boolean; chevron: ReturnType<typeof useAnimatedStyle> }) {
  const status = useHa((s) => s.status);
  const lightsOn = useHa((s) => room.lights.filter((l) => isOn(s.entities[l.entityId])).length);
  const climate = useHa((s) => (room.climate ? s.entities[room.climate.entityId] : undefined));
  const info = climateInfo(climate);
  const climateOn = !!room.climate && !!climate && info.mode !== 'off';
  const ModeIcon = climateOn ? HVAC_ICON[info.mode] ?? Thermometer : Thermometer;
  const modeTone = climateOn ? HVAC_TONE[info.mode] ?? color.text : color.textSecondary;
  const temp = climateOn && info.target != null ? `${fmtTemp(info.target)}°` : info.current != null ? `${fmtTemp(info.current)}°` : '—';
  const offline = status !== 'connected';
  const lightTone = lightsOn ? color.warm : color.textSecondary;

  const chevronView = (
    <Animated.View style={chevron}>
      <Icon as={landscape ? ChevronLeft : ChevronUp} size={20} tone={color.textSecondary} stroke={2.2} />
    </Animated.View>
  );
  const light = room.lights.length ? <Icon as={Lightbulb} size={24} tone={lightTone} /> : null;
  const climateView = room.climate ? (
    <View style={landscape ? styles.tabItemV : styles.tabItemH}>
      <Icon as={ModeIcon} size={18} tone={modeTone} />
      <T variant="label" numeric style={{ fontSize: 15 }}>{temp}</T>
    </View>
  ) : null;

  if (landscape) {
    return (
      <>
        <View style={styles.grabberV} />
        <View style={styles.tabStackV}>
          {chevronView}
          {light}
          {climateView}
          {offline ? <View style={[styles.dot, { backgroundColor: color.amber }]} /> : null}
        </View>
      </>
    );
  }
  return (
    <>
      <View style={styles.grabberH} />
      <View style={styles.tabStackH}>
        {light}
        {climateView}
        {offline ? <View style={[styles.dot, { backgroundColor: color.amber }]} /> : null}
        {chevronView}
      </View>
    </>
  );
}

const GLASS = { backgroundColor: color.glassOverlay, borderColor: color.borderStrong, borderWidth: 1 } as const;

const styles = StyleSheet.create({
  scrim: { backgroundColor: color.scrim },
  edgeRight: { position: 'absolute', top: 12, bottom: 12, right: 0, justifyContent: 'center' },
  edgeBottom: { position: 'absolute', left: 12, right: 12, bottom: 0 },
  rowDock: { flexDirection: 'row', alignItems: 'center', maxHeight: '100%' },
  columnDock: { alignItems: 'center' },

  // Язычок прилегает к краю экрана: скруглены только наружные углы, со стороны
  // панели рамки нет — язычок и панель читаются как одно целое.
  tabSide: {
    ...GLASS, width: DOCK.tabThick, height: DOCK.tabLong, marginRight: -1, zIndex: 1,
    borderTopLeftRadius: 24, borderBottomLeftRadius: 24, borderRightWidth: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  tabBottom: {
    ...GLASS, width: DOCK.tabWide, height: DOCK.tabThick, marginBottom: -1, zIndex: 1,
    borderTopLeftRadius: 24, borderTopRightRadius: 24, borderBottomWidth: 0,
    alignItems: 'center', justifyContent: 'center', paddingTop: 6,
  },
  panelSide: {
    ...GLASS, width: DOCK.panelW, maxHeight: '100%', padding: 20, gap: 16,
    borderTopLeftRadius: 32, borderBottomLeftRadius: 32, borderRightWidth: 0,
  },
  panelBottom: {
    ...GLASS, alignSelf: 'stretch', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 20, gap: 14,
    borderTopLeftRadius: 32, borderTopRightRadius: 32, borderBottomWidth: 0,
  },

  grabberV: { position: 'absolute', left: 8, top: '50%', marginTop: -18, width: 4, height: 36, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.30)' },
  grabberH: { position: 'absolute', top: 7, alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.30)' },
  tabStackV: { alignItems: 'center', gap: 12, paddingLeft: 6 },
  tabStackH: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  tabItemV: { alignItems: 'center', gap: 2 },
  tabItemH: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  lights: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
