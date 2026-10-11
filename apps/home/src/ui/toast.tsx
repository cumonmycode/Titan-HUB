// Всплывающая подсказка гостю сверху экрана; исчезает сама.
import { CircleAlert, CircleCheck, CircleX, Info, type LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { create } from 'zustand';

import { glassStyle } from './glass';
import { Icon } from './icon';
import { T } from './text';
import { color } from './tokens';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';
type Toast = { id: number; text: string; tone: ToastTone };

const useToast = create<{ toast: Toast | null; seq: number }>()(() => ({ toast: null, seq: 0 }));

export function toast(text: string, tone: ToastTone = 'success') {
  const seq = useToast.getState().seq + 1;
  useToast.setState({ seq, toast: { id: seq, text, tone } });
}

const LOOK: Record<ToastTone, { icon: LucideIcon; tone: string }> = {
  success: { icon: CircleCheck, tone: color.green },
  info: { icon: Info, tone: color.accentSoft },
  warning: { icon: CircleAlert, tone: color.amber },
  error: { icon: CircleX, tone: color.red },
};

export function ToastHost() {
  const current = useToast((s) => s.toast);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => useToast.setState({ toast: null }), 3600);
    return () => clearTimeout(t);
  }, [current]);

  const look = current ? LOOK[current.tone] : null;
  return (
    <View pointerEvents="none" style={styles.layer}>
      {current && look ? (
        <Animated.View key={current.id} entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)} style={[styles.toast, glassStyle('overlay', 24)]}>
          <Icon as={look.icon} size={24} tone={look.tone} />
          <T variant="label" style={styles.text}>{current.text}</T>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 18, left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 12, maxWidth: 640, paddingHorizontal: 22, paddingVertical: 16 },
  text: { flexShrink: 1, fontSize: 17 },
});
