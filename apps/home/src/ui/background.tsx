// Фон киоска: статичная картинка (тёмный графит с мягкими пятнами света).
// Рисуется один раз — в отличие от размытий и градиентов в реальном времени.
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { useScreen } from './screen';
import { color } from './tokens';

const LANDSCAPE = require('@/assets/images/ambient-landscape.jpg');
const PORTRAIT = require('@/assets/images/ambient-portrait.jpg');

export function Background() {
  const { width, height } = useScreen();
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color.ground }]}>
      <Image source={width >= height ? LANDSCAPE : PORTRAIT} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory" transition={0} />
    </View>
  );
}
