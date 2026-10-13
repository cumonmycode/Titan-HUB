import { Button, ContentUnavailableView, Form, HStack, Host, Image, Picker, ProgressView, RNHostView, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Redirect, Stack, useRouter } from 'expo-router';

import { primary, secondary, tertiary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { useSettingsEditor } from '@/components/settings-parts';
import { ToolbarButton } from '@/components/toolbar';
import { haptic } from '@/lib/haptics';
import { useMe } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { STAFF_COMP_KEYS, useStaffAdmin, type StaffRow } from '@/lib/staff-api';

const ON_SHIFT = '#34C759';
const OWNER = '#FF9500';

/**
 * Команда клуба. Сотрудник — это клиент клуба с правами: «+» открывает список клиентов,
 * выбранному выдаются роль и права. Здесь же — касса для команды (списание на персонал).
 * Сотрудник видит только свой профиль.
 */
export default function StaffScreen() {
  const router = useRouter();
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const me = useMe();
  const staff = useStaffAdmin(isOwner);
  const settings = useSettingsEditor();

  if (!isOwner) return <Redirect href="/manage/staff/me" />;

  const rows = staff.data ?? [];
  const open = (row: StaffRow) => router.push({ pathname: '/manage/staff/[staffId]', params: { staffId: row.id } });
  const compOn = settings.flag(STAFF_COMP_KEYS.enabled, false);

  return (
    <>
      <Stack.Title>Сотрудники</Stack.Title>
      <Stack.Toolbar placement="right">
        <ToolbarButton
          icon="plus"
          accessibilityLabel="Добавить в команду"
          onPress={() => {
            haptic.light();
            router.push('/manage/staff/add');
          }}
        />
      </Stack.Toolbar>

      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(async () => void (await Promise.allSettled([staff.refetch(), me.refetch(), settings.refetch()])))]}>
          <Section>
            <Button
              onPress={() => {
                haptic.selection();
                router.push('/manage/staff/me');
              }}>
              <HStack spacing={14}>
                <RNHostView matchContents>
                  <Avatar name={me.data?.nickname ?? '··'} photoUrl={me.data?.photoUrl} size={50} />
                </RNHostView>
                <VStack alignment="leading" spacing={2}>
                  <Text modifiers={[font({ textStyle: 'headline' }), primary, lineLimit(1)]}>{me.data?.nickname ?? ''}</Text>
                  <Text modifiers={[font({ textStyle: 'subheadline' }), secondary]}>Мой профиль, PIN и уведомления</Text>
                </VStack>
                <Spacer />
                <Image systemName="chevron.right" size={13} modifiers={[tertiary, font({ weight: 'semibold' })]} />
              </HStack>
            </Button>
          </Section>

          <Section title="Команда" footer={<Text>Сотрудник — клиент клуба с правами: у него тот же профиль, баланс и бонусы. «+» — выбрать из клиентов.</Text>}>
            {staff.isLoading ? (
              <ProgressView />
            ) : rows.length === 0 ? (
              <ContentUnavailableView title="Команды пока нет" systemImage="person.2" description="Нажмите «+» и выберите клиента — он станет сотрудником." />
            ) : (
              rows.map((row) => <StaffLine key={row.id} row={row} onPress={() => open(row)} />)
            )}
          </Section>

          {!settings.loading && (
            <Section
              title="Касса для команды"
              footer={<Text>{compOn ? 'Чек сотрудника закрывается за 0 ₽ — всё списывается на персонал. Игровой тариф на чек сотрудника касса не ставит.' : 'Сотрудник платит за себя как гость, но без игрового тарифа.'}</Text>}>
              <Toggle label="Списание на персонал" isOn={compOn} onIsOnChange={(on) => settings.save({ [STAFF_COMP_KEYS.enabled]: on ? '1' : '0' })} />
              {compOn && (
                <>
                  <Picker
                    label="Кому"
                    selection={settings.text(STAFF_COMP_KEYS.scope, 'all') === 'shift' ? 'shift' : 'all'}
                    onSelectionChange={(v) => settings.save({ [STAFF_COMP_KEYS.scope]: String(v) })}
                    modifiers={[pickerStyle('menu')]}>
                    <Text modifiers={[tag('shift')]}>Только тем, кто на смене</Text>
                    <Text modifiers={[tag('all')]}>Всей команде</Text>
                  </Picker>
                  <Toggle label="Владельцам тоже" isOn={settings.flag(STAFF_COMP_KEYS.owners, true)} onIsOnChange={(on) => settings.save({ [STAFF_COMP_KEYS.owners]: on ? '1' : '0' })} />
                </>
              )}
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}

function StaffLine({ row, onPress }: { row: StaffRow; onPress: () => void }) {
  const caption = [
    row.role === 'owner' ? 'Владелец' : 'Сотрудник',
    row.onShift ? 'на смене' : null,
    row.tgId ? null : 'без Telegram',
    row.role === 'staff' && !row.hasPin ? 'PIN не задан' : null,
  ].filter(Boolean).join(' · ');
  return (
    <Button
      onPress={() => {
        haptic.selection();
        onPress();
      }}>
      <HStack spacing={12}>
        <RNHostView matchContents>
          <Avatar name={row.nickname} photoUrl={row.photoUrl} size={40} />
        </RNHostView>
        <VStack alignment="leading" spacing={2}>
          <HStack spacing={6}>
            <Text modifiers={[primary, lineLimit(1)]}>{row.nickname}</Text>
            {row.role === 'owner' ? <Image systemName="crown.fill" size={12} modifiers={[foregroundStyle(OWNER)]} /> : null}
            {row.onShift ? <Image systemName="circle.fill" size={8} modifiers={[foregroundStyle(ON_SHIFT)]} /> : null}
          </HStack>
          <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>{caption}</Text>
        </VStack>
        <Spacer />
        <Image systemName="chevron.right" size={13} modifiers={[tertiary, font({ weight: 'semibold' })]} />
      </HStack>
    </Button>
  );
}
