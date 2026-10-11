import { Button, ContentUnavailableView, ProgressView, Section, SwipeActions, Text } from '@expo/ui/swift-ui';
import { useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { DOC_LOOK, DocRow, docTitle } from '@/components/goods/parts';
import { QuickTile } from '@/components/new-check-parts';
import { deleteRevisionDraft, deleteSupply, deleteWriteOff } from '@/lib/goods-docs';
import { useGoodsDocuments, type GoodsDocument } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { space } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const dayKey = new Intl.DateTimeFormat('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Moscow' });
const dayTitle = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' });

/** «Сегодня», «Вчера» или «8 октября» — заголовок дня в истории. */
function dayLabel(date: Date): string {
  const today = dayKey.format(new Date());
  const yesterday = dayKey.format(new Date(Date.now() - 86400000));
  const key = dayKey.format(date);
  if (key === today) return 'Сегодня';
  if (key === yesterday) return 'Вчера';
  return dayTitle.format(date);
}

/** Куда ведёт документ: черновик — в редактор, проведённый — на просмотр. */
export function docHref(doc: Pick<GoodsDocument, 'type' | 'id' | 'status'>): Href {
  if (doc.status === 'draft') {
    if (doc.type === 'supply') return { pathname: '/manage/goods/supply', params: { draftId: doc.id } };
    if (doc.type === 'write_off') return { pathname: '/manage/goods/write-off', params: { draftId: doc.id } };
    return { pathname: '/manage/goods/revision', params: { draftId: doc.id } };
  }
  return { pathname: '/manage/goods/doc', params: { type: doc.type, id: doc.id } };
}

/**
 * Операции склада (низ вкладки «Склад»): всё, что меняет остатки. Три действия — единственное место,
 * где начинают приход, списание и ревизию; ниже — непроведённые черновики и история по дням.
 */
export function OperationsTab() {
  const router = useRouter();
  const documents = useGoodsDocuments();
  const list = useMemo(() => documents.data ?? [], [documents.data]);
  const drafts = list.filter((d) => d.status === 'draft');

  const history = useMemo(() => {
    const days: { title: string; docs: GoodsDocument[] }[] = [];
    for (const doc of list) {
      if (doc.status === 'draft') continue;
      const title = dayLabel(new Date(doc.createdAt));
      const last = days[days.length - 1];
      if (last && last.title === title) last.docs.push(doc);
      else days.push({ title, docs: [doc] });
    }
    return days;
  }, [list]);

  const removeDraft = (doc: GoodsDocument) =>
    Alert.alert(`Удалить черновик?`, `${docTitle(doc)} — остатки не изменятся.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          const run = doc.type === 'supply' ? deleteSupply : doc.type === 'write_off' ? deleteWriteOff : deleteRevisionDraft;
          run(doc.id)
            .then(() => haptic.success())
            .catch((error: unknown) => Alert.alert('Черновик не удалён', errorText(error)));
        },
      },
    ]);

  return (
    <>
      <View style={styles.tiles}>
        <QuickTile icon={DOC_LOOK.supply.symbol} title="Приход" tint={DOC_LOOK.supply.color} onPress={() => router.push('/manage/goods/supply')} />
        <QuickTile icon={DOC_LOOK.write_off.symbol} title="Списание" tint={DOC_LOOK.write_off.color} onPress={() => router.push('/manage/goods/write-off')} />
        <QuickTile icon={DOC_LOOK.revision.symbol} title="Ревизия" tint={DOC_LOOK.revision.color} onPress={() => router.push('/manage/goods/revision')} />
      </View>

      {drafts.length > 0 && (
        <Section title={`Не проведено · ${drafts.length}`} footer={<Text>Черновики сохраняются сами. Смахните влево, чтобы удалить.</Text>}>
          {drafts.map((doc) => (
            <SwipeActions key={`${doc.type}-${doc.id}`}>
              <DocRow doc={doc} onPress={() => router.push(docHref(doc))} />
              <SwipeActions.Actions edge="trailing" allowsFullSwipe={false}>
                <Button role="destructive" label="Удалить" systemImage="trash" onPress={() => removeDraft(doc)} />
              </SwipeActions.Actions>
            </SwipeActions>
          ))}
        </Section>
      )}

      {documents.isLoading ? (
        <Section>
          <ProgressView />
        </Section>
      ) : documents.isError && list.length === 0 ? (
        <Section>
          <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={documents.error.message} />
        </Section>
      ) : history.length === 0 ? (
        <Section>
          <ContentUnavailableView
            title="Операций ещё не было"
            systemImage="clock.arrow.circlepath"
            description="Проведите приход — остатки и себестоимость обновятся сами."
          />
        </Section>
      ) : (
        history.map((day) => (
          <Section key={day.title} title={day.title}>
            {day.docs.map((doc) => (
              <DocRow key={`${doc.type}-${doc.id}`} doc={doc} onPress={() => router.push(docHref(doc))} />
            ))}
          </Section>
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space.md },
});
