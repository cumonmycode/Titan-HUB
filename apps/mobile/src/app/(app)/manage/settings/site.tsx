import { Button, ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert } from 'react-native';

import { primary, secondary } from '@/components/native-form';
import { saveSiteTheme, useSiteConfig, type SiteTheme } from '@/lib/admin-api';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Зеркало сайта на поддомене HUB: превью тем работает и до переключения домена. */
const SITE_MIRROR = 'https://site.titanpos.ru';
const DAYS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const THEMES: { id: SiteTheme; title: string; hint: string }[] = [
  { id: 'case', title: 'Дело о мафии', hint: 'Доска улик на фиолетовой стене штаба' },
  { id: 'protocol', title: 'Протокол судьи', hint: 'Бланк игры: место №10 — для гостя' },
  { id: 'night', title: 'Город засыпает', hint: 'При прокрутке ночь сменяется днём' },
  { id: 'classic', title: 'Классика', hint: 'Фото клуба во весь экран' },
];

/**
 * Сайт клуба titanmafia.ru: какая из четырёх тем включена (сайт обновляется в течение
 * минуты) и превью каждой. Расписание вечеров и публикации турниров — в веб-HUB
 * («Управление → Сайт»): там загрузка фото и длинные тексты.
 */
export default function SiteSettingsScreen() {
  const config = useSiteConfig();
  const host = useSession((s) => s.club?.host ?? '');
  const [theme, setTheme] = useState<SiteTheme | null>(null);
  const current = theme ?? config.data?.theme ?? 'case';

  const choose = (next: SiteTheme) => {
    setTheme(next);
    saveSiteTheme(next)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setTheme(null);
        Alert.alert('Тема не включилась', errorText(error));
      });
  };
  const open = (url: string) => {
    haptic.light();
    void WebBrowser.openBrowserAsync(url);
  };

  if (!config.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={config.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const schedule = config.data.schedule;
  return (
    <>
      <Stack.Title>Сайт</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Тема сайта" footer={<Text>Сайт переключится в течение минуты. Заявки с сайта приходят в «Мероприятия».</Text>}>
            <Picker selection={current} onSelectionChange={(next) => choose(next as SiteTheme)} modifiers={[pickerStyle('inline')]}>
              {THEMES.map((t) => (
                <VStack key={t.id} alignment="leading" spacing={2} modifiers={[tag(t.id)]}>
                  <Text modifiers={[primary]}>{t.title}</Text>
                  <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>{t.hint}</Text>
                </VStack>
              ))}
            </Picker>
          </Section>

          <Section title="Посмотреть тему" footer={<Text>Откроется главная сайта в выбранной теме — сайт при этом не меняется.</Text>}>
            {THEMES.map((t) => <Button key={t.id} label={t.title} systemImage="eye" onPress={() => open(`${SITE_MIRROR}/preview/${t.id}`)} />)}
          </Section>

          <Section title="Расписание вечеров" footer={<Text>Меняется в веб-HUB: «Управление → Сайт → Оформление».</Text>}>
            {(schedule ?? []).length > 0
              ? schedule!.map((d) => <Text key={`${d.day}-${d.title}`}>{`${DAYS[d.day] ?? ''} · ${d.title}${d.time ? ` · ${d.time}` : ''}`}</Text>)
              : <Text modifiers={[secondary]}>По сменам клуба: вт и пт — городская, чт и сб — спортивная, вс — настольные</Text>}
          </Section>

          <Section>
            <Button label="Публикации и расписание в веб-HUB" systemImage="photo.on.rectangle" onPress={() => open(`https://${host}/manage/site?tab=stories`)} />
            <Button label="Открыть сайт" systemImage="safari" onPress={() => open(`${SITE_MIRROR}/`)} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
