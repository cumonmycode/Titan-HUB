import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { EmptyNote, SectionTitle } from '@/components/smm/parts';
import { Text } from '@/components/text';
import { ToolbarButton } from '@/components/toolbar';
import { api, ApiError } from '@/lib/api';
import { chooseAction, promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { usePageGutter } from '@/lib/layout';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { useSmmMemory, type SmmMemory, type SmmMemoryKind } from '@/lib/smm-api';
import { colors, space, type } from '@/lib/theme';

const KINDS: { kind: SmmMemoryKind; title: string; hint: string }[] = [
  { kind: 'voice', title: 'Голос и стиль', hint: 'Как звучим' },
  { kind: 'rule', title: 'Правила', hint: 'Что делать всегда' },
  { kind: 'avoid', title: 'Нельзя', hint: 'Чего избегать' },
  { kind: 'fact', title: 'Факты о клубе', hint: 'Что Tai должен знать' },
  { kind: 'insight', title: 'Выводы из аналитики', hint: 'Что сработало' },
];

const SOURCE: Record<SmmMemory['source'], string> = { staff: 'добавлено вручную', remark: 'из замечания', analytics: 'из отчёта' };

/**
 * Память Tai по СММ: правила владельца, выводы из замечаний и аналитики. Tai учитывает
 * её в каждом плане и посте; лишнее можно удалить, своё — добавить.
 */
export default function SmmMemoryScreen() {
  const club = useClubKey();
  const gutter = usePageGutter();
  const query = useSmmMemory();
  const memory = query.data?.memory ?? [];
  const key = [club, 'smm', 'memory'];

  const fail = (error: unknown) => Alert.alert('Не получилось', error instanceof ApiError ? error.message : String(error));
  const add = () =>
    chooseAction('Что запомнить?', undefined, [
      ...KINDS.filter((k) => k.kind !== 'insight').map((k) => ({
        text: k.title,
        onPress: () =>
          promptText(k.title, 'Одна мысль — коротко. Например: «Не пишем слово „уникальный“» или «Турниры анонсируем за неделю».', [
            { text: 'Отмена', style: 'cancel' },
            {
              text: 'Запомнить',
              onPress: (text?: string) => {
                if (!text?.trim()) return;
                void api
                  .post<{ memory: SmmMemory[] }>('/smm/memory', { kind: k.kind, text: text.trim() })
                  .then((r) => {
                    queryClient.setQueryData(key, r);
                    haptic.success();
                  })
                  .catch(fail);
              },
            },
          ]),
      })),
      { text: 'Отмена', style: 'cancel' },
    ]);

  const remove = (item: SmmMemory) =>
    Alert.alert('Забыть?', item.text, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Забыть',
        style: 'destructive',
        onPress: () =>
          void api
            .delete<{ memory: SmmMemory[] }>(`/smm/memory/${item.id}`)
            .then((r) => queryClient.setQueryData(key, r))
            .catch(fail),
      },
    ]);

  return (
    <View style={styles.screen}>
      <Stack.Title>Память Tai</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton icon="plus" accessibilityLabel="Добавить" onPress={add} />
      </Stack.Toolbar>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, gutter]}>
        <Text style={[type.subhead, styles.secondary]}>Tai учитывает это в каждом плане и посте. Замечания вида «никогда так не пиши» он запоминает сам, выводы из отчётов — тоже.</Text>
        {!memory.length && !query.isLoading ? (
          <EmptyNote icon="brain.head.profile" title="Пока пусто" text="Оставляйте замечания к постам — общие правила Tai запомнит сам. Или добавьте их кнопкой «+»." />
        ) : null}
        {KINDS.map((k) => {
          const items = memory.filter((m) => m.kind === k.kind);
          if (!items.length) return null;
          return (
            <View key={k.kind} style={styles.group}>
              <SectionTitle title={k.title} />
              {items.map((item) => (
                <View key={item.id} style={styles.item}>
                  <View style={styles.flex}>
                    <Text style={[type.body, styles.label]} selectable>
                      {item.text}
                    </Text>
                    <Text style={[type.caption1, styles.secondary]}>{SOURCE[item.source]}</Text>
                  </View>
                  <Pressable onPress={() => remove(item)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Забыть">
                    <SymbolView name="trash" size={16} tintColor={colors.tertiaryLabel} />
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.groupedBackground },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  content: { gap: space.md, paddingTop: space.md, paddingBottom: space.xxxl },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  group: { gap: space.sm },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: 16, borderCurve: 'continuous', backgroundColor: colors.card },
});
