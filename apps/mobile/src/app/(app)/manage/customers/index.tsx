import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/new-check-parts';
import { useDebounced } from '@/components/player-picker';
import { Card } from '@/components/profile-parts';
import { AppRefreshControl } from '@/components/refresh-control';
import { Text, TextInput } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { useCustomerList, type CustomerRow } from '@/lib/clients-api';
import { monthShort } from '@/lib/events-api';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { colors, space, type } from '@/lib/theme';

/**
 * Заказчики мероприятий — контакты из броней и мероприятий. В строке: кто, телефон и
 * сколько мероприятий было; нажатие открывает карточку со связью и историей мероприятий.
 */
export default function CustomersScreen() {
  const router = useRouter();
  const gutter = usePageGutter();
  const [query, setQuery] = useState('');
  const search = useDebounced(query, 300);
  const customers = useCustomerList(search);
  const [pulling, setPulling] = useState(false);
  const list = customers.data ?? [];
  const searching = search.trim().length > 0;

  const caption = searching
    ? list.length >= 8
      ? 'Первые 8 совпадений — уточните запрос'
      : `Найдено: ${list.length}`
    : `${list.length} ${plural(list.length, ['заказчик', 'заказчика', 'заказчиков'])} · из броней и мероприятий`;

  return (
    <View style={styles.screen}>
      <Stack.Title>Заказчики</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton icon="plus" accessibilityLabel="Новый заказчик" onPress={() => router.push('/manage/customers/edit')} />
      </Stack.Toolbar>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.content, gutter]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <AppRefreshControl
            tintColor={colors.accent}
            refreshing={pulling}
            onRefresh={() => {
              setPulling(true);
              void customers.refetch().finally(() => setPulling(false));
            }}
          />
        }
      >
        <View style={styles.search}>
          <SymbolView name="magnifyingglass" size={16} tintColor={colors.secondaryLabel} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Имя или телефон"
            placeholderTextColor={colors.tertiaryLabel}
            selectionColor={colors.accent}
            style={[type.body, styles.searchInput]}
            returnKeyType="search"
            accessibilityLabel="Поиск заказчика"
          />
        </View>

        {customers.isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : list.length === 0 ? (
          <View style={styles.empty}>
            <SymbolView name="person.crop.rectangle.stack" size={40} tintColor={colors.tertiaryLabel} />
            <Text style={[type.headline, styles.label]}>{searching ? 'Никого не нашли' : 'Заказчиков пока нет'}</Text>
            <Text style={[type.subhead, styles.secondary, styles.centerText]}>
              {searching ? 'Проверьте имя или номер.' : 'Они появятся из броней и мероприятий — или добавьте вручную кнопкой «+».'}
            </Text>
          </View>
        ) : (
          <Card footer={caption}>
            {list.map((customer) => (
              <CustomerLine
                key={customer.id}
                customer={customer}
                onPress={() => {
                  haptic.selection();
                  router.push({ pathname: '/manage/customers/[customerId]', params: { customerId: customer.id } });
                }}
              />
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function CustomerLine({ customer, onPress }: { customer: CustomerRow; onPress: () => void }) {
  const name = customer.name || 'Без имени';
  const events = customer.events ?? 0;
  const details = [customer.phone || 'нет телефона', events ? `${events} ${plural(events, ['мероприятие', 'мероприятия', 'мероприятий'])}` : null].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={name}>
      <Avatar name={name} size={40} />
      <View style={styles.flex}>
        <Text style={[type.body, customer.name ? styles.label : styles.secondary, styles.bold]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[type.footnote, styles.secondary]} numberOfLines={1}>
          {details}
        </Text>
      </View>
      {customer.lastDate ? <Text style={[type.footnote, styles.secondary]}>{`${Number(customer.lastDate.slice(8, 10))} ${monthShort(customer.lastDate)}`}</Text> : null}
      <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  content: { gap: space.lg, paddingTop: space.sm, paddingBottom: space.xxxl },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.fill, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: space.md, minHeight: 40 },
  searchInput: { flex: 1, color: colors.label, paddingVertical: 8 },
  loading: { marginTop: space.xxl },
  empty: { alignItems: 'center', gap: space.sm, paddingTop: space.xxxl, paddingHorizontal: space.xl },
  centerText: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10, minHeight: 60 },
  pressed: { backgroundColor: colors.fill },
  flex: { flex: 1, minWidth: 0 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  bold: { fontWeight: '600' },
});
