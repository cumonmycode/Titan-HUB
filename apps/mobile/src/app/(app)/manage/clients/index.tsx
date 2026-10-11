import { ContentUnavailableView, Form, Host, Picker, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { ClientLine } from '@/components/client-line';
import { ActionRow, SearchRow } from '@/components/native-form';
import { useDebounced } from '@/components/player-picker';
import { RegistrationLine } from '@/components/registration-line';
import { ToolbarButton, ToolbarMenu, ToolbarMenuAction } from '@/components/toolbar';
import {
  decideRegistration, useClientList, useClientTiers, useRegistrations, whenText,
  type Client, type ClientSection, type ClientSort, type Registration,
} from '@/lib/clients-api';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/haptics';

const SECTIONS: { key: ClientSection; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'resident', label: 'Резиденты' },
  { key: 'student', label: 'Студенты' },
  { key: 'newbie', label: 'Новички' },
  { key: 'guest', label: 'Гости' },
  { key: 'archived', label: 'Архив' },
];

const SORTS: { key: ClientSort; label: string; icon: SFSymbol }[] = [
  { key: 'last_check', label: 'Активные', icon: 'clock.arrow.circlepath' },
  { key: 'recent', label: 'Новые', icon: 'sparkles' },
  { key: 'name', label: 'По алфавиту', icon: 'textformat.abc' },
  { key: 'balance', label: 'По балансу', icon: 'rublesign.circle' },
  { key: 'bonus', label: 'По бонусам', icon: 'star' },
];

/**
 * Клиенты клуба: поиск строкой (ник, имя, телефон, теги), раздел по статусу и архив —
 * системным меню, сортировка — в шапке. Список догружается страницами по 30.
 */
export default function ClientsScreen() {
  const router = useRouter();
  const tiers = useClientTiers();
  const [section, setSection] = useState<ClientSection>('all');
  const [sort, setSort] = useState<ClientSort>('last_check');
  const [query, setQuery] = useState('');
  const search = useDebounced(query, 300);
  const list = useClientList(section, sort, search);
  const registrations = useRegistrations();
  const [deciding, setDeciding] = useState<string | null>(null);

  const clients = useMemo(() => {
    const seen = new Set<string>();
    return (list.data?.pages ?? []).flatMap((page) => page.clients).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;

  const open = (client: Client) => router.push({ pathname: '/manage/clients/[clientId]', params: { clientId: client.id } });
  const openById = (clientId: string) => router.push({ pathname: '/manage/clients/[clientId]', params: { clientId } });

  // Регистрации из My Titan: до подтверждения клиенту не начисляются бонусы и закрыта оплата в приложении.
  const decide = async (registration: Registration, action: 'approve' | 'reject') => {
    setDeciding(registration.id);
    try {
      await decideRegistration(registration.id, action);
      haptic.success();
    } catch (error) {
      haptic.error();
      Alert.alert('Решение не сохранилось', error instanceof Error ? error.message : String(error));
    } finally {
      setDeciding(null);
    }
  };
  const reject = (registration: Registration) =>
    Alert.alert('Отклонить регистрацию?', `${registration.nickname} уйдёт в архив, приложение клиента выйдет на экран входа.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отклонить', style: 'destructive', onPress: () => void decide(registration, 'reject') },
    ]);
  const more = () => {
    if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
  };

  const title = list.data
    ? `${total} ${plural(total, ['клиент', 'клиента', 'клиентов'])}${search.trim() ? ' по запросу' : section === 'archived' ? ' в архиве' : ''} · ${SORTS.find((s) => s.key === sort)?.label.toLowerCase()}`
    : undefined;

  return (
    <>
      <Stack.Title>Клиенты</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarMenu icon="arrow.up.arrow.down" accessibilityLabel="Сортировка">
          {SORTS.map((s) => (
            <ToolbarMenuAction
              key={s.key}
              icon={s.icon}
              isOn={sort === s.key}
              onPress={() => {
                haptic.selection();
                setSort(s.key);
              }}>
              {s.label}
            </ToolbarMenuAction>
          ))}
        </ToolbarMenu>
        <ToolbarButton icon="person.badge.plus" accessibilityLabel="Новый клиент" onPress={() => router.push('/manage/clients/edit')} />
      </Stack.Toolbar>

      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.all([list.refetch(), registrations.refetch()])))]}>
          {section !== 'archived' &&
            (registrations.data ?? []).map((registration) => (
              <Section
                key={registration.id}
                title={`Новая регистрация · ${whenText(registration.createdAt)}`}
                footer={<Text>До подтверждения клиенту не начисляются бонусы и закрыта оплата в приложении.</Text>}>
                <RegistrationLine registration={registration} onPress={() => openById(registration.id)} />
                <ActionRow title="Подтвердить" icon="checkmark.circle" disabled={deciding === registration.id} onPress={() => void decide(registration, 'approve')} />
                <ActionRow
                  title="Изменить"
                  icon="pencil"
                  disabled={deciding === registration.id}
                  onPress={() => router.push({ pathname: '/manage/clients/edit', params: { clientId: registration.id } })}
                />
                <ActionRow title="Отклонить" icon="xmark.circle" destructive disabled={deciding === registration.id} onPress={() => reject(registration)} />
              </Section>
            ))}
          <Section>
            <SearchRow placeholder="Ник, имя, телефон или тег" onChange={setQuery} />
            <Picker
              label="Раздел"
              selection={section}
              onSelectionChange={(value) => {
                haptic.selection();
                setSection(value as ClientSection);
              }}
              modifiers={[pickerStyle('menu')]}>
              {SECTIONS.map((s) => (
                <Text key={s.key} modifiers={[tag(s.key)]}>
                  {s.label}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section title={title} footer={clients.length > 0 && !list.hasNextPage ? <Text>{`Все клиенты загружены · ${clients.length}`}</Text> : undefined}>
            {list.isLoading ? (
              <ProgressView />
            ) : clients.length === 0 ? (
              list.isError ? (
                <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={list.error.message} />
              ) : section === 'archived' ? (
                <ContentUnavailableView title="Архив пуст" systemImage="archivebox" description="Сюда попадают клиенты, отправленные в архив." />
              ) : (
                <ContentUnavailableView title="Клиенты не найдены" systemImage="person.2.slash" description="Измените запрос или раздел." />
              )
            ) : (
              clients.map((client) => <ClientLine key={client.id} client={client} tiers={tiers.data} onPress={() => open(client)} />)
            )}
            {list.hasNextPage && <ActionRow title={list.isFetchingNextPage ? 'Загружаем…' : `Показать ещё · загружено ${clients.length} из ${total}`} icon="arrow.down.circle" disabled={list.isFetchingNextPage} onPress={more} />}
          </Section>
        </Form>
      </Host>
    </>
  );
}
