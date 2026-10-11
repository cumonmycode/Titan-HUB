// Вход, последний шаг: мини-инструкция и кнопка «Подтвердить в Telegram».
// Пока клиент в боте, экран ждёт подтверждения (опрос — в app/login.tsx).
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { GlassButton } from '@/components/glass';
import { Icon, type IconName } from '@/components/icon';
import { Surface } from '@/components/ui';
import type { PendingLogin } from '@/lib/login-flow';
import { colors, radius, space, type } from '@/lib/theme';

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
  return (
    <Animated.View entering={FadeIn.duration(250)}>
      <Surface tone={colors.telegram} style={styles.badge}>
        <Icon name="telegram" size={28} color={colors.telegram} />
      </Surface>
      <Text style={styles.title}>{register ? 'Подтвердите регистрацию' : 'Подтвердите вход'}</Text>
      <Text style={styles.lead}>
        {register ? 'Остался последний шаг — подтверждение в Telegram для номера ' : 'Мы нашли вас в клубе. Подтвердите вход в Telegram для номера '}
        <Text style={styles.phone}>{pending.phone}</Text>
      </Text>

      {state === 'waiting' ? (
        <>
          <Surface style={styles.card}>
            {instructions(pending).map((text, i) => (
              <View key={text} style={[styles.stepRow, i > 0 && styles.stepGap]}>
                <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
                <Text style={styles.stepText}>{text}</Text>
              </View>
            ))}
          </Surface>
          <GlassButton title="Подтвердить в Telegram" variant="telegram" icon="telegram" onPress={onOpenBot} style={styles.open} />
          {waiting ? (
            <Animated.View entering={FadeIn.duration(300)} style={styles.waitRow}>
              <ActivityIndicator color={colors.telegram} />
              <Text style={styles.waitText}>Ждём подтверждения в Telegram…</Text>
            </Animated.View>
          ) : null}
        </>
      ) : (
        <Notice
          icon={state === 'rejected' ? 'shield' : 'pending'}
          title={state === 'rejected' ? (register ? 'Регистрация не подтверждена' : 'Вход не подтверждён') : 'Время вышло'}
          text={state === 'rejected'
            ? (note ? `${note}.` : 'В Telegram нажали «Нет» — доступ не выдан.')
            : 'Подтверждение ждёт 15 минут. Начните заново — это быстро.'}
          onRestart={onRestart}
        />
      )}

      <GlassButton title="Изменить номер" variant="ghost" size="md" onPress={onChangePhone} style={styles.change} />
    </Animated.View>
  );
}

function Notice({ icon, title, text, onRestart }: { icon: IconName; title: string; text: string; onRestart: () => void }) {
  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Surface tone={colors.amber} style={styles.card}>
        <View style={styles.noticeHead}>
          <Icon name={icon} size={22} color={colors.amber} />
          <Text style={[type.headline, styles.flex]}>{title}</Text>
        </View>
        <Text style={styles.noticeText}>{text}</Text>
        <GlassButton title="Начать заново" variant="telegram" icon="refresh" size="md" onPress={onRestart} style={styles.restart} />
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  title: { ...StyleSheet.flatten(type.title), marginTop: space.lg },
  lead: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: space.sm },
  phone: { color: colors.text, fontWeight: '700' },
  card: { marginTop: space.xl, padding: space.lg, borderRadius: radius.card },
  stepRow: { flexDirection: 'row', gap: space.md },
  stepGap: { marginTop: space.md },
  stepNum: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.violetTint, borderWidth: 1, borderColor: colors.borderViolet,
  },
  stepNumText: { color: colors.lavender, fontSize: 13, fontWeight: '800' },
  stepText: { ...StyleSheet.flatten(type.callout), flex: 1 },
  open: { marginTop: space.xl },
  waitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.lg },
  waitText: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary },
  noticeHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  noticeText: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: space.sm },
  restart: { marginTop: space.lg },
  change: { marginTop: space.md },
});
