// Слой поверх экрана гостя: затемнение + шторка. Боковая панель выезжает справа,
// окно (диалог) проявляется по центру, полноэкранный слой — снизу. Контейнер
// остаётся смонтированным, а затемнение и шторка появляются/исчезают сами — так
// у них работают анимации ухода (exiting).
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutDown, SlideInRight, SlideOutRight } from 'react-native-reanimated';

import { glassStyle } from './glass';
import { useKeyboardHeight } from './keyboard';
import { color, motion, radius } from './tokens';

export type LayerVariant = 'side' | 'dialog' | 'full';

export function Layer({
  visible, onClose, variant, children, style, closeOnScrim = true,
}: {
  visible: boolean;
  onClose: () => void;
  variant: LayerVariant;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  closeOnScrim?: boolean;
}) {
  const keyboard = useKeyboardHeight();
  const entering = variant === 'side' ? SlideInRight.duration(motion.enter + 40) : FadeInDown.duration(motion.enter);
  const exiting = variant === 'side' ? SlideOutRight.duration(motion.exit) : FadeOutDown.duration(motion.exit);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'box-none' : 'none'}>
      {visible && variant !== 'full' ? (
        <Animated.View entering={FadeIn.duration(motion.enter)} exiting={FadeOut.duration(motion.exit)} style={[StyleSheet.absoluteFill, styles.scrim]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeOnScrim ? onClose : undefined} accessibilityLabel="Закрыть" />
        </Animated.View>
      ) : null}
      {variant === 'dialog' ? (
        <View style={[styles.center, { bottom: keyboard }]} pointerEvents="box-none">
          {visible ? (
            <Animated.View entering={entering} exiting={exiting} style={[styles.dialog, glassStyle('overlay', 40), style]}>
              {children}
            </Animated.View>
          ) : null}
        </View>
      ) : visible ? (
        <Animated.View entering={entering} exiting={exiting} style={[variant === 'side' ? [styles.side, glassStyle('overlay', 36)] : styles.full, style]}>
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: color.scrim },
  // Высоту боковой панели задаёт тот, кто её открывает (bottom) — или содержимое.
  side: { position: 'absolute', top: 12, right: 12, padding: 22, gap: 16 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { maxWidth: '100%', maxHeight: '100%', padding: 24, gap: 14, borderRadius: radius.panel },
  full: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
