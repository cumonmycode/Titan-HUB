// Число, которое «докручивается» до нового значения (баланс после оплаты,
// начисление бонусов). Уважает системное «Уменьшение движения».
import { useEffect, useRef, useState } from 'react';
import { type StyleProp, Text, type TextStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

export function RollingNumber({
  value, format, style, duration = 700, maxFontSizeMultiplier,
}: { value: number; format: (n: number) => string; style?: StyleProp<TextStyle>; duration?: number; maxFontSizeMultiplier?: number }) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    if (reduceMotion || from === value) {
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const start = Date.now();
    let frame = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduceMotion]);

  return (
    <Text style={[{ fontVariant: ['tabular-nums'] }, style]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={maxFontSizeMultiplier}>
      {format(shown)}
    </Text>
  );
}
