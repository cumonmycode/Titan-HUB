import { ContentUnavailableView, Form, Host, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useTelegramChat, type GameKind } from '@/lib/telegram-api';

const GAMES: { key: GameKind; title: string }[] = [
  { key: 'sport', title: 'Игрокам спортивной мафии' },
  { key: 'city', title: 'Игрокам городской мафии' },
];

/**
 * Кто может попасть в чат: Tai даёт ссылку в личке только тем, кому можно, а с проверкой
 * заявок сам пускает или отклоняет вступающих. Отдельным людям доступ открывается в их карточке.
 */
export default function ChatAccessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const editor = useTelegramChat(id);
  const detail = editor.query.data;

  if (!detail) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {editor.query.isError ? <ContentUnavailableView title="Чат не найден" systemImage="bubble.left.and.exclamationmark.bubble.right" /> : <ProgressView />}
      </Host>
    );
  }

  const { access } = detail.config;
  const canInvite = detail.live?.reachable ? detail.live.rights.inviteUsers : true;
  const toggleGame = (key: GameKind, on: boolean) =>
    editor.save({ access: { games: on ? [...new Set([...access.games, key])] : access.games.filter((g) => g !== key) } });
  const manual = access.allow.length;

  return (
    <>
      <Stack.Title>Кто может войти</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form>
          <Section
            footer={
              <Text>
                {canInvite
                  ? 'Человек пишет Tai в личку «скинь ссылку на чат» — и получает ссылки только на те чаты, куда ему можно.'
                  : 'Чтобы давать ссылки, боту нужно право администратора «Пригласительные ссылки».'}
              </Text>
            }>
            <Toggle label="Tai даёт ссылку в личке" isOn={access.invite} onIsOnChange={(invite) => editor.save({ access: { invite } })} />
          </Section>

          <Section title="Кому можно" footer={<Text>{`Анкета, которую ещё не подтвердили в HUB, проходит только по ручному доступу. Вручную открыто: ${manual} чел. — в карточке клиента → «Чаты Telegram».`}</Text>}>
            <Toggle label="Всем, кто попросит" isOn={access.everyone} onIsOnChange={(everyone) => editor.save({ access: { everyone } })} />
            {!access.everyone ? (
              <>
                {GAMES.map((game) => (
                  <Toggle key={game.key} label={game.title} isOn={access.games.includes(game.key)} onIsOnChange={(on) => toggleGame(game.key, on)} />
                ))}
                <Toggle label="Сотрудникам клуба" isOn={access.staff} onIsOnChange={(staff) => editor.save({ access: { staff } })} />
              </>
            ) : null}
          </Section>

          <Section
            title="Проверка заявок"
            footer={<Text>Ссылка от Tai — с заявкой на вступление: Tai сам пропускает тех, кому можно, и отклоняет остальных, даже если ссылку переслали. Без проверки ссылка личная — на одного человека и на сутки.</Text>}>
            <Toggle label="Пускать только по правилам" isOn={access.guard} onIsOnChange={(guard) => editor.save({ access: { guard } })} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
