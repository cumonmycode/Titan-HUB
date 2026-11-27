import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { ToolbarButton } from '@/components/toolbar';
import { haptic } from '@/lib/haptics';
import { itemTitle, PAGE_IDS, PAGE_LOOK, saveContentSection, SECTION_LOOK, useSiteContent, type ListItem, type ListSectionId, type SectionId } from '@/lib/site-content-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const SECTIONS: SectionId[] = ['formats', 'team', 'reviews', 'values', 'docs', 'pages'];

/**
 * Раздел содержимого сайта: форматы, команда, отзывы, ценности, документы или тексты
 * страниц. Тап — редактор элемента; что поменяли — через минуту на сайте.
 */
export default function SiteContentScreen() {
  const params = useLocalSearchParams<{ section?: string }>();
  const section = (SECTIONS.includes(params.section as SectionId) ? params.section : 'formats') as SectionId;
  const router = useRouter();
  const content = useSiteContent();
  const [busy, setBusy] = useState(false);
  const look = SECTION_LOOK[section];
  const data = content.data;

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {content.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={content.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const edited = data.edited.includes(section);
  const open = (index: string) => router.push({ pathname: '/manage/settings/site/content-item', params: { section, index } });

  const reset = () =>
    Alert.alert('Вернуть тексты сайта?', `«${look.title}» станут такими, как были на сайте до правок.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Вернуть',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await saveContentSection(section, null);
            haptic.success();
          } catch (error) {
            haptic.error();
            Alert.alert('Не получилось', errorText(error));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const list = section === 'pages' ? [] : (data.content[section as ListSectionId] as ListItem[]);

  return (
    <>
      <Stack.Title>{look.title}</Stack.Title>
      {section !== 'pages' && section !== 'formats' ? (
        <Stack.Toolbar placement="right">
          <ToolbarButton icon="plus" accessibilityLabel={`Добавить: ${look.item}`} onPress={() => open('new')} />
        </Stack.Toolbar>
      ) : null}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await content.refetch()))]}>
          <Section footer={<Text>{`${look.about}${edited ? '' : ' Сейчас — тексты сайта по умолчанию.'}`}</Text>}>
            {section === 'pages'
              ? PAGE_IDS.map((id) => (
                  <LinkRow key={id} icon="doc.text" color={look.color} title={PAGE_LOOK[id].title} subtitle={data.content.pages[id].lead} onPress={() => open(id)} />
                ))
              : list.map((item, i) => {
                  const t = itemTitle(section as ListSectionId, item);
                  return <LinkRow key={`${i}-${t.title}`} icon={look.icon} color={look.color} title={t.title} subtitle={t.subtitle} onPress={() => open(String(i))} />;
                })}
            {section !== 'pages' && !list.length ? <Text>Пусто — добавьте кнопкой «+».</Text> : null}
          </Section>
          {edited ? (
            <Section>
              <ActionRow title="Вернуть тексты сайта по умолчанию" icon="arrow.uturn.backward" destructive disabled={busy} onPress={reset} />
            </Section>
          ) : null}
        </Form>
      </Host>
    </>
  );
}
