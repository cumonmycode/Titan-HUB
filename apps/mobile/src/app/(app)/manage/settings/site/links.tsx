import { Button, ContentUnavailableView, Form, HStack, Host, Image, ProgressView, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Share } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { ActionRow, FieldRow, LinkRow, secondary } from '@/components/native-form';
import { promptValue } from '@/components/settings-parts';
import { ToolbarButton } from '@/components/toolbar';
import { chooseAction } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { LINK_LOOK, saveSiteLinks, useSiteLinks, type SiteLink, type SiteLinks } from '@/lib/site-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
type Draft = Pick<SiteLinks, 'title' | 'bio' | 'links'>;

/**
 * Таплинк — страница /link для профилей в соцсетях: шапка и кнопки по порядку. Готовые
 * кнопки берут адреса сами (контакты сайта, Tai, адрес клуба); кнопка без адреса не видна.
 */
export default function SiteLinksScreen() {
  const query = useSiteLinks();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ordering, setOrdering] = useState(false);
  const data = query.data;

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {query.isError ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={errorText(query.error)} /> : <ProgressView />}
      </Host>
    );
  }

  const value: Draft = draft ?? { title: data.title, bio: data.bio, links: data.links };
  const commit = (next: Draft) => {
    setDraft(next);
    saveSiteLinks(next)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setDraft(null);
        Alert.alert('Не сохранилось', errorText(error));
      });
  };
  const setLinks = (links: SiteLink[]) => commit({ ...value, links });

  const missing = (l: SiteLink): string | null => {
    const c = data.contacts;
    switch (l.kind) {
      case 'tai':
        return data.taiUrl ? null : 'бот Tai не подключён';
      case 'telegram':
      case 'channel':
      case 'whatsapp':
      case 'vk':
      case 'instagram':
        return c[l.kind] ? null : 'нет в контактах сайта';
      case 'phone':
        return c.phone ? null : 'телефон не указан';
      default:
        return null;
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.links.length) return;
    haptic.selection();
    const next = [...value.links];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setLinks(next);
  };

  const rename = (l: SiteLink) =>
    promptValue({
      title: 'Подпись кнопки',
      message: l.kind === 'custom' ? undefined : `Пусто — «${LINK_LOOK[l.kind].title}»`,
      value: l.label,
      onSubmit: (label) => setLinks(value.links.map((x) => (x.id === l.id ? { ...x, label } : x))),
    });

  const addCustom = () =>
    promptValue({
      title: 'Своя ссылка',
      message: 'Как подписать кнопку',
      value: '',
      onSubmit: (label) => {
        if (!label) return;
        promptValue({
          title: label,
          message: 'Адрес — начинается с https://',
          value: 'https://',
          onSubmit: (url) => {
            if (!/^https:\/\/\S+$/.test(url)) return Alert.alert('Нужна ссылка https://');
            setLinks([...value.links, { id: `custom-${Date.now().toString(36)}`, kind: 'custom', label, url, on: true }]);
          },
        });
      },
    });

  const remove = (l: SiteLink) =>
    chooseAction(`Убрать «${l.label}»?`, undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => setLinks(value.links.filter((x) => x.id !== l.id)) },
    ]);

  return (
    <>
      <Stack.Title>Таплинк</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton onPress={() => setOrdering((on) => !on)}>{ordering ? 'Готово' : 'Порядок'}</ToolbarButton>
      </Stack.Toolbar>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
          <Section footer={<Text>Поставьте эту ссылку в профили Instagram, VK и Telegram — там всё сразу: запись, Tai, контакты.</Text>}>
            <LinkRow icon="link.circle.fill" color="#7C4DFF" title={data.pageUrl.replace(/^https:\/\//, '')} value="Открыть" onPress={() => void Linking.openURL(data.pageUrl)} />
            <ActionRow title="Поделиться ссылкой" icon="square.and.arrow.up" onPress={() => void Share.share({ message: data.pageUrl })} />
          </Section>

          <Section title="Шапка">
            <FieldRow value={value.title} placeholder="Название — по умолчанию название клуба" maxLength={60} onCommit={(title) => commit({ ...value, title })} />
            <FieldRow value={value.bio} placeholder="Пара строк о клубе" maxLength={200} multiline onCommit={(bio) => commit({ ...value, bio })} />
          </Section>

          <Section title="Кнопки" footer={<Text>{ordering ? 'Стрелки меняют порядок кнопок на странице.' : 'Нажмите на кнопку, чтобы поменять подпись. Адреса берутся из контактов сайта.'}</Text>}>
            {value.links.map((l, i) => {
              const look = LINK_LOOK[l.kind];
              const label = l.label || look.title;
              const warn = missing(l);
              if (ordering) {
                return (
                  <HStack key={l.id} spacing={12}>
                    <Text modifiers={[lineLimit(1)]}>{label}</Text>
                    <Spacer />
                    {l.kind === 'custom' ? <Button systemImage="trash" role="destructive" onPress={() => remove(l)} /> : null}
                    <Button systemImage="arrow.up" onPress={() => move(i, -1)} />
                    <Button systemImage="arrow.down" onPress={() => move(i, 1)} />
                  </HStack>
                );
              }
              return (
                <HStack key={l.id} spacing={12}>
                  <Button onPress={() => rename(l)}>
                    <HStack spacing={12}>
                      <Image systemName={look.icon as SFSymbol} size={18} modifiers={[foregroundStyle(l.on ? look.color : '#8E8E93')]} />
                      <VStack alignment="leading" spacing={1}>
                        <Text modifiers={[lineLimit(1)]}>{label}</Text>
                        {warn || l.kind === 'custom' ? <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>{warn ? `Не видна: ${warn}` : l.url}</Text> : null}
                      </VStack>
                    </HStack>
                  </Button>
                  <Spacer />
                  <Toggle label="" isOn={l.on} onIsOnChange={(on) => setLinks(value.links.map((x) => (x.id === l.id ? { ...x, on } : x)))} />
                </HStack>
              );
            })}
            <ActionRow title="Добавить свою ссылку" icon="plus.circle.fill" onPress={addCustom} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
