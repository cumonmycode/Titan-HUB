import { ContentUnavailableView, Form, Host, Picker, ProgressView, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, Linking } from 'react-native';

import { ActionRow, LinkRow } from '@/components/native-form';
import { ProfileHeader } from '@/components/profile-parts';
import { promptValue } from '@/components/settings-parts';
import { chooseAction } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { useMe } from '@/lib/queries';
import { useSalarySchemes } from '@/lib/salary-api';
import { useSession } from '@/lib/session';
import { deleteStaffPasskey, PERMISSIONS, permissionOn, removeFromTeam, resetStaffPin, staffTelegramLink, updateStaff, useStaffAdmin, useStaffPasskeys, type StaffRole } from '@/lib/staff-api';
import { colors } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isPin = (value: string) => /^\d{4}$/.test(value);
const DEFAULT_SCHEME = 'default';

/**
 * Карточка сотрудника: роль, права, формула зарплаты и вход. Это тот же клиент клуба —
 * баланс, бонусы и история в его карточке клиента. «Убрать из команды» возвращает его в клиенты.
 */
export default function StaffMemberScreen() {
  const { staffId } = useLocalSearchParams<{ staffId: string }>();
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const me = useMe();
  const staff = useStaffAdmin(isOwner);
  const passkeys = useStaffPasskeys(staffId, isOwner);
  const schemes = useSalarySchemes(isOwner);

  const row = staff.data?.find((item) => item.id === staffId);
  const isSelf = me.data?.id === staffId;

  if (!row) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {staff.isLoading ? <ProgressView /> : <ContentUnavailableView title="Нет в команде" systemImage="person.crop.circle.badge.questionmark" />}
      </Host>
    );
  }

  const patch = (body: Parameters<typeof updateStaff>[1], failure: string) =>
    updateStaff(row.id, body)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        Alert.alert(failure, errorText(error));
      });

  const setRole = (role: StaffRole) => {
    if (role === row.role) return;
    chooseAction(role === 'owner' ? `Сделать ${row.nickname} владельцем?` : `Сделать ${row.nickname} сотрудником?`, role === 'owner' ? 'Владелец видит деньги, аналитику и настройки клуба. Зарплату не получает.' : 'Доступ ограничится правами сотрудника.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сменить роль', onPress: () => void patch({ role }, 'Роль не изменена') },
    ]);
  };

  const togglePermission = (key: string, on: boolean) => {
    const permissions: Record<string, boolean> = {};
    for (const item of PERMISSIONS) permissions[item.key] = item.key === key ? on : permissionOn(row, item.key);
    void patch({ permissions }, 'Права не изменены');
  };

  const changePin = () =>
    promptValue({
      title: 'Новый PIN',
      message: `4 цифры для быстрого входа ${row.nickname} в HUB`,
      value: '',
      keyboard: 'number-pad',
      onSubmit: (pin) => {
        if (!isPin(pin)) return Alert.alert('PIN — ровно 4 цифры');
        resetStaffPin(row.id, pin)
          .then(() => {
            haptic.success();
            Alert.alert('PIN обновлён', `Передайте ${row.nickname} новый PIN.`);
          })
          .catch((error: unknown) => Alert.alert('PIN не изменён', errorText(error)));
      },
    });

  const linkTelegram = () => {
    haptic.light();
    staffTelegramLink(row.id)
      .then(({ deepLink, linked, tgUsername }) =>
        chooseAction(linked ? `Telegram привязан${tgUsername ? `: @${tgUsername}` : ''}` : 'Привязка Telegram', linked ? 'Ссылка ниже перепривяжет аккаунт к другому Telegram.' : `Откройте ссылку на телефоне ${row.nickname} — Tai свяжет аккаунт с HUB.`, [
          { text: 'Закрыть', style: 'cancel' },
          { text: 'Открыть в Telegram', onPress: () => void Linking.openURL(deepLink).catch(() => Alert.alert('Не удалось открыть Telegram')) },
        ]),
      )
      .catch((error: unknown) => Alert.alert('Ссылка не получена', errorText(error)));
  };

  const removePasskey = (passkeyId: string) =>
    chooseAction('Удалить ключ входа?', 'С этого устройства нельзя будет войти по Face ID.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          void deleteStaffPasskey(row.id, passkeyId)
            .then(() => haptic.success())
            .catch((error: unknown) => Alert.alert('Ключ не удалён', errorText(error))),
      },
    ]);

  const remove = () =>
    chooseAction(`Убрать ${row.nickname} из команды?`, 'Он останется клиентом клуба: баланс, бонусы и история сохранятся. Вход в HUB, PIN и права пропадут; смены и выплаты — в отчётах.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Убрать из команды',
        style: 'destructive',
        onPress: () =>
          void removeFromTeam(row.id)
            .then(() => {
              haptic.success();
              router.back();
            })
            .catch((error: unknown) => Alert.alert('Не получилось', errorText(error))),
      },
    ]);

  const schemeId = row.salarySchemeId && (schemes.data ?? []).some((s) => s.id === row.salarySchemeId) ? row.salarySchemeId : DEFAULT_SCHEME;
  const scheme = (schemes.data ?? []).find((s) => (schemeId === DEFAULT_SCHEME ? s.isDefault : s.id === schemeId));

  return (
    <>
      <Stack.Title>{row.nickname}</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([staff.refetch(), passkeys.refetch(), schemes.refetch()])))]}>
          <Section>
            <RNHostView matchContents>
              <ProfileHeader
                name={row.nickname}
                photoUrl={row.photoUrl}
                title={row.nickname}
                subtitle={[row.fullName, row.phone].filter(Boolean).join(' · ') || null}
                chip={row.role === 'owner' ? { text: 'Владелец', color: '#FF9500' } : { text: row.onShift ? 'Сотрудник · на смене' : 'Сотрудник', color: row.onShift ? '#34C759' : '#8E8E93' }}
              />
            </RNHostView>
          </Section>

          <Section footer={<Text>Баланс, бонусы и визиты — в карточке клиента: это один профиль.</Text>}>
            <LinkRow icon="person.crop.circle" color="#007AFF" title="Карточка клиента" onPress={() => router.push({ pathname: '/manage/clients/[clientId]', params: { clientId: row.id } })} />
          </Section>

          <Section title="Роль" footer={<Text>{row.role === 'owner' ? 'Владелец видит всё и может менять настройки клуба.' : 'Сотрудник работает в кассе; разделы «Управления» открываются правами ниже.'}</Text>}>
            <Picker selection={row.role} onSelectionChange={(value) => setRole(value as StaffRole)} modifiers={[pickerStyle('segmented')]}>
              <Text modifiers={[tag('staff')]}>Сотрудник</Text>
              <Text modifiers={[tag('owner')]}>Владелец</Text>
            </Picker>
          </Section>

          {row.role === 'staff' && (
            <>
              <Section title="Зарплата" footer={<Text>{scheme ? scheme.text : 'Формулы настраиваются в «Управление → Зарплата».'}</Text>}>
                <Picker
                  label="Формула"
                  selection={schemeId}
                  onSelectionChange={(value) => void patch({ salarySchemeId: value === DEFAULT_SCHEME ? null : String(value) }, 'Формула не изменена')}
                  modifiers={[pickerStyle('menu')]}>
                  <Text modifiers={[tag(DEFAULT_SCHEME)]}>Основная клуба</Text>
                  {(schemes.data ?? [])
                    .filter((s) => !s.isDefault)
                    .map((s) => (
                      <Text key={s.id} modifiers={[tag(s.id)]}>
                        {s.name}
                      </Text>
                    ))}
                </Picker>
              </Section>

              <Section title="Права" footer={<Text>Выключенное право убирает раздел из «Управления» у этого сотрудника.</Text>}>
                {PERMISSIONS.map((item) => (
                  <Toggle key={item.key} label={item.label} isOn={permissionOn(row, item.key)} onIsOnChange={(on) => togglePermission(item.key, on)} />
                ))}
              </Section>
            </>
          )}

          <Section title="Вход в HUB" footer={<Text>Первый вход — через Telegram (Tai), дальше — PIN или Face ID.</Text>}>
            <LinkRow icon="paperplane.fill" color="#32ADE6" title="Telegram" value={row.tgUsername ? `@${row.tgUsername}` : row.tgId ? 'привязан' : 'не привязан'} valueColor={row.tgId ? undefined : colors.orange} onPress={linkTelegram} />
            <LinkRow icon="number.circle.fill" color="#AF52DE" title={row.hasPin ? 'Сбросить PIN' : 'Задать PIN'} value={row.hasPin ? 'задан' : 'нет'} chevron={false} onPress={changePin} />
          </Section>

          {(passkeys.data ?? []).length > 0 && (
            <Section title="Ключи Face ID" footer={<Text>Удаление ключа не трогает PIN.</Text>}>
              {(passkeys.data ?? []).map((key) => (
                <LinkRow
                  key={key.id}
                  icon="faceid"
                  color="#34C759"
                  title={key.deviceType === 'multiDevice' ? 'Ключ в iCloud Keychain' : 'Ключ на устройстве'}
                  subtitle={new Date(key.createdAt).toLocaleDateString('ru-RU')}
                  value="Удалить"
                  valueColor={colors.red}
                  chevron={false}
                  onPress={() => removePasskey(key.id)}
                />
              ))}
            </Section>
          )}

          <Section footer={isSelf ? <Text>Это ваш профиль — себя из команды не убрать.</Text> : undefined}>
            {!isSelf && <ActionRow title="Убрать из команды" icon="person.badge.minus" destructive onPress={remove} />}
          </Section>
        </Form>
      </Host>
    </>
  );
}
