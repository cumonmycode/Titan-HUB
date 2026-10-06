// Вход через Telegram-бота My Titan (@titanwalletrobot).
// 1) Сервер выдаёт одноразовый вход (ticket + код + диплинк на бота).
// 2) Приложение открывает Telegram: бот спрашивает «Войти на устройстве …?».
// 3) Пока клиент подтверждает, приложение опрашивает статус и получает токен.
// Запасной путь — отправить боту 4-значный код (Telegram на другом устройстве).
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Glass, GlassButton } from '@/components/glass';
import { HoloCard } from '@/components/holo-card';
import { Icon, type IconName } from '@/components/icon';
import { Tap } from '@/components/tap';
import { Divider, IconTile } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { resetDemo } from '@/lib/demo';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';
import { colors, GUTTER, IS_IOS, MAX_WIDTH, radius, space, type } from '@/lib/theme';
import type { LoginStart, LoginStatus } from '@/lib/types';

type Phase = 'idle' | 'starting' | 'waiting' | 'rejected';

const FEATURES: { icon: IconName; color: string; title: string; text: string }[] = [
  { icon: 'bonus', color: colors.gold, title: 'Бонусы', text: 'Баланс, начисления и когда что сгорит' },
  { icon: 'wallet', color: colors.green, title: 'Депозит и долг', text: 'Пополнение и погашение через СБП' },
  { icon: 'inbox', color: colors.violetLight, title: 'Уведомления', text: 'Каждая операция — сразу на телефон' },
];
const FEATURE_INSET = space.lg + 36 + space.md;

