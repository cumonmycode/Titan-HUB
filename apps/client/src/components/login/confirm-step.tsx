// Вход, последний шаг: мини-инструкция и «Подтвердить в Telegram».
// Пока клиент в боте, экран ждёт подтверждения (опрос — в app/login.tsx).
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GlassButton } from '@/components/glass';
import { Icon } from '@/components/icon';
import { Surface } from '@/components/ui';
import type { PendingLogin } from '@/lib/login-flow';
import { colors, radius, space, type } from '@/lib/theme';

import { OnboardingLayout } from './onboarding-layout';

export type ConfirmState = 'waiting' | 'rejected' | 'expired';

interface ConfirmStepProps {
  pending: PendingLogin;
  state: ConfirmState;
  /** Бот уже открыт по ссылке (или клиент нажал кнопку) — показываем ожидание. */
  waiting: boolean;
  note: string | null;
  onOpenBot: () => void;
  onRestart: () => void;
  onChangePhone: () => void;
}

function instructions(pending: PendingLogin): string[] {
  const yes = pending.mode === 'register' ? '«✅ Да, подтвердить»' : '«✅ Да»';
  return [
    `Нажмите «Подтвердить в Telegram» — откроется бот @${pending.botUsername}. Если бот попросит, нажмите «Запустить».`,
    `В сообщении бота нажмите ${yes}. Если Telegram спросит про номер — разрешите: так бот проверит, что номер ваш.`,
    'Нажмите в боте «Открыть приложение» — вход выполнится сам.',
  ];
}

export function ConfirmStep({ pending, state, waiting, note, onOpenBot, onRestart, onChangePhone }: ConfirmStepProps) {
  const register = pending.mode === 'register';
  const failed = state !== 'waiting';
  const noticeTitle = state === 'rejected' ? (register ? 'Регистрация не подтверждена' : 'Вход не подтверждён') : 'Время вышло';
  const noticeText = state === 'rejected'
    ? (note ? `${note}.` : 'В Telegram нажали «Нет» — доступ не выдан.')
    : 'Подтверждение ждёт 15 минут. Начните заново — это быстро.';

  return (
    <OnboardingLayout
      onBack={onChangePhone}
      hero={
        <Surface tone={colors.telegram} style={styles.badge}>
          <Icon name="telegram" size={30} color={colors.telegram} />
        </Surface>
      }
      title={register ? 'Подтвердите регистрацию' : 'Подтвердите вход'}
      subtitle={<>Подтверждение придёт в Telegram для номера <Text style={styles.phone}>{pending.phone}</Text></>}
      footer={
        <>
          {failed
            ? <GlassButton title="Начать заново" variant="telegram" icon="refresh" onPress={onRestart} />
            : <GlassButton title="Подтвердить в Telegram" variant="telegram" icon="telegram" onPress={onOpenBot} />}
          <GlassButton title="Изменить номер" variant="ghost" size="md" onPress={onChangePhone} />
        </>
      }
    >
      {failed ? (
        <Animated.View entering={FadeIn.duration(300)}>
          <Surface tone={colors.amber} style={styles.card}>
            <View style={styles.noticeHead}>
              <Icon name={state === 'rejected' ? 'shield' : 'pending'} size={22} color={colors.amber} />
              <Text style={[type.headline, styles.flex]}>{noticeTitle}</Text>
            </View>
            <Text style={styles.noticeText}>{noticeText}</Text>
          </Surface>
        </Animated.View>
      ) : (
        <>
          <Surface style={styles.card}>
            {instructions(pending).map((text, i) => (
              <View key={text} style={[styles.stepRow, i > 0 && styles.stepGap]}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <Text style={styles.stepText}>{text}</Text>
              </View>
            ))}
          </Surface>
          {waiting ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.waitRow}>
              <ActivityIndicator color={colors.telegram} />
              <Text style={styles.waitText}>Ждём подтверждения в Telegram…</Text>
            </Animated.View>
          ) : null}
        </>
      )}
    </OnboardingLayout>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  phone: { color: colors.text, fontWeight: '700' },
  card: { marginTop: space.xxl, padding: space.lg, borderRadius: radius.card },
  stepRow: { flexDirection: 'row', gap: space.md },
  stepGap: { marginTop: space.md },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.violetTint, borderWidth: 1, borderColor: colors.borderViolet,
  },
  stepNumText: { color: colors.lavender, fontSize: 13, fontWeight: '800' },
  stepText: { ...StyleSheet.flatten(type.callout), flex: 1 },
  waitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.lg },
  waitText: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  noticeText: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: space.sm },
});
