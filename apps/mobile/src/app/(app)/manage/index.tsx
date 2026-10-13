import { Button, Form, HStack, Host, Image, RNHostView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, refreshable } from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter, type Href } from 'expo-router';
import { Alert } from 'react-native';

import { ActionRow, LinkRow, primary, secondary, tertiary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { SmmCard } from '@/components/smm/menu-card';
import { permissionOn } from '@/lib/admin-api';
import { haptic } from '@/lib/haptics';
import { visibleManageGroups, type ManageSectionKey } from '@/lib/manage-sections';
import { signOutEverywhere, useMe } from '@/lib/queries';
import { useSession } from '@/lib/session';

const ROLE_LABEL: Record<string, string> = { owner: 'Владелец', staff: 'Сотрудник' };

/** Экран каждого раздела «Управления». */
const SECTION_SCREENS: Record<ManageSectionKey, Href> = {
  goods: '/manage/goods',
  pricing: '/manage/pricing',
  screens: '/manage/screens',
  clients: '/manage/clients',
  balances: '/manage/balances',
  customers: '/manage/customers',
  collections: '/manage/collections',
  polls: '/manage/polls',
  broadcasts: '/manage/broadcasts',
  shifts: '/manage/shifts',
  salary: '/manage/salary',
  expenses: '/manage/expenses',
  loyalty: '/manage/loyalty',
  staff: '/manage/staff',
  settings: '/manage/settings',
  tai: '/manage/tai',
  about: '/manage/about',
};

/**
 * «Управление» — как «Настройки» iOS 26: нативная форма (Liquid Glass в шапке и таб-баре),
 * сверху карточка профиля, ниже разделы группами по смыслу, в конце — клуб и выход.
 */
export default function ManageScreen() {
  const router = useRouter();
  const club = useSession((s) => s.club);
  const sessionUser = useSession((s) => s.user);
  const me = useMe();

  const nickname = me.data?.nickname ?? sessionUser?.nickname ?? '';
  const role = me.data?.role ?? sessionUser?.role ?? 'staff';
  const groups = visibleManageGroups(role, me.data?.permissions ?? null);
  const smmAllowed = role === 'owner' || (role === 'staff' && permissionOn({ permissions: me.data?.permissions ?? null }, 'smm'));

  const changeClub = () =>
    Alert.alert('Сменить клуб?', 'Вы выйдете из текущего клуба.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Сменить',
        onPress: async () => {
          await signOutEverywhere();
          await useSession.getState().forgetClub();
        },
      },
    ]);

  const logout = () =>
    Alert.alert('Выйти из кассы?', 'Для входа понадобится PIN или пароль.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: () => void signOutEverywhere() },
    ]);

  return (
    <>
      <Stack.Title large>Управление</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form
          modifiers={[
            refreshable(async () => {
              await me.refetch();
            }),
          ]}>
          <Section>
            <Button
              onPress={() => {
                haptic.selection();
                router.push('/manage/staff/me');
              }}>
              <HStack spacing={14}>
                <RNHostView matchContents>
                  <Avatar name={nickname || '··'} photoUrl={me.data?.photoUrl} size={58} />
                </RNHostView>
                <VStack alignment="leading" spacing={2}>
                  <Text modifiers={[font({ textStyle: 'title3', weight: 'semibold' }), primary, lineLimit(1)]}>{nickname || 'Профиль'}</Text>
                  <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(1)]}>
                    {`${ROLE_LABEL[role] ?? role} · ${club?.name ?? ''}`}
                  </Text>
                  <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>Личные данные, PIN, уведомления</Text>
                </VStack>
                <Spacer />
                <Image systemName="chevron.right" size={13} modifiers={[tertiary, font({ weight: 'semibold' })]} />
              </HStack>
            </Button>
          </Section>

          {smmAllowed ? <SmmCard onPress={() => router.push('/manage/smm')} /> : null}

          {groups.map((group) => (
            <Section key={group.title} title={group.title}>
              {group.items.map((item) => (
                <LinkRow
                  key={item.key}
                  icon={item.icon}
                  color={item.color}
                  title={item.title}
                  subtitle={item.subtitle}
                  onPress={() => router.push(SECTION_SCREENS[item.key])}
                />
              ))}
            </Section>
          ))}

          <Section footer={<Text>{club?.host ?? ''}</Text>}>
            <ActionRow title="Сменить клуб" icon="arrow.left.arrow.right" onPress={changeClub} />
            <ActionRow title="Выйти" icon="rectangle.portrait.and.arrow.right" destructive onPress={logout} />
          </Section>
        </Form>
      </Host>
    </>
  );
}
