// Каркас экранов до входа (как в Telegram): «назад» сверху, крупный заголовок и
// пояснение, содержимое прокручивается, кнопки прижаты к низу и поднимаются над клавиатурой.
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassIconButton } from '@/components/glass';
import { colors, GUTTER, IS_IOS, MAX_WIDTH, space, type } from '@/lib/theme';

const BACK_SIZE = 40;

interface OnboardingLayoutProps {
  /** Крупная картинка над заголовком (карта, значок разрешения). */
  hero?: ReactNode;
  title?: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  /** Кнопки внизу экрана. */
  footer?: ReactNode;
  /** По центру — для знакомства и разрешений; слева — для форм. */
  centered?: boolean;
  children?: ReactNode;
}

export function OnboardingLayout({ hero, title, subtitle, onBack, footer, centered, children }: OnboardingLayoutProps) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={IS_IOS ? 'padding' : undefined}>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        {onBack ? <GlassIconButton icon="back" label="Назад" size={BACK_SIZE} onPress={onBack} /> : null}
      </View>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, centered && styles.contentCentered]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.column}>
          {hero}
          {title ? <Text style={[styles.title, centered && styles.center]}>{title}</Text> : null}
          {subtitle ? <Text style={[styles.subtitle, centered && styles.center]}>{subtitle}</Text> : null}
          {children}
        </View>
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <View style={[styles.column, styles.footerColumn]}>{footer}</View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  top: { minHeight: BACK_SIZE, paddingHorizontal: GUTTER, flexDirection: 'row' },
  content: { paddingHorizontal: GUTTER, paddingTop: space.lg, paddingBottom: space.xl, flexGrow: 1 },
  contentCentered: { justifyContent: 'center' },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  title: { ...StyleSheet.flatten(type.title), marginTop: space.xl },
  subtitle: { ...StyleSheet.flatten(type.body), color: colors.textSecondary, marginTop: space.sm },
  center: { textAlign: 'center' },
  footer: { paddingHorizontal: GUTTER, paddingTop: space.md },
  footerColumn: { gap: space.sm },
});
