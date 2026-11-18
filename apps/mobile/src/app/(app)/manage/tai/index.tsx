import { ContentUnavailableView, Form, Host, ProgressView, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { LinkRow } from '@/components/native-form';
import { TaiMark } from '@/components/tai/mark';
import { Text as RNText } from '@/components/text';
import { useTaiChatsEditor, useTaiSettingsEditor } from '@/lib/tai-settings';
import { colors, space, type } from '@/lib/theme';

/**
 * «Tai» — настройки ассистента клуба короткими разделами: голос (свой экран с
 * примерами), манера с сотрудниками, клиенты в Telegram и групповые чаты — в разделе
 * «Telegram». Всё сохраняется сразу; меняет владелец.
 */
export default function TaiSettingsScreen() {
  const router = useRouter();
  const editor = useTaiSettingsEditor();
  const chats = useTaiChatsEditor();
  const data = editor.query.data;
  const config = chats.query.data;

  if (!data) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {editor.query.error ? (
          <ContentUnavailableView title="Настройки не загрузились" systemImage="wifi.exclamationmark" description={editor.query.error instanceof Error ? editor.query.error.message : undefined} />
        ) : (
          <ProgressView />
        )}
      </Host>
    );
  }

  const { settings } = data;
  const voice = data.voices.find((v) => v.id === settings.voice);
  const speed = data.speeds.find((s) => s.value === settings.speed);
  const brief = data.clubBrief.replace(/\s+/g, ' ').trim();

  return (
    <>
      <Stack.Title>Tai</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([editor.query.refetch(), chats.query.refetch()])))]}>
          <Section>
            <RNHostView matchContents>
              <Hero botReady={config?.botReady} aiReady={config?.aiReady} />
            </RNHostView>
          </Section>

          <Section title="Голос" footer={<Text>Каким голосом Tai отвечает на голосовые — в приложении и в Telegram.</Text>}>
            <LinkRow
              icon="waveform"
              color="#8B5CF6"
              title="Голос и скорость"
              value={[voice?.label, speed?.label].filter(Boolean).join(' · ')}
              onPress={() => router.push('/manage/tai/voice')}
            />
          </Section>

          <Section title="С сотрудниками" footer={<Text>В приложении, в личке и в рабочем чате. С клиентами Tai всегда на «ты» и без мата.</Text>}>
            <Toggle label="Можно материться" isOn={settings.profanity} onIsOnChange={(on) => editor.save({ profanity: on })} />
          </Section>

          <Section
            title="Клиенты в Telegram"
            footer={<Text>Tai напоминает об игре тем, кто ещё не отметился или просил напомнить: не чаще раза в 3 дня, днём, и никогда тем, кто попросил не писать.</Text>}
          >
            <Toggle label="Пишет клиентам первым" isOn={settings.outreach} onIsOnChange={(on) => editor.save({ outreach: on })} />
            <LinkRow icon="text.book.closed" color="#FF9500" title="Что Tai рассказывает о клубе" subtitle={brief || 'Форматы игр, школа, мероприятия'} onPress={() => router.push('/manage/tai/brief')} />
          </Section>

          <Section footer={<Text>Режим, стиль и мат Tai настраиваются у каждой группы отдельно.</Text>}>
            <LinkRow icon="bubble.left.and.bubble.right.fill" color="#2AABEE" title="Групповые чаты" subtitle="Раздел «Telegram»" onPress={() => router.push('/manage/telegram')} />
          </Section>
        </Form>
      </Host>
    </>
  );
}

/** Заголовок раздела: кто такой Tai и работает ли он сейчас. */
function Hero({ botReady, aiReady }: { botReady?: boolean; aiReady?: boolean }) {
  return (
    <View style={styles.hero}>
      <TaiMark size={56} breathe />
      <View style={styles.flex}>
        <RNText style={[type.title3, styles.label]}>Tai</RNText>
        <RNText style={[type.footnote, styles.secondary]}>Администратор клуба в Telegram и помощник в кассе</RNText>
        <View style={styles.statuses}>
          <Status ok={botReady} label="Бот в Telegram" />
          <Status ok={aiReady} label="ИИ" />
        </View>
      </View>
    </View>
  );
}

function Status({ ok, label }: { ok?: boolean; label: string }) {
  const color = ok === undefined ? colors.tertiaryLabel : ok ? colors.green : colors.orange;
  return (
    <View style={styles.status}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <RNText style={[type.caption1, styles.secondary]}>{ok === false ? `${label}: не подключён` : label}</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  label: { color: colors.label },
  secondary: { color: colors.secondaryLabel },
  statuses: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.xs },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
