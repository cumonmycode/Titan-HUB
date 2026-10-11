import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { colors, space, type } from '@/lib/theme';

/** Свайп влево открывает красное действие; пока строка закрыта, действие не просвечивает через стекло. */
export function SwipeToDelete({ enabled, label, onDelete, children }: { enabled: boolean; label: string; onDelete: () => void; children: ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={36}
      overshootRight={false}
      renderRightActions={(progress, _translation, swipeable) => (
        <DeleteAction
          progress={progress}
          label={label}
          onPress={() => {
            haptic.warning();
            swipeable.close();
            onDelete();
          }}
        />
      )}>
      {children}
    </ReanimatedSwipeable>
  );
}

function DeleteAction({ progress, label, onPress }: { progress: SharedValue<number>; label: string; onPress: () => void }) {
  const style = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.3, 1], [0, 0.6, 1]) }));
  return (
    <Animated.View style={[styles.action, style]}>
      <Pressable onPress={onPress} style={styles.press} accessibilityRole="button" accessibilityLabel={label}>
        <SymbolView name="trash.fill" size={16} tintColor="white" />
        <Text style={[type.footnote, styles.text]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  action: { justifyContent: 'center', paddingLeft: space.sm },
  press: {
    height: '80%',
    minHeight: 44,
    paddingHorizontal: space.lg,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  text: { color: 'white', fontWeight: '600' },
});
