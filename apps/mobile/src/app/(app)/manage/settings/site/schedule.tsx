import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';

import { ActionRow, LinkRow } from '@/components/native-form';
import { DEFAULT_SCHEDULE, useSiteConfig } from '@/lib/site-api';
import { WEEKDAYS, eveningLook } from '@/lib/site-looks';

/**
 * Расписание игровых вечеров: по нему сайт показывает календарь игр и даёт
 * записаться на вечер. Вечер — строка, нажатие открывает редактор.
 */
export default function SiteScheduleScreen() {
  const router = useRouter();
  const config = useSiteConfig();

  if (!config.data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {config.isError ? <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={config.error.message} /> : <ProgressView />}
      </Host>
    );
  }

  const own = config.data.schedule;
  const rows = own ?? DEFAULT_SCHEDULE;
  return (
    <>
      <Stack.Title>Расписание вечеров</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => { await config.refetch(); })]}>
          <Section
            title="Вечера недели"
            footer={
              <Text>
                {own
                  ? 'По расписанию сайт показывает календарь игр, а гости выбирают вечер в заявке.'
                  : 'Сейчас показано расписание по сменам клуба. Измените или добавьте вечер — и сайт закрепит своё расписание.'}
              </Text>
            }>
            {rows.map((d, i) => {
              const look = eveningLook(d.title);
              return (
                <LinkRow
                  key={`${i}-${d.day}-${d.title}`}
                  icon={look.icon}
                  color={look.color}
                  title={WEEKDAYS[d.day] ?? ''}
                  subtitle={d.title}
                  value={d.time ?? '19:00'}
                  onPress={() => router.push(`/manage/settings/site/evening?index=${i}` as never)}
                />
              );
            })}
          </Section>
          <Section>
            <ActionRow title="Добавить вечер" icon="plus.circle.fill" onPress={() => router.push('/manage/settings/site/evening' as never)} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
