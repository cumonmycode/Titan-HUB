import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { SheetHeader } from '@/components/new-check-parts';
import { PlayerSearch } from '@/components/player-picker';
import { Text } from '@/components/text';
import { setClientReferrer, useClient } from '@/lib/clients-api';
import { haptic } from '@/lib/haptics';
import type { PlayerSearchItem } from '@/lib/pos-api';
import { colors, space, type } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Кто пригласил клиента: поиск по клиентам клуба; можно убрать. */
export default function ReferrerSheet() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const client = useClient(clientId);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const inviter = client.data?.referral?.inviter ?? null;

  const apply = async (referrerId: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      await setClientReferrer(clientId, referrerId);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <SheetHeader title="Кто пригласил" onClose={() => router.back()} />
      <Text style={[type.footnote, styles.hint]}>
        {inviter ? `Сейчас: ${inviter.nickname}. Найдите другого клиента, чтобы заменить.` : `Найдите клиента, который привёл ${client.data?.nickname ?? 'гостя'}.`}
      </Text>
      <PlayerSearch query={query} onQuery={setQuery} onPlayer={(p: PlayerSearchItem) => void apply(p.id)} excludeId={clientId} />
      {inviter && (
        <Pressable style={({ pressed }) => [styles.textButton, pressed && styles.pressed]} onPress={() => void apply(null)} disabled={busy} accessibilityRole="button">
          <Text style={[type.subhead, styles.destructive]}>{busy ? 'Сохраняем…' : 'Убрать пригласившего'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.md, gap: space.md },
  hint: { color: colors.secondaryLabel, paddingHorizontal: space.xs },
  textButton: { alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.xs },
  destructive: { color: colors.red, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