/** Открыть бота в приложении Telegram (tg://), а без него — через t.me в браузере. */
async function openTelegram(deepLink: string) {
  try {
    const url = new URL(deepLink);
    const domain = url.pathname.replace(/^\//, '');
    const start = url.searchParams.get('start');
    await Linking.openURL(`tg://resolve?domain=${domain}${start ? `&start=${start}` : ''}`);
  } catch {
    await Linking.openURL(deepLink);
  }
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const signIn = useSession((s) => s.signIn);
  const enterDemo = useSession((s) => s.enterDemo);
  const [phase, setPhase] = useState<Phase>('idle');
  const [login, setLogin] = useState<LoginStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const polling = useRef(false);

  async function begin(openBot: boolean) {
    setError(null);
    // Тихое обновление истёкшего кода не должно мигать экраном «Войти».
    if (openBot) setPhase('starting');
    try {
      const r = await api.post<LoginStart>('/auth/wallet-code/start', {
        deviceName: Device.modelName ?? (IS_IOS ? 'iPhone' : 'Android'),
        platform: IS_IOS ? 'ios' : 'android',
      }, { auth: false });
      setLogin(r);
      setPhase('waiting');
      if (openBot && r.deepLink) await openTelegram(r.deepLink);
    } catch (e) {
      setPhase('idle');
      setError(errorText(e));
      haptic.error();
    }
  }

  const poll = useEffectEvent(async () => {
    if (phase !== 'waiting' || !login?.ticket || polling.current) return;
    polling.current = true;
    try {
      const r = await api.get<LoginStatus>(`/auth/wallet-code/status?ticket=${encodeURIComponent(login.ticket)}`, { auth: false });
      if (r.status === 'ok') {
        haptic.success();
        await signIn(r.token);
      } else if (r.status === 'rejected') {
        haptic.warning();
        setPhase('rejected');
      } else if (r.status === 'expired') {
        // Код живёт 5 минут — тихо берём новый, бота заново не открываем.
        await begin(false);
      }
    } catch { /* сеть моргнула — повторим на следующем тике */ } finally {
      polling.current = false;
    }
  });

  useEffect(() => {
    if (phase !== 'waiting') return;
    const timer = setInterval(() => void poll(), 2000);
    // Вернулись из Telegram — проверяем сразу, не дожидаясь таймера.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void poll(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [phase]);

  async function copyCode() {
    if (!login) return;
    await Clipboard.setStringAsync(login.code);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  const bot = login?.botUsername ?? 'titanwalletrobot';

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xxl }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.column}>
        <Animated.View entering={FadeInDown.duration(600).springify().damping(16)}>
          <HoloCard nickname="titan" tierLabel="Резидент" tierColor={colors.violet} bonus={1240} bonusHidden={false} />
        </Animated.View>

        <View style={styles.intro}>
          <Text style={styles.kicker}>MY TITAN</Text>
          <Text style={styles.headline}>Кошелёк клуба{'\n'}в вашем телефоне</Text>
        </View>

        {phase === 'waiting' && login ? (
          <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
            <Glass tint="rgba(42,171,238,0.14)" fallback={styles.waitFallback} style={styles.card}>
              <View style={styles.waitHead}>
                <ActivityIndicator color={colors.telegram} />
                <Text style={[type.headline, styles.flex]}>Подтвердите вход в Telegram</Text>
              </View>
              <Text style={styles.cardText}>
                Бот @{bot} прислал запрос «Вход в My Titan» — нажмите «Да, войти» и вернитесь сюда.
              </Text>
              <GlassButton title="Открыть Telegram" variant="telegram" icon="telegram" size="md" style={styles.cardButton}
                onPress={() => login.deepLink && void openTelegram(login.deepLink)} />

              <View style={styles.codeBlock}>
                <Text style={[type.caption, styles.centered]}>Telegram на другом устройстве? Отправьте боту код:</Text>
                <Tap onPress={copyCode} scaleTo={0.96} accessibilityRole="button" accessibilityLabel={`Код ${login.code.split('').join(' ')}. Скопировать`}>
                  <View style={styles.codeRow}>
                    {login.code.split('').map((d, i) => (
                      <Glass key={i} tint="rgba(139,92,246,0.24)" fallback={styles.codeFallback} style={styles.codeDigit}>
                        <Text style={styles.codeText}>{d}</Text>
                      </Glass>
                    ))}
                  </View>
                </Tap>
                <View style={styles.copyRow}>
                  <Icon name={copied ? 'check' : 'copy'} size={12} color={colors.lavender} />
                  <Text style={styles.copyHint}>{copied ? 'Скопировано' : 'Нажмите, чтобы скопировать'}</Text>
                </View>
              </View>

              <GlassButton title="Отмена" variant="ghost" size="md" onPress={() => { setPhase('idle'); setLogin(null); }} />
            </Glass>
          </Animated.View>
        ) : phase === 'rejected' ? (
          <Animated.View entering={FadeIn.duration(300)}>
            <Glass tint="rgba(251,191,36,0.14)" fallback={styles.rejectFallback} style={styles.card}>
              <View style={styles.waitHead}>
                <Icon name="shield" size={22} color={colors.amber} />
                <Text style={[type.headline, styles.flex]}>Вход отклонён</Text>
              </View>
              <Text style={styles.cardText}>
                В Telegram нажали «Это не я» — доступ не выдан. Если это были вы, начните вход заново.
              </Text>
              <GlassButton title="Попробовать снова" variant="telegram" icon="telegram" style={styles.cardButton} onPress={() => void begin(true)} />
            </Glass>
          </Animated.View>
        ) : (
          <View>
            <Glass style={styles.features}>
              {FEATURES.map((f, i) => (
                <View key={f.title}>
                  {i > 0 ? <Divider inset={FEATURE_INSET} /> : null}
                  <View style={styles.feature}>
                    <IconTile name={f.icon} color={f.color} size={36} />
                    <View style={styles.flex}>
                      <Text style={styles.featureTitle}>{f.title}</Text>
                      <Text style={type.caption}>{f.text}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </Glass>

            <GlassButton
              title="Войти через Telegram"
              variant="telegram"
              icon="telegram"
              loading={phase === 'starting'}
              onPress={() => void begin(true)}
              style={styles.signIn}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Text style={styles.note}>
              Вход через бота @titanwalletrobot. Ваш Telegram должен быть привязан к профилю в клубе — если нет, попросите администратора.
            </Text>
            <GlassButton
              title="Посмотреть демо"
              variant="secondary"
              size="md"
              style={styles.demo}
              onPress={() => { resetDemo(); enterDemo(); }}
            />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  container: { paddingHorizontal: GUTTER, flexGrow: 1 },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  intro: { marginTop: space.xxl, marginBottom: space.xl },
  kicker: { color: colors.violetLight, fontSize: 12, fontWeight: '900', letterSpacing: 3 },
  headline: { ...StyleSheet.flatten(type.title), marginTop: 6 },
  centered: { textAlign: 'center' },
  features: { borderRadius: radius.card, overflow: 'hidden' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  featureTitle: { color: colors.text, fontSize: 15.5, fontWeight: '700' },
  signIn: { marginTop: space.xl },
  error: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: space.md },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: space.md, paddingHorizontal: space.sm },
  demo: { marginTop: space.lg },
  card: { padding: space.lg, borderRadius: radius.card },
  waitFallback: { borderColor: 'rgba(42,171,238,0.3)' },
  rejectFallback: { borderColor: 'rgba(251,191,36,0.3)' },
  waitHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardText: { ...StyleSheet.flatten(type.callout), color: colors.textSecondary, marginTop: space.sm },
  cardButton: { marginTop: space.lg },
  codeBlock: {
    marginTop: space.xl, paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)', alignItems: 'center',
  },
  codeRow: { flexDirection: 'row', gap: 10, marginTop: space.md },
  codeDigit: { width: 54, height: 66, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  codeFallback: { backgroundColor: colors.violetTint, borderColor: 'rgba(139,92,246,0.35)' },
  codeText: { color: '#fff', fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: space.sm, marginBottom: space.sm },
  copyHint: { color: colors.lavender, fontSize: 12, fontWeight: '600' },
});
