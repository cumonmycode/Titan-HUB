import { Button, DatePicker, Form, HStack, Host, ProgressView, RNHostView, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, View } from 'react-native';

import { ActionRow, LinkRow, primary, secondary, TextRow } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { promptValue } from '@/components/settings-parts';
import { PERMISSIONS, permissionOn, setMyPin, updateMe } from '@/lib/admin-api';
import { clearClubCalendar, ensureCalendarAccess, syncEventsToCalendar } from '@/lib/calendar-sync';
import { markCalendarSynced, useDevicePrefs } from '@/lib/device-prefs';
import { useEvents } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { pickAndUploadPhoto } from '@/lib/photo';
import { signOutEverywhere, useMe } from '@/lib/queries';
import { useSession } from '@/lib/session';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** «ГГГГ-ММ-ДД» ↔ дата в полдень: без сдвига дня из-за часового пояса. */
const toDate = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`);
const toIsoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Мой профиль — нативная форма: фото, данные о себе правятся прямо в строках, PIN,
 * уведомления и календарь. Права показываем как есть — их выдаёт владелец.
 */
export default function MyProfileScreen() {
  const router = useRouter();
  const me = useMe();
  const club = useSession((s) => s.club);
  const [photoBusy, setPhotoBusy] = useState(false);
  const calendarSync = useDevicePrefs((state) => state.calendarSync);
  const setCalendarSync = useDevicePrefs((state) => state.setCalendarSync);
  const events = useEvents();

  const profile = me.data;
  if (!profile) {
    return (
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <ProgressView />
      </Host>
    );
  }
  const isOwner = profile.role === 'owner';

  const patch = (body: Parameters<typeof updateMe>[0], failure: string) =>
    updateMe(body)
      .then(() => haptic.success())
      .catch((error: unknown) => {
        haptic.error();
        Alert.alert(failure, errorText(error));
      });

  const changePhoto = () => pickAndUploadPhoto('Моё фото', (photoUrl) => void patch({ photoUrl }, 'Фото не сохранилось'), setPhotoBusy);

  /** Мероприятия клуба в календаре телефона: разрешение спрашиваем при включении. */
  const toggleCalendar = (on: boolean) => {
    if (!on) {
      Alert.alert('Убрать мероприятия из календаря?', 'Календарь «Titan HUB» и записи в нём удалятся с этого устройства.', [
        { text: 'Оставить записи', onPress: () => void setCalendarSync(false) },
        {
          text: 'Убрать',
          style: 'destructive',
          onPress: () => {
            void setCalendarSync(false);
            void clearClubCalendar();
          },
        },
      ]);
      return;
    }
    void (async () => {
      if (!(await ensureCalendarAccess())) {
        Alert.alert('Нужен доступ к календарю', 'Разрешите доступ в настройках телефона — тогда мероприятия будут появляться в календаре с напоминаниями.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Открыть настройки', onPress: () => void Linking.openSettings() },
        ]);
        return;
      }
      await setCalendarSync(true);
      // Полная синхронизация удаляет записи мероприятий, которых нет в списке, — с пустым
      // списком до загрузки она стёрла бы весь календарь. Не загружены — догружаем; не
      // вышло — синхронизирует экран «Мероприятия», когда список придёт.
      const rows = events.data ?? (await events.refetch().catch(() => null))?.data;
      const result = rows ? await syncEventsToCalendar(rows).catch(() => null) : null;
      if (rows) markCalendarSynced();
      haptic.success();
      Alert.alert(
        'Календарь подключён',
        result && result.added > 0
          ? `Добавлено мероприятий: ${result.added}. Напоминания придут за час и за 30 минут до начала.`
          : 'Новые мероприятия будут появляться в календаре с напоминаниями за час и за 30 минут.',
      );
    })();
  };

  const changePin = () =>
    promptValue({
      title: 'Новый PIN',
      message: '4 цифры для быстрого входа в кассу на этом устройстве',
      value: '',
      keyboard: 'number-pad',
      onSubmit: (pin) => {
        if (!/^\d{4}$/.test(pin)) return Alert.alert('PIN — ровно 4 цифры');
        setMyPin(pin)
          .then(() => {
            haptic.success();
            Alert.alert('PIN обновлён');
          })
          .catch((error: unknown) => Alert.alert('PIN не изменён', errorText(error)));
      },
    });

  const logout = () =>
    Alert.alert('Выйти из кассы?', 'Для входа понадобится PIN или пароль.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: () => void signOutEverywhere() },
    ]);

  const permissionList = PERMISSIONS.filter((item) => permissionOn(profile, item.key))
    .map((item) => item.label)
    .join(', ');

  return (
    <>
      <Stack.Title>Мой профиль</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await me.refetch()))]}>
          <Section footer={<Text>Нажмите на фото, чтобы сменить.</Text>}>
            <Button onPress={changePhoto}>
              <HStack spacing={14}>
                <RNHostView matchContents>
                  <View>
                    <Avatar name={profile.nickname} photoUrl={profile.photoUrl} size={64} />
                    {photoBusy && <ActivityIndicator style={{ position: 'absolute', top: 22, left: 22 }} />}
                  </View>
                </RNHostView>
                <VStack alignment="leading" spacing={2}>
                  <Text modifiers={[font({ textStyle: 'title2', weight: 'semibold' }), primary, lineLimit(1)]}>{profile.nickname}</Text>
                  <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(1)]}>{`${isOwner ? 'Владелец' : 'Сотрудник'} · ${club?.name ?? ''}`}</Text>
                </VStack>
                <Spacer />
              </HStack>
            </Button>
          </Section>

          <Section title="О себе" footer={<Text>Никнейм видят коллеги и гости в чеках.</Text>}>
            <TextRow
              label="Никнейм"
              value={profile.nickname}
              maxLength={40}
              capitalize="never"
              onCommit={(nickname) => (nickname.length < 2 ? Alert.alert('Слишком короткий никнейм') : void patch({ nickname }, 'Никнейм не изменён'))}
            />
            <TextRow label="Имя и фамилия" value={profile.fullName ?? ''} placeholder="Не указаны" capitalize="words" onCommit={(fullName) => void patch({ fullName: fullName || null }, 'Имя не изменено')} />
            <TextRow label="Телефон" value={profile.phone ?? ''} placeholder="Не указан" keyboard="phone-pad" onCommit={(phone) => void patch({ phone: phone || null }, 'Телефон не изменён')} />
            {profile.birthday ? (
              <DatePicker
                title="День рождения"
                selection={toDate(profile.birthday)}
                displayedComponents={['date']}
                range={{ end: new Date() }}
                onDateChange={(date) => void patch({ birthday: toIsoDay(date) }, 'Дата не изменена')}
              />
            ) : (
              <ActionRow title="Указать день рождения" icon="gift" onPress={() => void patch({ birthday: '2000-01-01' }, 'Дата не изменена')} />
            )}
          </Section>

          <Section title="Вход и уведомления">
            <LinkRow icon="number.circle" color="#FF9500" title="Изменить PIN" chevron={false} onPress={changePin} />
            <LinkRow icon="bell.badge" color="#FF3B30" title="Уведомления" onPress={() => router.push('/manage/staff/notifications')} />
            <Toggle label="Мероприятия в календаре" isOn={calendarSync} onIsOnChange={toggleCalendar} />
          </Section>

          {!isOwner && (
            <Section title="Права" footer={<Text>Права выдаёт владелец клуба.</Text>}>
              <Text modifiers={[secondary]}>{permissionList || 'Не настроены'}</Text>
            </Section>
          )}

          <Section>
            <ActionRow title="Выйти из кассы" icon="rectangle.portrait.and.arrow.right" destructive onPress={logout} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
