// Шлагбаум обновления Android-версии HUB: если на сервере версия новее (lib/app-update.ts),
// вместо приложения — экран «Доступна новая версия» с единственной кнопкой «Обновить».
// Проверка — при запуске и при каждом возвращении в приложение. На iOS не работает
// (там обновляет TestFlight / App Store).
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/text';
import { downloadAndInstall, requiredUpdate, type UpdateInfo } from '@/lib/app-update';
import { haptic } from '@/lib/haptics';
import { colors, radius, space, type } from '@/lib/theme';

const IS_ANDROID = Platform.OS === 'android';
const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Не получилось скачать обновление');

export function UpdateGate({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: ['app-update'], queryFn: requiredUpdate, enabled: IS_ANDROID, staleTime: 0, retry: false });
  const { refetch } = query;

  useEffect(() => {
    if (!IS_ANDROID) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  return query.data ? <UpdateScreen info={query.data} /> : children;
}

function UpdateScreen({ info }: { info: UpdateInfo }) {
  const insets = useSafeAreaInsets();
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function install() {
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      await downloadAndInstall(info, setProgress);
      haptic.success();
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const percent = progress != null ? Math.round(progress * 100) : null;
  const label = busy ? (percent != null ? `Загружаю… ${percent}%` : 'Загружаю…') : error ? 'Попробовать снова' : 'Обновить';

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xxxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.column}>
        <View style={styles.center}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>↑</Text>
          </View>
          <Text style={[type.title1, styles.label, styles.centerText]} accessibilityRole="header">Доступна новая версия</Text>
          <Text style={[type.body, styles.secondary, styles.centerText]}>
            Titan HUB {info.versionName} уже готов. Чтобы продолжить работу, обновите приложение — это займёт меньше минуты.
          </Text>
          {info.notes ? <Text style={[type.subhead, styles.label, styles.centerText]}>{info.notes}</Text> : null}
        </View>
        {busy && percent != null ? (
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
            <View style={[styles.fill, { width: `${percent}%` }]} />
          </View>
        ) : null}
        {error ? <Text style={[type.subhead, styles.error, styles.centerText]}>{error}</Text> : null}
        <Pressable
          onPress={() => void install()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={({ pressed }) => [styles.button, (pressed || busy) && styles.buttonDim]}
        >
          {busy && percent == null ? <ActivityIndicator color="#fff" /> : <Text style={[type.headline, styles.buttonText]}>{label}</Text>}
        </Pressable>
        <Text style={[type.footnote, styles.secondary, styles.centerText]}>Если телефон спросит про установку из этого источника — разрешите её для Titan HUB.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.groupedBackground, paddingHorizontal: space.xl, justifyContent: 'center' },
  column: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: space.lg },
  center: { alignItems: 'center', gap: space.md, marginBottom: space.xl },
  centerText: { textAlign: 'center' },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  error: { color: colors.red },
  badge: { width: 72, height: 72, borderRadius: 22, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  badgeText: { color: '#fff', fontSize: 34, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.fill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
  button: { height: 52, borderRadius: radius.control, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  buttonDim: { opacity: 0.7 },
  buttonText: { color: '#fff' },
});
