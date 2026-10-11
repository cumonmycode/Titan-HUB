import { Form, Host, LabeledContent, Section, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, refreshable } from '@expo/ui/swift-ui/modifiers';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionRow, primary, secondary } from '@/components/native-form';
import { createBackup, useBackupStatus, useClubContext, useSystemInfo } from '@/lib/admin-api';
import { ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useSession } from '@/lib/session';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const SUBSCRIPTION: Record<string, { label: string; color: string }> = {
  active: { label: 'Активна', color: '#34C759' },
  expiring: { label: 'Скоро закончится', color: '#FF9500' },
  grace: { label: 'Льготный период', color: '#FF9500' },
  expired: { label: 'Закончилась', color: '#FF3B30' },
  suspended: { label: 'Приостановлена', color: '#FF3B30' },
  none: { label: 'Не оформлена', color: '#8E8E93' },
  unknown: { label: 'Неизвестно', color: '#8E8E93' },
};

/** Ключи модулей — как их гейтит сервер (app.ts: requireModule / requireAiPaid). */
const MODULE_LABELS: Record<string, string> = {
  ai: 'Tai — ИИ-ассистент',
  analytics: 'Аналитика',
  events: 'Мероприятия',
  certificates: 'Сертификаты',
  discounts: 'Скидки и бонусы',
  platega: 'Приём оплат по СБП',
  residents: 'My Titan',
  booking: 'Онлайн-бронирование',
  polls: 'Опросы',
};

const dateText = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');
const whenText = (value: string | null | undefined) => (value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const sizeText = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`);

function Value({ children, color }: { children: string; color?: string }) {
  return <Text modifiers={[color ? foregroundStyle(color) : secondary]}>{children}</Text>;
}

/** О системе: клуб и подписка, модули, версии, текущая смена и резервные копии. */
export default function AboutScreen() {
  const club = useSession((s) => s.club);
  const isOwner = useSession((s) => s.user?.role === 'owner');
  const context = useClubContext();
  const info = useSystemInfo();
  const backup = useBackupStatus();
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    await Promise.allSettled([context.refetch(), info.refetch(), backup.refetch()]);
  };

  const subscription = context.data?.subscription;
  // Клуб-арендатор живёт на поддомене: у него есть подписка и матрица модулей.
  // На основном сервере /club/context отдаёт club: null — подписку показывать нечего.
  const tenant = !!context.data?.club;
  const look = SUBSCRIPTION[subscription?.state ?? 'unknown'] ?? SUBSCRIPTION.unknown!;
  const modules = Object.entries(context.data?.modules ?? {}).filter(([, on]) => on);
  const last = backup.data?.last ?? null;
  // Бэкап/восстановление — только на основном домене: на клуб-поддомене API отвечает 403.
  const backupAvailable = !tenant && !(backup.error instanceof ApiError && backup.error.status === 403);

  const makeBackup = () =>
    Alert.alert('Сделать резервную копию?', 'Снимок базы клуба сохранится на сервере' + (backup.data?.driveConfigured ? ' и в Google Drive.' : '. Google Drive не подключён.'), [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Сделать копию',
        onPress: () => {
          haptic.medium();
          setSaving(true);
          createBackup()
            .then((result) => {
              haptic.success();
              Alert.alert('Копия готова', `${result.name}${result.uploaded ? '\nЗагружена в Google Drive.' : ''}`);
            })
            .catch((error: unknown) => {
              haptic.error();
              Alert.alert('Копия не создана', errorText(error));
            })
            .finally(() => setSaving(false));
        },
      },
    ]);

  return (
    <>
      <Stack.Title>О системе</Stack.Title>
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(refresh)]}>
          <Section footer={<Text>Titan HUB · касса для клубов «Мафии»</Text>}>
            <VStack alignment="leading" spacing={2}>
              <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' }), primary]}>{context.data?.club?.name ?? club?.name ?? 'Titan HUB'}</Text>
              <Text modifiers={[secondary]}>{club?.host ?? context.data?.club?.slug ?? ''}</Text>
            </VStack>
          </Section>

          {tenant && (
            <Section title="Подписка" footer={<Text>{subscription?.blocked ? 'Доступ ограничен до продления подписки.' : 'Продлить подписку можно в веб-кассе.'}</Text>}>
              <LabeledContent label="Состояние">
                <Value color={look.color}>{look.label}</Value>
              </LabeledContent>
              <LabeledContent label="Оплачено до">
                <Value>{dateText(subscription?.paidUntil)}</Value>
              </LabeledContent>
              {subscription?.daysLeft !== null && subscription?.daysLeft !== undefined && (
                <LabeledContent label="Осталось дней">
                  <Value>{String(subscription.daysLeft)}</Value>
                </LabeledContent>
              )}
            </Section>
          )}

          {!tenant && context.data && (
            <Section title="Режим" footer={<Text>Подписка и набор модулей настраиваются для клубов на поддоменах.</Text>}>
              <LabeledContent label="Основной сервер">
                <Value>без подписки</Value>
              </LabeledContent>
            </Section>
          )}

          {modules.length > 0 && (
            <Section title="Подключённые модули">
              {modules.map(([key]) => (
                <LabeledContent key={key} label={MODULE_LABELS[key] ?? key}>
                  <Value color="#34C759">включён</Value>
                </LabeledContent>
              ))}
            </Section>
          )}

          <Section title="Версии">
            <LabeledContent label="Приложение">
              <Value>{Constants.expoConfig?.version ?? '—'}</Value>
            </LabeledContent>
            <LabeledContent label="Сервер">
              <Value>{info.data?.version ?? '—'}</Value>
            </LabeledContent>
            {info.data?.env ? (
              <LabeledContent label="Окружение">
                <Value>{info.data.env}</Value>
              </LabeledContent>
            ) : null}
          </Section>

          <Section title="Сейчас">
            <LabeledContent label="Смена">
              <Value color={info.data?.shift ? '#34C759' : undefined}>{info.data?.shift ? 'открыта' : 'закрыта'}</Value>
            </LabeledContent>
            {info.data?.eveningName ? (
              <LabeledContent label="Вечер">
                <Value>{info.data.eveningName}</Value>
              </LabeledContent>
            ) : null}
          </Section>

          {isOwner && backupAvailable && (
            <Section title="Резервные копии" footer={<Text>Восстановление из копии делается только в веб-кассе — там это безопаснее.</Text>}>
              <LabeledContent label="Последняя копия">
                <Value>{last ? `${whenText(last.at)} · ${last.location === 'drive' ? 'Google Drive' : 'сервер'} · ${sizeText(last.size)}` : 'копий пока нет'}</Value>
              </LabeledContent>
              <ActionRow title={saving ? 'Делаем копию…' : 'Сделать копию сейчас'} icon="arrow.clockwise.icloud" disabled={saving} onPress={makeBackup} />
            </Section>
          )}
        </Form>
      </Host>
    </>
  );
}
