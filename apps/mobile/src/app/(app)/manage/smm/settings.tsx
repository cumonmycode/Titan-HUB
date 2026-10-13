import { ContentUnavailableView, Form, Picker, ProgressView, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, refreshable, tag } from '@expo/ui/swift-ui/modifiers';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ActionRow, FormHost, LinkRow, TimeRow } from '@/components/native-form';
import { ApiError } from '@/lib/api';
import { chooseAction, promptText } from '@/lib/dialog';
import { haptic } from '@/lib/haptics';
import { useClubKey } from '@/lib/queries';
import { PLATFORM_LOOK, pickMedia, saveSettings, settingsRequest, uploadAsset, useSmmSettings, type SmmAccount, type SmmSettings, type SmmSettingsPayload } from '@/lib/smm-api';
import { queryClient } from '@/lib/query';
import { colors, space } from '@/lib/theme';

const WEEK_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 10, 14];
const LEAD_HOURS = [6, 12, 24, 48, 72];
const BUDGETS = [0, 1000, 2000, 3000, 5000, 10000, 20000];

const fail = (error: unknown) => Alert.alert('Не получилось', error instanceof ApiError ? error.message : String(error));

/**
 * Настройки СММ (владелец): площадки, голос бренда, частота, одобрение, кто выкладывает
 * Instagram, фото клуба для картинок и бюджет на нейросети. Всё сохраняется сразу.
 */
