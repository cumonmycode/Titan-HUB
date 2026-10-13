import { Button, ContentUnavailableView, Form, HStack, Image, ProgressView, Section, Spacer, Text } from '@expo/ui/swift-ui';
import { foregroundStyle, lineLimit } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FormHost, primary, SearchRow, secondary, tertiary } from '@/components/native-form';
import { formatMoney } from '@/lib/format';
import { useGoods } from '@/lib/goods-api';
import { haptic } from '@/lib/haptics';
import { usePickDraft } from '@/lib/loyalty-api';
import { useAccentHex } from '@/lib/theme';

type Row = { id: string; title: string; hint: string | null };

/**
 * Выбор категорий меню или позиций — для «на что действует» скидки или сертификата.
 * Отметьте нужное и «Готово». Ингредиенты не показываются: их не продают.
 */
export default function PickScreen() {
  const router = useRouter();
  const goods = useGoods();
  const accent = useAccentHex();
  const kind = usePickDraft((s) => s.kind);
  const initial = usePickDraft((s) => s.selected);
  const onDone = usePickDraft((s) => s.onDone);
  const [selected, setSelected] = useState<string[]>(initial);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const groups = useMemo((): { id: string; title: string; rows: Row[] }[] => {
    if (!goods.data) return [];
    const categories = [...goods.data.categories].sort((a, b) => a.sortOrder - b.sortOrder);
    if (kind === 'categories') {
      return [{ id: 'all', title: 'Категории', rows: categories.filter((c) => !q || c.name.toLowerCase().includes(q)).map((c) => ({ id: c.id, title: c.name, hint: null })) }];
    }
    const items = goods.data.items.filter((i) => i.kind !== 'ingredient' && i.isActive && (!q || i.name.toLowerCase().includes(q)));
    const row = (i: (typeof items)[number]): Row => ({ id: i.id, title: i.name, hint: formatMoney(i.price) });
    const out = categories.map((c) => ({ id: c.id, title: c.name, rows: items.filter((i) => i.category === c.id).map(row) }));
    const loose = items.filter((i) => !i.category || !categories.some((c) => c.id === i.category));
    if (loose.length) out.push({ id: 'none', title: 'Без категории', rows: loose.map(row) });
    return out.filter((g) => g.rows.length > 0);
  }, [goods.data, kind, q]);

  const toggle = (id: string) => {
    haptic.selection();
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  return (
    <>
      <EditorToolbar
        title={kind === 'categories' ? 'Категории' : 'Позиции'}
        canSave
        saveLabel={selected.length ? `Готово · ${selected.length}` : 'Готово'}
        onSave={() => {
          onDone?.(selected);
          router.back();
        }}
      />
      <FormHost>
        <Form>
          <Section>
            <SearchRow placeholder={kind === 'categories' ? 'Найти категорию' : 'Найти позицию'} onChange={setQuery} />
          </Section>
          {goods.isLoading ? (
            <Section>
              <ProgressView />
            </Section>
          ) : groups.length === 0 ? (
            <Section>
              <ContentUnavailableView title="Ничего не нашли" systemImage="magnifyingglass" />
            </Section>
          ) : (
            groups.map((g) => (
              <Section key={g.id} title={g.title}>
                {g.rows.map((row) => {
                  const on = selected.includes(row.id);
                  return (
                    <Button key={row.id} onPress={() => toggle(row.id)}>
                      <HStack spacing={12}>
                        <Image systemName={on ? 'checkmark.circle.fill' : 'circle'} size={22} modifiers={[on ? foregroundStyle(accent) : tertiary]} />
                        <Text modifiers={[primary, lineLimit(1)]}>{row.title}</Text>
                        <Spacer />
                        {row.hint ? <Text modifiers={[secondary]}>{row.hint}</Text> : null}
                      </HStack>
                    </Button>
                  );
                })}
              </Section>
            ))
          )}
        </Form>
      </FormHost>
    </>
  );
}
