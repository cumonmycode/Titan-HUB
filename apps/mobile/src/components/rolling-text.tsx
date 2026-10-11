import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { textScaleProps } from '@/components/text';

/** Текст, который при смене значения прокручивается вверх — как `contentTransition(.numericText)` в SwiftUI. */
export function RollingText({ text, style, maxFontSizeMultiplier }: { text: string; style: StyleProp<TextStyle>; maxFontSizeMultiplier?: number }) {
  return (
    <View style={styles.clip}>
      <Animated.Text key={text} entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(160)} style={style} numberOfLines={1} {...textScaleProps(style, maxFontSizeMultiplier)}>
        {text}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