export default function SmmSettingsScreen() {
  const router = useRouter();
  const club = useClubKey();
  const query = useSmmSettings();
  const [busy, setBusy] = useState(false);
  const data = query.data;

  if (!data) {
    return (
      <FormHost>
        {query.error ? <ContentUnavailableView title="Не загрузилось" systemImage="wifi.exclamationmark" description={query.error.message} /> : <ProgressView />}
      </FormHost>
    );
  }
  const s = data.settings;
  const save = (patch: Partial<SmmSettings>) => {
    const prev = queryClient.getQueryData<SmmSettingsPayload>([club, 'smm', 'settings']);
    if (prev) queryClient.setQueryData([club, 'smm', 'settings'], { ...prev, settings: { ...prev.settings, ...patch, cadence: { ...prev.settings.cadence, ...(patch.cadence ?? {}) } } });
    void saveSettings(club, patch).then(() => haptic.success(), fail);
  };
  const request = async (method: 'post' | 'patch' | 'delete', path: string, body?: unknown) => {
    setBusy(true);
    try {
      const r = await settingsRequest(club, method, path, body);
      haptic.success();
      return r;
    } catch (error) {
      fail(error);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const connectChannel = () =>
    promptText(
      'Канал Telegram',
      'Сначала добавьте бота Tai в администраторы канала с правом «Публикация сообщений». Затем вставьте ссылку на канал (t.me/имя) или @имя.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Подключить',
          onPress: (input?: string) => {
            if (!input?.trim()) return;
            void request('post', '/smm/accounts', { platform: 'telegram', input: input.trim() }).then((r) => {
              const ch = r?.accounts.find((a) => a.platform === 'telegram' && !a.canPublish);
              if (ch?.statsError) Alert.alert('Канал добавлен, но…', ch.statsError);
            });
          },
        },
      ],
      'plain-text',
      '',
      'url',
    );
  const addAccount = (platform: 'instagram' | 'vk' | 'other') =>
    promptText(
      platform === 'instagram' ? 'Instagram' : platform === 'vk' ? 'ВКонтакте' : 'Другая площадка',
      'Ссылка на профиль или @имя — для аналитики. Публикует в Instagram человек: Tai присылает ему файлы и текст.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Добавить', onPress: (input?: string) => void (input?.trim() ? request('post', '/smm/accounts', { platform, input: input.trim() }) : undefined) },
      ],
      'plain-text',
      '',
      'url',
    );
  const accountMenu = (a: SmmAccount) =>
    chooseAction(a.title, a.statsError ?? undefined, [
      ...(a.platform === 'telegram' ? [{ text: 'Перепроверить права Tai', onPress: () => void request('post', `/smm/accounts/${a.id}/check`) }] : []),
      { text: a.isActive ? 'Выключить' : 'Включить', onPress: () => void request('patch', `/smm/accounts/${a.id}`, { isActive: !a.isActive }) },
      { text: 'Удалить', style: 'destructive' as const, onPress: () => void request('delete', `/smm/accounts/${a.id}`) },
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  const addPhoto = async (kind: 'photo' | 'logo') => {
    const asset = await pickMedia(kind === 'logo' ? 'Логотип клуба' : 'Фото клуба', ['images']);
    if (!asset) return;
    const title = kind === 'logo' ? 'Логотип' : await askTitle();
    setBusy(true);
    try {
      const r = await uploadAsset<SmmSettingsPayload>('/smm/assets', asset, { kind, title });
      queryClient.setQueryData([club, 'smm', 'settings'], r);
      haptic.success();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const publisher = data.staff.find((p) => p.id === s.publisherId);

  return (
    <>
      <Stack.Title>Настройки СММ</Stack.Title>
      <FormHost>
        <Form modifiers={[refreshable(async () => void (await query.refetch()))]}>
          <Section title="Площадки" footer={<Text>В канал Telegram Tai публикует сам. Instagram и сторис выкладывает человек — Tai присылает файлы и текст и ждёт ссылку. Цифры собираются раз в день.</Text>}>
            {data.accounts.map((a) => {
              const look = PLATFORM_LOOK[a.platform];
              const status = a.platform === 'telegram' ? (a.canPublish ? 'Tai публикует' : 'Нет прав на публикацию') : a.followers != null ? `${a.followers} подписчиков` : (a.handle ? `@${a.handle}` : (a.url ?? ''));
              return (
                <LinkRow
                  key={a.id}
                  icon={look.icon}
                  color={a.isActive ? look.color : '#8E8E93'}
                  title={a.title}
                  subtitle={a.isActive ? status : 'Выключена'}
                  valueColor={a.platform === 'telegram' && !a.canPublish ? colors.orange : undefined}
                  onPress={() => accountMenu(a)}
                />
              );
            })}
            {!data.accounts.some((a) => a.platform === 'telegram') ? <ActionRow title="Подключить канал Telegram" icon="paperplane" disabled={busy} onPress={connectChannel} /> : null}
            {!data.accounts.some((a) => a.platform === 'instagram') ? <ActionRow title="Добавить Instagram" icon="camera" disabled={busy} onPress={() => addAccount('instagram')} /> : null}
            <ActionRow title="Добавить другую площадку" icon="plus" disabled={busy} onPress={() => chooseAction('Какая площадка?', undefined, [
              { text: 'Ещё канал Telegram', onPress: connectChannel },
              { text: 'ВКонтакте', onPress: () => addAccount('vk') },
              { text: 'Сайт или другое', onPress: () => addAccount('other') },
              { text: 'Отмена', style: 'cancel' },
            ])} />
          </Section>

          <Section title="Голос бренда" footer={<Text>Tai пишет в этом стиле. Правила, которые Tai вынес из замечаний, — в «Памяти Tai».</Text>}>
            <LinkRow icon="quote.bubble.fill" color="#AF52DE" title="Голос и тон" subtitle={s.voice} onPress={() => router.push({ pathname: '/manage/smm/edit-text', params: { field: 'voice' } })} />
            <LinkRow icon="person.3.fill" color="#007AFF" title="Аудитория" subtitle={s.audience} onPress={() => router.push({ pathname: '/manage/smm/edit-text', params: { field: 'audience' } })} />
            <LinkRow icon="target" color="#FF9500" title="Цели" subtitle={s.goals} onPress={() => router.push({ pathname: '/manage/smm/edit-text', params: { field: 'goals' } })} />
          </Section>

          <Section title="Сколько в неделю" footer={<Text>Рилс лучше всего приводят новых людей — их стоит держать от трёх в неделю.</Text>}>
            <CountPicker label="Посты в Telegram" value={s.cadence.telegram} onChange={(v) => save({ cadence: { ...s.cadence, telegram: v } })} />
            <CountPicker label="Посты в Instagram" value={s.cadence.instagram} onChange={(v) => save({ cadence: { ...s.cadence, instagram: v } })} />
            <CountPicker label="Рилс" value={s.cadence.reels} onChange={(v) => save({ cadence: { ...s.cadence, reels: v } })} />
            <CountPicker label="Дни со сторис" value={s.cadence.stories} onChange={(v) => save({ cadence: { ...s.cadence, stories: v } })} />
          </Section>

          <Section title="Публикация" footer={<Text>{s.autopilot ? 'Автопилот: Telegram-посты выходят без одобрения; превью приходит заранее — можно остановить.' : 'Каждый пост ждёт одобрения — в HUB или кнопкой в Telegram.'}</Text>}>
            <Toggle label="Автопилот для Telegram" isOn={s.autopilot} onIsOnChange={(on) => save({ autopilot: on })} />
            <Picker label="Готовить пост за" selection={s.reviewLeadHours} onSelectionChange={(v) => save({ reviewLeadHours: Number(v) })} modifiers={[pickerStyle('menu')]}>
              {LEAD_HOURS.map((h) => (
                <Text key={h} modifiers={[tag(h)]}>
                  {h < 24 ? `${h} ч` : `${h / 24} сут.`}
                </Text>
              ))}
            </Picker>
            <TimeRow label="Время по умолчанию" value={s.postTime} onChange={(postTime) => save({ postTime })} />
          </Section>

          <Section title="Instagram и сторис выкладывает" footer={<Text>{publisher && !publisher.hasTelegram ? 'У сотрудника не привязан Telegram — Tai не сможет прислать ему файлы.' : 'Tai пришлёт этому человеку файлы и текст в Telegram в момент выхода, а рилс — задачу на съёмку заранее.'}</Text>}>
            <Picker label="Сотрудник" selection={s.publisherId ?? ''} onSelectionChange={(v) => save({ publisherId: String(v) || null })} modifiers={[pickerStyle('menu')]}>
              <Text modifiers={[tag('')]}>Владелец</Text>
              {data.staff.map((p) => (
                <Text key={p.id} modifiers={[tag(p.id)]}>
                  {p.nickname}
                </Text>
              ))}
            </Picker>
          </Section>

          <Section title="Фото клуба" footer={<Text>Интерьер, столы, логотип — Tai берёт их за основу картинок, чтобы на них был ваш клуб, а не выдуманный.</Text>}>
            {data.photos.length ? (
              <RNHostView matchContents>
                <View style={styles.photos}>
                  {data.photos.map((p) => (
                    <Pressable
                      key={p.id}
                      onLongPress={() => Alert.alert('Убрать фото?', p.title, [{ text: 'Отмена', style: 'cancel' }, { text: 'Убрать', style: 'destructive', onPress: () => void request('delete', `/smm/assets/${p.id}`) }])}
                      accessibilityRole="imagebutton"
                      accessibilityLabel={`${p.title}. Удерживайте, чтобы убрать`}>
                      <Image source={{ uri: p.url }} style={styles.photo} contentFit="cover" />
                      {p.kind === 'logo' ? (
                        <View style={styles.logoMark}>
                          <SymbolView name="star.fill" size={10} tintColor="white" />
                        </View>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              </RNHostView>
            ) : null}
            <ActionRow title="Добавить фото клуба" icon="photo.badge.plus" disabled={busy} onPress={() => void addPhoto('photo')} />
            <ActionRow title="Добавить логотип" icon="star.square" disabled={busy} onPress={() => void addPhoto('logo')} />
          </Section>

          <Section title="Нейросети" footer={<Text>{`Тексты — ${short(data.models.text)}, картинки — ${short(data.models.image)}, видео — ${short(data.models.video)}. Ключ Polza — в «Интеграциях».`}</Text>}>
            <Picker label="Бюджет в месяц" selection={s.monthlyBudget} onSelectionChange={(v) => save({ monthlyBudget: Number(v) })} modifiers={[pickerStyle('menu')]}>
              {BUDGETS.map((b) => (
                <Text key={b} modifiers={[tag(b)]}>
                  {b ? `${b.toLocaleString('ru-RU')} ₽` : 'Без ограничения'}
                </Text>
              ))}
            </Picker>
            <LinkRow title="Потрачено в этом месяце" value={`${data.spend.month.toLocaleString('ru-RU')} ₽`} />
            <LinkRow title="Баланс Polza" value={data.balance != null ? `${Math.floor(data.balance).toLocaleString('ru-RU')} ₽` : '—'} valueColor={data.balance != null && data.balance < 300 ? colors.orange : undefined} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}

function CountPicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const options = WEEK_COUNTS.includes(value) ? WEEK_COUNTS : [...WEEK_COUNTS, value].sort((a, b) => a - b);
  return (
    <Picker label={label} selection={value} onSelectionChange={(v) => onChange(Number(v))} modifiers={[pickerStyle('menu')]}>
      {options.map((n) => (
        <Text key={n} modifiers={[tag(n)]}>
          {n === 0 ? 'Не нужно' : String(n)}
        </Text>
      ))}
    </Picker>
  );
}

/** «anthropic/claude-sonnet-5.5» → «claude-sonnet-5.5». */
const short = (model: string) => model.split('/').pop() ?? model;

function askTitle(): Promise<string> {
  return new Promise((resolve) =>
    promptText('Что на фото?', 'Например: «Игровой зал», «Бар», «Стол спортивной мафии».', [
      { text: 'Пропустить', style: 'cancel', onPress: () => resolve('') },
      { text: 'Готово', onPress: (text?: string) => resolve(text?.trim() ?? '') },
    ]),
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingVertical: space.sm },
  photo: { width: 72, height: 72, borderRadius: 12 },
  logoMark: { position: 'absolute', right: 4, top: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
