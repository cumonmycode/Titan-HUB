import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { ClientMoveRow } from '@/components/client-moves';
import { Card, InfoRow } from '@/components/profile-parts';
import { AppRefreshControl } from '@/components/refresh-control';
import { useClientTransactions } from '@/lib/clients-api';
import { usePageGutter } from '@/lib/layout';
import { colors, space } from '@/lib/theme';

/** Вся история клиента: деньги, бонусы и посещения; движение с чеком открывает чек. */
export default function ClientHistoryScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const gutter = usePageGutter();
  const history = useClientTransactions(clientId);
  const [pulling, setPulling] = useState(false);
  const moves = history.data ?? [];

  return (
    <View style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        refreshControl={
          <AppRefreshControl
            tintColor={colors.accent}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void history.refetch().finally(() => setPulling(false));
            }}
          />
        }
      >
        {history.isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <Card footer={moves.length ? 'Последние 50 движений. Движение с чеком открывает чек.' : undefined}>
            {moves.length === 0 ? (
              <InfoRow label="Движений пока не было" muted />
            ) : (
              moves.map((tx) => (
                <ClientMoveRow key={tx.id} tx={tx} onPress={tx.checkId ? () => router.push({ pathname: '/pos/[checkId]', params: { checkId: tx.checkId! } }) : undefined} />
              ))
            )}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { paddingTop: space.md, paddingBottom: space.xxxl },
  loading: { marginTop: space.xxl },
});
