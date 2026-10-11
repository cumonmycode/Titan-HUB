import { ContentUnavailableView, Host, Label, List, ProgressView, Section, Text as SwiftText } from '@expo/ui/swift-ui';
import { environment, foregroundStyle, listStyle } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { categoryHex, categorySymbol, reorderCategories, reorderItems, useMenuAdmin } from '@/lib/catalog-api';
import { haptic } from '@/lib/haptics';
import { useAccentHex } from '@/lib/theme';

type Row = { id: string; title: string; icon: ReturnType<typeof categorySymbol>; color: string };

/** SwiftUI `onMove`: индексы источников и место вставки в исходном массиве. */
function moveRows<T>(list: T[], sources: number[], destination: number): T[] {
  const moving = sources.map((index) => list[index]!);
  const rest = list.filter((_, index) => !sources.includes(index));
  const at = destination - sources.filter((index) => index < destination).length;
  rest.splice(at, 0, ...moving);
  return rest;
}

/**
 * Порядок категорий или позиций категории — системный список iOS в режиме правки:
 * тянете за «ручку» справа, «Сохранить» записывает порядок так, как его увидит касса.
 */
export default function ReorderSheet() {
  const { scope, categoryId } = useLocalSearchParams<{ scope: 'categories' | 'items'; categoryId?: string }>();
  const router = useRouter();
  const menu = useMenuAdmin();
  const data = menu.data;

  if (!data) {
    return (
      <ListHost>
        <ProgressView />
      </ListHost>
    );
  }

  const ids = new Set(data.categories.map((c) => c.id));
  const rows: Row[] =
    scope === 'categories'
      ? data.categories.map((c) => ({ id: c.id, title: c.name, icon: categorySymbol(c.icon), color: categoryHex(c.color) }))
      : data.items
          .filter((i) => (categoryId === 'none' ? !i.category || !ids.has(i.category) : i.category === categoryId))
          .map((i) => ({ id: i.id, title: i.name, icon: i.isActive ? 'line.3.horizontal' : 'eye.slash', color: '#94A3B8' }));

  return <ReorderList scope={scope} rows={rows} data={data} onClose={() => router.back()} />;
}

function ReorderList({
  scope,
  rows,
  data,
  onClose,
}: {
  scope: 'categories' | 'items';
  rows: Row[];
  data: NonNullable<ReturnType<typeof useMenuAdmin>['data']>;
  onClose: () => void;
}) {
  const [order, setOrder] = useState(rows);
  const [busy, setBusy] = useState(false);
  const changed = order.some((row, index) => row.id !== rows[index]?.id);

  const save = async () => {
    haptic.medium();
    setBusy(true);
    try {
      if (scope === 'categories') {
        // Категория «Тарифы» скрыта из меню — оставляем её в конце, как веб.
        const tariffCats = data.allCategories.filter((c) => !order.some((row) => row.id === c.id));
        await reorderCategories([...order.map((row) => row.id), ...tariffCats.map((c) => c.id)].map((id, index) => ({ id, sortOrder: index })));
      } else {
        // Переставляем только позиции категории, места остальных в общем порядке сохраняются.
        const all = [...data.items].sort((a, b) => a.sortOrder - b.sortOrder);
        const subset = new Set(order.map((row) => row.id));
        const queue = order.map((row) => row.id);
        const merged = all.map((item) => (subset.has(item.id) ? queue.shift()! : item.id));
        await reorderItems(merged.map((id, index) => ({ id, sortOrder: index })));
      }
      haptic.success();
      onClose();
    } catch (error) {
      haptic.error();
      Alert.alert('Порядок не сохранён', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title={scope === 'categories' ? 'Порядок категорий' : 'Порядок позиций'} canSave={changed} busy={busy} onSave={() => void save()} />
      <ListHost>
        {order.length === 0 ? (
          <ContentUnavailableView title="Переставлять нечего" systemImage="arrow.up.arrow.down" />
        ) : (
          <List modifiers={[environment('editMode', 'active'), listStyle('insetGrouped')]}>
            <Section
              footer={
                <SwiftText>{`${Platform.OS === 'ios' ? 'Потяните за полоски справа.' : 'Двигайте строки стрелками справа.'} Так же порядок увидят касса и планшеты.`}</SwiftText>
              }
            >
              <List.ForEach
                onMove={(sources, destination) => {
                  haptic.selection();
                  setOrder((current) => moveRows(current, sources, destination));
                }}
              >
                {order.map((row) => (
                  <Label key={row.id} title={row.title} systemImage={row.icon} modifiers={[foregroundStyle(row.color)]} />
                ))}
              </List.ForEach>
            </Section>
          </List>
        )}
      </ListHost>
    </>
  );
}

/**
 * Настоящий SwiftUI Host: этот экран исключён из RN-слоя форм на iOS (metro.config.js) —
 * перетаскивание строк List в режиме правки есть только у SwiftUI.
 */
function ListHost({ children }: { children: React.ReactNode }) {
  const accent = useAccentHex();
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement seedColor={accent}>
      {children}
    </Host>
  );
}
