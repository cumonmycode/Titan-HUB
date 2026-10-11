import type { Ref } from 'react';
import { StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';

import { FONT_SCALE_MAX, rampForSize } from '@/lib/text-scale';

/**
 * Текст приложения: растёт вместе с системным размером текста, как в приложениях Apple.
 *
 * - Кривая роста — по системному стилю, подобранному по кеглю (`dynamicTypeRamp`): крупный
 *   заголовок растёт медленнее сноски. Без неё React Native растил всё одним множителем,
 *   и сумма чека 52 pt на максимуме обычного меню становилась 70 pt.
 * - Потолок — FONT_SCALE_MAX.text, если элемент не задал свой `maxFontSizeMultiplier`.
 *
 * Импортировать `Text` и `TextInput` из 'react-native' напрямую нельзя (правило в eslint.config.js):
 * такой текст на крупных размерах разъезжается.
 */
export function Text({ ref, style, dynamicTypeRamp, maxFontSizeMultiplier, ...props }: TextProps & { ref?: Ref<RNText> }) {
  const scale = textScaleProps(style);
  return (
    <RNText
      ref={ref}
      style={style}
      dynamicTypeRamp={dynamicTypeRamp ?? scale.dynamicTypeRamp}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? scale.maxFontSizeMultiplier}
      {...props}
    />
  );
}

/** Те же пропсы роста для текста, который рисуется не через `Text` (Animated.Text). */
export function textScaleProps(style: TextProps['style'], max: number = FONT_SCALE_MAX.text): Pick<TextProps, 'dynamicTypeRamp' | 'maxFontSizeMultiplier'> {
  return { dynamicTypeRamp: rampForSize(StyleSheet.flatten(style)?.fontSize), maxFontSizeMultiplier: max };
}

/** Поле ввода с тем же потолком роста, что у текста вокруг. */
export function TextInput({ ref, maxFontSizeMultiplier, ...props }: TextInputProps & { ref?: Ref<RNTextInput> }) {
  return <RNTextInput ref={ref} maxFontSizeMultiplier={maxFontSizeMultiplier ?? FONT_SCALE_MAX.text} {...props} />;
}

/** Экземпляры для ref (`useRef<TextInputRef>(null)`) — те же, что у компонентов React Native. */
export type TextRef = RNText;
export type TextInputRef = RNTextInput;
export type { TextProps, TextInputProps };
