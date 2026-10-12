import { Button, ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { TextRow, TimeRow, primary, secondary } from '@/components/native-form';
import { SITE_HOLIDAYS, saveSiteHoliday, saveSiteSchedule, useSiteConfig, type SiteHoliday, type SiteScheduleDay } from '@/lib/admin-api';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Зеркало сайта на поддомене HUB: превью праздников работает и до переключения домена. */
const SITE_MIRROR = 'https://site.titanpos.ru';
const DAYS = ['', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
/** Расписание по сменам клуба — сайт показывает его, пока своё не сохранено. */
const DEFAULT_SCHEDULE: SiteScheduleDay[] = [
  { day: 2, title: 'Городская мафия', time: '19:00' },
  { day: 4, title: 'Спортивная мафия', time: '19:00' },
  { day: 5, title: 'Городская мафия', time: '19:00' },
  { day: 6, title: 'Спортивная мафия', time: '19:00' },
  { day: 7, title: 'Настольные игры', time: '19:00' },
];

// Тег «без праздника» в Picker (SwiftUI-теги не бывают null).
const PLAIN = 'none';
const HOLIDAY_OPTIONS: { id: SiteHoliday | typeof PLAIN; title: string; hint: string }[] = [
  { id: PLAIN, title: 'Без праздника', hint: 'Обычный вид Liquid Glass' },
  ...SITE_HOLIDAYS,
];

/**
 * Сайт клуба titanmafia.ru: праздничное оформление (снег, сердца, тыквы… поверх
 * обычного вида) и расписание игровых вечеров (по нему сайт показывает ближайшие
 * игры и даёт записаться) — всё сохраняется сразу, сайт обновляется в течение
 * минуты. Публикации турниров — в веб-HUB: там загрузка фото.
 */
export default function SiteSettingsScreen() {
  const config = useSiteConfig();
  const host = useSession((s) => s.club?.host ?? '');
  // undefined — показываем серверное значение; иначе — выбранное до ответа сервера.
  const [picked, setPicked] = useState<SiteHoliday | typeof PLAIN | undefined>(undefined);
  const current = picked ?? config.data?.holiday ?? PLAIN;
  const [schedule, setSchedule] = useState<SiteScheduleDay[] | null>(null);
  useEffect(() => {
    if (config.data) setSchedule(config.data.schedule ?? DEFAULT_SCHEDULE);
  }, [config.data]);

  // Каждое изменение расписания сохраняется сразу; при ошибке — откат к серверному.
  const commitSchedule = (next: SiteScheduleDay[]) => {
    const sorted = [...next].sort((a, b) => a.day - b.day);
    setSchedule(sorted);
    saveSiteSchedule(sorted)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setSchedule(config.data?.schedule ?? DEFAULT_SCHEDULE);
        Alert.alert('Расписание не сохранилось', errorText(error));
      });
  };
  const rows = schedule ?? [];
  const update = (i: number, patch: Partial<SiteScheduleDay>) => commitSchedule(rows.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const remove = (i: number) => commitSchedule(rows.filter((_, j) => j !== i));
  const add = () => commitSchedule([...rows, { day: 1, title: 'Городская мафия', time: '19:00' }]);

  const choose = (next: SiteHoliday | typeof PLAIN) => {
    setPicked(next);
    saveSiteHoliday(next === PLAIN ? null : next)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        setPicked(undefined);
        Alert.alert('Оформление не сменилось', errorText(error));
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

  return (
    <>
      <Stack.Title>Сайт</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section title="Праздник на сайте" footer={<Text>Каркас и стекло остаются — сверху добавляются частицы, декорации и поздравление. Сайт обновится в течение минуты.</Text>}>
            <Picker selection={current} onSelectionChange={(next) => choose(next as SiteHoliday | typeof PLAIN)} modifiers={[pickerStyle('inline')]}>
              {HOLIDAY_OPTIONS.map((t) => (
                <VStack key={t.id} alignment="leading" spacing={2} modifiers={[tag(t.id)]}>
                  <Text modifiers={[primary]}>{t.title}</Text>
                  <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>{t.hint}</Text>
                </VStack>
              ))}
            </Picker>
          </Section>

          <Section footer={<Text>Превью открывает главную с выбранным праздником — сайт при этом не меняется.</Text>}>
            <Button label="Посмотреть выбранное" systemImage="eye" onPress={() => open(`${SITE_MIRROR}/preview/${current}`)} />
          </Section>

          {rows.map((d, i) => (
            <Section
              key={`${i}-${d.day}`}
              title={i === 0 ? 'Расписание вечеров' : undefined}
              footer={i === rows.length - 1 ? <Text>По расписанию сайт показывает ближайшие игры, а гости выбирают вечер в заявке.</Text> : undefined}>
              <Picker
                label="День"
                selection={d.day}
                onSelectionChange={(day) => {
                  haptic.selection();
                  update(i, { day: Number(day) });
                }}
                modifiers={[pickerStyle('menu')]}>
                {DAYS.slice(1).map((name, k) => (
                  <Text key={name} modifiers={[tag(k + 1)]}>
                    {name}
                  </Text>
                ))}
              </Picker>
              <TextRow label="Вечер" value={d.title} placeholder="Городская мафия" maxLength={60} onCommit={(title) => title.trim() && update(i, { title: title.trim() })} />
              <TimeRow label="Начало" value={d.time ?? '19:00'} fallback="19:00" onChange={(time) => update(i, { time })} />
              <Button role="destructive" label="Убрать вечер" systemImage="minus.circle" onPress={() => remove(i)} />
            </Section>
          ))}
          <Section title={rows.length ? undefined : 'Расписание вечеров'}>
            <Button label="Добавить вечер" systemImage="plus.circle" onPress={add} />
          </Section>

          <Section>
            <Button label="Публикации турниров — в веб-HUB" systemImage="photo.on.rectangle" onPress={() => open(`https://${host}/manage/site?tab=stories`)} />
            <Button label="Открыть сайт" systemImage="safari" onPress={() => open(`${SITE_MIRROR}/`)} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
