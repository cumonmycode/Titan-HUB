// Шлагбаум обновления Android-версии: если на сервере версия новее (lib/app-update.ts),
// вместо приложения — экран «Доступна новая версия» с единственной кнопкой «Обновить».
// Проверка — при запуске и при каждом возвращении в приложение. На iOS не работает
// (там обновляет App Store).
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { downloadAndInstall, requiredUpdate, type UpdateInfo } from '@/lib/app-update';
import { errorText } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { backdrop, colors, GUTTER, IS_IOS, MAX_WIDTH, radius, space, type } from '@/lib/theme';

import { GlassButton } from './glass';
import { IconTile } from './ui';

export function UpdateGate({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: ['app-update'], queryFn: requiredUpdate, enabled: !IS_IOS, staleTime: 0, retry: false });
  const { refetch } = query;

  useEffect(() => {
    if (IS_IOS) return;
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

  const label = busy
    ? progress != null ? `Загружаю… ${Math.round(progress * 100)}%` : 'Загружаю…'
    : error ? 'Попробовать снова' : 'Обновить';

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xxxl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.column}>
        <View style={styles.center}>
          <IconTile name="refresh" color={colors.violetLight} size={72} />
          <Text style={styles.title} accessibilityRole="header">Доступна новая версия</Text>
          <Text style={styles.text}>
            My Titan {info.versionName} уже готов. Чтобы продолжить, обновите приложение — это займёт меньше минуты.
          </Text>
          {info.notes ? <Text style={styles.notes}>{info.notes}</Text> : null}
        </View>
        {busy && progress != null ? (
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
            <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <GlassButton title={label} icon="deposit" loading={busy && progress == null} disabled={busy} onPress={() => void install()} />
        <Text style={styles.hint}>Если телефон спросит про установку из этого источника — разрешите её для My Titan.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...backdrop, flex: 1, paddingHorizontal: GUTTER, justifyContent: 'center' },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: space.lg },
  center: { alignItems: 'center', gap: space.md, marginBottom: space.xl },
  title: { ...StyleSheet.flatten(type.title), textAlign: 'center', marginTop: space.md },
  text: { ...StyleSheet.flatten(type.body), color: colors.textSecondary, textAlign: 'center' },
  notes: { ...StyleSheet.flatten(type.callout), textAlign: 'center' },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.violet },
  error: { ...StyleSheet.flatten(type.callout), color: colors.red, textAlign: 'center' },
  hint: { ...StyleSheet.flatten(type.caption), textAlign: 'center' },
});
