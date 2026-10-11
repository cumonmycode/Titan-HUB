import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { SheetHeader, sheetStyles } from '@/components/new-check-parts';
import { PlayerSearch } from '@/components/player-picker';
import { haptic } from '@/lib/haptics';
import { space, type } from '@/lib/theme';

/** Поиск клиента для операции с балансом: выбор закрывает шторку и открывает карточку клиента. */
export default function FindClientSheet() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  return (
    <View style={styles.sheet}>
      <SheetHeader title="Найти клиента" onClose={() => router.back()} />
      {!query.trim() && <Text style={[type.footnote, sheetStyles.secondary, styles.hint]}>В карточке клиента — пополнение и списание депозита, долг и его погашение.</Text>}
      <PlayerSearch
        query={query}
        onQuery={setQuery}
        onPlayer={(player) => {
          haptic.selection();
          router.back();
          setTimeout(() => router.push({ pathname: '/manage/clients/[clientId]', params: { clientId: player.id } }), 380);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.lg, gap: space.md },
  hint: { textAlign: 'center', paddingHorizontal: space.lg },
});
