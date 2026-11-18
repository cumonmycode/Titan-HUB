import { ContentUnavailableView, Form, Host, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { LinkRow, TextRow } from '@/components/native-form';
import { useSettingsEditor } from '@/components/settings-parts';

/**
 * Рост статуса: Новичок сам становится Резидентом после N посещений (посещение — бизнес-день
 * с закрытым чеком плюс ручные посещения из карточки клиента). 0 — повышать только вручную.
 */
export default function StatusScreen() {
  const router = useRouter();
  const settings = useSettingsEditor();

  if (settings.loading || settings.error) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {settings.error ? <ContentUnavailableView title="Настройки не загрузились" systemImage="wifi.exclamationmark" description={settings.error.message} /> : <ProgressView />}
      </Host>
    );
  }
  const threshold = settings.number('resident_visit_threshold', 10);

  return (
    <>
      <Stack.Title>Рост статуса</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await settings.refetch()))]}>
          <Section
            title="Новичок → Резидент"
            footer={
              <Text>
                {threshold > 0
                  ? `После ${threshold}-го посещения гость сам становится Резидентом и получает уведомление. Прогресс виден ему в My Titan.`
                  : 'Автоповышение выключено — статус меняется только вручную в карточке клиента.'}
              </Text>
            }>
            <TextRow
              label="Посещений до Резидента"
              value={String(threshold)}
              keyboard="numeric"
              onCommit={(v) => {
                const n = Number(v.replace(/\s/g, ''));
                if (!Number.isInteger(n) || n < 0 || n > 1000) return Alert.alert('Введите целое число от 0 до 1000');
                settings.save({ resident_visit_threshold: String(n) });
              }}
            />
          </Section>
          <Section footer={<Text>Названия, цвета и тарифы статусов — в «Тарифах и аренде». Свой процент бонусов для статуса — в «Бонусной программе».</Text>}>
            <LinkRow icon="tag" color="#30B0C7" title="Статусы и тарифы" onPress={() => router.push('/manage/pricing')} />
            <LinkRow icon="star.circle.fill" color="#FF9500" title="Бонусы по статусам" onPress={() => router.push('/manage/loyalty/bonus')} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
