import * as Device from 'expo-device';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { PinDots, PinPad, type PinKey } from '@/components/pin-pad';
import { api, ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useSession, type SessionUser } from '@/lib/session';
import { colors, space, type } from '@/lib/theme';

const PIN_LENGTH = 4;
const POLL_MS = 2000;
const TELEGRAM_BLUE = '#2AABEE';

type Start = { ticket: string; deepLink: string; expiresAt: string };
type Status =
  | { status: 'pending'; opened: boolean }
  | { status: 'ok'; token: string; user: SessionUser; hasPin: boolean }
  | { status: 'rejected'; note?: string | null }
  | { status: 'expired' };

type Pending = { token: string; user: SessionUser };

/**
 * Первый вход в Titan HUB на устройстве — через Tai в Telegram: сотрудник жмёт
 * «Войти» у бота, приложение получает сессию. Нет PIN — сразу придумываем его:
 * дальше касса открывается по Face ID или этому PIN.
 */
export default function LoginScreen() {
  const club = useSession((s) => s.club);
  const [pending, setPending] = useState<Pending | null>(null);

  const changeClub = () => {
    Alert.alert('Сменить клуб?', `Сейчас выбран ${club?.name ?? 'клуб'} (${club?.host}).`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сменить', onPress: () => void useSession.getState().forgetClub() },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
      {pending ? (
        <PinSetup pending={pending} />
      ) : (
        <TelegramStep clubName={club?.name ?? 'Titan HUB'} onAuthorized={async (p, hasPin) => {
          if (hasPin) await useSession.getState().signIn(p.token, p.user);
          else setPending(p);
        }} />
      )}
      {!pending && (
        <Pressable onPress={changeClub} hitSlop={12} accessibilityRole="button">
          <Text style={[type.body, styles.link]}>Сменить клуб</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function TelegramStep({ clubName, onAuthorized }: { clubName: string; onAuthorized: (p: Pending, hasPin: boolean) => Promise<void> }) {
  const [start, setStart] = useState<Start | null>(null);
  const [opened, setOpened] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticket = useRef<string | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const poll = async () => {
    const t = ticket.current;
    if (!t) return;
    stop();
    try {
      const r = await api.get<Status>(`/auth/hub/status?ticket=${t}`, { auth: false });
      if (r.status === 'ok') {
        ticket.current = null;
        haptic.success();
        await onAuthorized({ token: r.token, user: r.user }, r.hasPin);
        return;
      }
      if (r.status === 'rejected' || r.status === 'expired') {
        ticket.current = null;
        setStart(null);
        haptic.error();
        setError(r.status === 'rejected' ? r.note || 'Вход отклонён в Telegram' : 'Ссылка устарела — нажмите «Войти через Telegram» ещё раз');
        return;
      }
      setOpened(r.opened);
    } catch {
      // Сеть моргнула — спросим ещё раз.
    }
    timer.current = setTimeout(() => void poll(), POLL_MS);
  };

  useEffect(() => {
    // Вернулись из Telegram — проверяем сразу, не дожидаясь таймера.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && ticket.current) void poll();
    });
    return () => {
      sub.remove();
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const begin = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    setOpened(false);
    try {
      const s = await api.post<Start>('/auth/hub/start', { deviceName: Device.deviceName ?? undefined, platform: Platform.OS === 'ios' ? 'ios' : 'android' }, { auth: false });
      ticket.current = s.ticket;
      setStart(s);
      await Linking.openURL(s.deepLink);
      timer.current = setTimeout(() => void poll(), POLL_MS);
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError ? e.message : 'Не удалось открыть Telegram');
    } finally {
      setStarting(false);
    }
  };

  const waiting = !!start;
  return (
    <View style={styles.block}>
      <Text style={[type.subhead, styles.secondary]} numberOfLines={1}>{clubName}</Text>
      <Text style={[type.title2, styles.title]}>{waiting ? 'Подтвердите в Telegram' : 'Вход в кассу'}</Text>
      <Text style={[type.body, styles.secondary, styles.center]}>
        {waiting
          ? opened
            ? 'Нажмите «Войти» у Tai и вернитесь в приложение'
            : 'Откройте бота клуба Tai и подтвердите вход'
          : 'Первый вход на этом телефоне — через Tai в Telegram. Дальше касса будет открываться по Face ID или PIN.'}
      </Text>
      <Pressable onPress={() => void (start ? Linking.openURL(start.deepLink) : begin())} disabled={starting}
        style={({ pressed }) => [styles.telegram, (pressed || starting) && styles.pressed]} accessibilityRole="button">
        {starting ? <ActivityIndicator color="#fff" /> : <Text style={[type.headline, styles.telegramText]}>{waiting ? 'Открыть Telegram' : 'Войти через Telegram'}</Text>}
      </Pressable>
      {waiting && (
        <View style={styles.waitRow}>
          <ActivityIndicator color={colors.secondaryLabel} />
          <Text style={[type.subhead, styles.secondary]}>Ждём подтверждения…</Text>
        </View>
      )}
      {error && <Text style={[type.subhead, styles.error]}>{error}</Text>}
    </View>
  );
}

/** Первый вход: PIN, которым касса будет разблокироваться (вместе с Face ID). */
function PinSetup({ pending }: { pending: Pending }) {
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const finish = async (code: string) => {
    setBusy(true);
    try {
      await api.post('/auth/pin/set', { pin: code }, { token: pending.token });
      haptic.success();
      await useSession.getState().signIn(pending.token, pending.user);
    } catch (e) {
      haptic.error();
      setFirst(null);
      setPin('');
      setShakeKey((k) => k + 1);
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить PIN');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (key: PinKey) => {
    if (busy) return;
    if (key === 'delete') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + key;
    setPin(next);
    if (next.length < PIN_LENGTH) return;
    if (!first) {
      setFirst(next);
      setPin('');
      setError(null);
    } else if (first === next) {
      void finish(next);
    } else {
      haptic.error();
      setFirst(null);
      setPin('');
      setShakeKey((k) => k + 1);
      setError('PIN не совпал — придумайте заново');
    }
  };

  return (
    <View style={styles.block}>
      <Text style={[type.subhead, styles.secondary]}>{pending.user.nickname}</Text>
      <Text style={[type.title2, styles.title]}>{first ? 'Повторите PIN' : 'Придумайте PIN'}</Text>
      <Text style={[type.body, styles.secondary, styles.center]}>4 цифры — для разблокировки кассы, если Face ID не сработал.</Text>
      <PinDots length={PIN_LENGTH} filled={busy ? PIN_LENGTH : pin.length} shakeKey={shakeKey} />
      {error && <Text style={[type.subhead, styles.error]}>{error}</Text>}
      <PinPad onKey={onKey} disabled={busy} canDelete={pin.length > 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'space-evenly',
    alignItems: 'center',
    paddingHorizontal: space.xl,
  },
  block: { alignItems: 'center', gap: space.md, alignSelf: 'stretch' },
  title: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  center: { textAlign: 'center' },
  link: { color: colors.accent },
  error: { color: colors.red, textAlign: 'center' },
  telegram: {
    alignSelf: 'stretch',
    minHeight: 52,
    marginTop: space.md,
    borderRadius: 999,
    backgroundColor: TELEGRAM_BLUE,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  pressed: { opacity: 0.75 },
  telegramText: { color: '#fff' },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
