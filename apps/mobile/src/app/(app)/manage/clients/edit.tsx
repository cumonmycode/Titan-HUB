import { Button, ContentUnavailableView, DatePicker, Form, Picker, ProgressView, RNHostView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { RankRow } from '@/components/analytics/native';
import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost, LinkRow } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { Text as RNText } from '@/components/text';
import { useDebounced } from '@/components/player-picker';
import {
  clientPhoto,
  createClientProfile,
  fetchGomafiaFullName,
  gomafiaIdOf,
  linkGomafia,
  mergeTags,
  tierLook,
  unlinkGomafia,
  updateClient,
  useClient,
  useClientTiers,
  useGomafiaSearch,
  userTags,
  type Client,
  type GomafiaPlayer,
} from '@/lib/clients-api';
import { haptic } from '@/lib/haptics';
import { cleanPhone, pickContact } from '@/lib/phone-book';
import { pickAndUploadPhoto } from '@/lib/photo';
import { colors } from '@/lib/theme';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const pad = (n: number) => String(n).padStart(2, '0');
const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseBirthday(value: string | null | undefined): Date | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

/**
 * Новый клиент или правка профиля. При создании ник сразу ищется на GoMafia — выбор
 * подставляет ник, имя и фото игрока. Статус — списком из справочника клуба.
 */
export default function ClientEditSheet() {
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const router = useRouter();
  const client = useClient(clientId);

  if (clientId && !client.data) {
    return (
      <FormHost>
        {client.isError ? <ContentUnavailableView title="Клиент не загрузился" systemImage="wifi.exclamationmark" description={errorText(client.error)} /> : <ProgressView />}
      </FormHost>
    );
  }

  return (
    <ClientForm
      key={client.data?.id ?? 'new'}
      initial={clientId ? client.data : undefined}
      onCreated={(created) => {
        router.back();
        setTimeout(() => router.push({ pathname: '/manage/clients/[clientId]', params: { clientId: created.id } }), 420);
      }}
    />
  );
}

function ClientForm({ initial, onCreated }: { initial: Client | undefined; onCreated: (client: Client) => void }) {
  const router = useRouter();
  const tiers = useClientTiers();
  const [nickname, setNickname] = useState(initial?.nickname ?? '');
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  // Подстановка из GoMafia или контактов пересоздаёт поля — иначе они держат прежний текст.
  const [fieldsVersion, setFieldsVersion] = useState(0);
  const initialBirthday = parseBirthday(initial?.birthday);
  const [hasBirthday, setHasBirthday] = useState(!!initial?.birthday);
  const [birthday, setBirthday] = useState<Date>(initialBirthday ?? new Date(2000, 0, 1));
  const [birthdayTouched, setBirthdayTouched] = useState(false);
  const [tier, setTier] = useState(initial?.clientTier ?? 'newbie');
  const [tagsText, setTagsText] = useState(initial ? userTags(initial).join(', ') : '');
  const [gomafia, setGomafia] = useState<GomafiaPlayer | null>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const creating = !initial;
  const linkedId = initial ? gomafiaIdOf(initial) : null;
  // При создании ищем по нику; при правке — отдельным полем «Сопоставить».
  const gomafiaQuery = useDebounced(creating ? (gomafia ? '' : nickname) : linking ? linkQuery : '', 350);
  const suggestions = useGomafiaSearch(gomafiaQuery);
  const tierList = [...(tiers.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const suggestionList = (suggestions.data ?? []).slice(0, 5);
  const showSuggestions = gomafiaQuery.length >= 2 && (suggestions.isFetching || suggestionList.length > 0);

  const pickGomafia = (player: GomafiaPlayer) => {
    haptic.selection();
    setGomafia(player);
    setNickname(player.login);
    if (player.fullName) setFullName((current) => current || player.fullName || '');
    else
      void fetchGomafiaFullName(player.gomafiaId).then((name) => {
        if (!name) return;
        setFullName((current) => current || name);
        setFieldsVersion((v) => v + 1);
      });
    setFieldsVersion((v) => v + 1);
  };

  const link = async (player: GomafiaPlayer) => {
    if (!initial) return;
    haptic.medium();
    try {
      await linkGomafia(initial.id, player.gomafiaId);
      haptic.success();
      setLinking(false);
      setLinkQuery('');
    } catch (error) {
      haptic.error();
      Alert.alert('Не сопоставлено', errorText(error));
    }
  };

  const unlink = () =>
    Alert.alert('Снять привязку GoMafia?', 'Фото с GoMafia у клиента пропадёт.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Снять',
        style: 'destructive',
        onPress: () =>
          initial &&
          unlinkGomafia(initial.id)
            .then(() => haptic.success())
            .catch((error: unknown) => Alert.alert('Привязка не снята', errorText(error))),
      },
    ]);

  /** Телефон и имя клиента из адресной книги. Ник оставляем как есть — он игровой. */
  const fromContacts = () => {
    void pickContact().then((contact) => {
      if (!contact) return;
      if (contact.phone) setPhone(cleanPhone(contact.phone));
      if (contact.name && !fullName.trim()) setFullName(contact.name);
      setFieldsVersion((v) => v + 1);
      haptic.success();
    });
  };

  // Фото сохраняется сразу — отдельно от «Сохранить», как в «Контактах».
  const savePhoto = (photoUrl: string | null) =>
    initial &&
    updateClient(initial.id, { photoUrl })
      .then(() => haptic.success())
      .catch((error: unknown) => Alert.alert('Фото не сохранилось', errorText(error)));
  const changePhoto = () => pickAndUploadPhoto('Фото клиента', (photoUrl) => void savePhoto(photoUrl), setPhotoBusy);
  const removePhoto = () =>
    Alert.alert('Убрать фото?', 'Останется фото из Telegram или GoMafia, если оно есть.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => void savePhoto(null) },
    ]);

  const save = async () => {
    const nick = nickname.trim();
    if (nick.length < 2) return;
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const birthdayValue = hasBirthday ? toDateKey(birthday) : null;

    haptic.medium();
    setBusy(true);
    try {
      if (initial) {
        await updateClient(initial.id, {
          nickname: nick,
          fullName: fullName.trim() || null,
          phone: phone.trim() || null,
          // Нестандартную дату из веба не перезаписываем, пока её не трогали.
          ...(birthdayTouched || !hasBirthday || initialBirthday ? { birthday: birthdayValue } : {}),
          clientTier: tier,
          searchTags: mergeTags(initial, tags),
        });
        haptic.success();
        router.back();
      } else {
        const created = await createClientProfile(
          { nickname: nick, fullName: fullName.trim() || null, phone: phone.trim() || null, birthday: birthdayValue, clientTier: tier, tags },
          gomafia,
        );
        haptic.success();
        onCreated(created);
      }
    } catch (error) {
      haptic.error();
      Alert.alert(initial ? 'Изменения не сохранены' : 'Клиент не создан', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const results = (onPick: (player: GomafiaPlayer) => void) =>
    suggestionList.length === 0 && suggestions.isFetching ? (
      <ProgressView />
    ) : (
      suggestionList.map((player) => (
        <Button key={player.gomafiaId} onPress={() => onPick(player)}>
          <RankRow
            photo={{ name: player.login, url: player.avatar }}
            name={player.inClub ? `${player.login} · в клубе` : player.login}
            caption={[player.clubTitle ?? 'Без клуба', player.elo ? `ELO ${Math.round(player.elo)}` : null].filter(Boolean).join(' · ')}
            value="＋"
          />
        </Button>
      ))
    );

  return (
    <>
      <EditorToolbar title={initial ? 'Профиль клиента' : 'Новый клиент'} canSave={nickname.trim().length >= 2} busy={busy} saveLabel={initial ? 'Сохранить' : 'Создать'} onSave={() => void save()} />
      <FormHost>
        <Form>
          {initial ? (
            <Section>
              <RNHostView matchContents>
                <View style={styles.photo}>
                  <Pressable onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Сменить фото">
                    <Avatar name={initial.nickname} photoUrl={clientPhoto(initial)} size={88} />
                    {photoBusy ? <ActivityIndicator style={styles.photoBusy} /> : null}
                  </Pressable>
                  <View style={styles.photoActions}>
                    <Pressable onPress={changePhoto} hitSlop={6} accessibilityRole="button">
                      <RNText style={styles.photoAction}>{initial.photoUrl ? 'Сменить фото' : 'Добавить фото'}</RNText>
                    </Pressable>
                    {initial.photoUrl ? (
                      <Pressable onPress={removePhoto} hitSlop={6} accessibilityRole="button">
                        <RNText style={[styles.photoAction, styles.remove]}>Убрать</RNText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </RNHostView>
            </Section>
          ) : null}

          <Section title="Ник и имя" footer={creating && !gomafia ? <Text>Начните вводить ник — найдём игрока на GoMafia и подставим имя и фото.</Text> : undefined}>
            <FieldRow key={`nick-${fieldsVersion}`} value={nickname} placeholder="Ник" autoFocus={creating && fieldsVersion === 0} maxLength={40} onChange={setNickname} />
            <FieldRow key={`name-${fieldsVersion}`} value={fullName} placeholder="Реальное имя" onChange={setFullName} />
          </Section>

          {creating && gomafia && (
            <Section title="GoMafia">
              <RankRow
                photo={{ name: gomafia.login, url: gomafia.avatar }}
                name={gomafia.login}
                caption={[gomafia.fullName, gomafia.clubTitle, gomafia.elo ? `ELO ${Math.round(gomafia.elo)}` : null].filter(Boolean).join(' · ') || `#${gomafia.gomafiaId}`}
                value="✓"
              />
              <ActionRow title="Не привязывать" icon="xmark.circle" onPress={() => setGomafia(null)} />
            </Section>
          )}

          {creating && !gomafia && showSuggestions && <Section title="Найдено на GoMafia">{results(pickGomafia)}</Section>}

          <Section title="Связь">
            <FieldRow key={`phone-${fieldsVersion}`} value={phone} placeholder="Телефон" keyboard="phone-pad" onChange={setPhone} />
            <ActionRow title="Взять телефон из контактов" icon="person.crop.circle.badge.plus" onPress={fromContacts} />
            {initial ? (
              <LinkRow
                icon="paperplane.fill"
                color="#2AABEE"
                title="Telegram"
                value={initial.tgUsername ? `@${initial.tgUsername.replace(/^@/, '')}` : initial.tgId ? 'привязан' : 'привязать'}
                onPress={() => router.push({ pathname: '/manage/clients/telegram', params: { clientId: initial.id } })}
              />
            ) : null}
            <Toggle
              label="День рождения"
              isOn={hasBirthday}
              onIsOnChange={(on) => {
                setHasBirthday(on);
                setBirthdayTouched(true);
              }}
            />
            {hasBirthday && (
              <DatePicker
                title="Дата"
                selection={birthday}
                displayedComponents={['date']}
                range={{ end: new Date() }}
                onDateChange={(date) => {
                  setBirthday(date);
                  setBirthdayTouched(true);
                }}
              />
            )}
          </Section>

          <Section title="Статус">
            {tiers.isLoading ? (
              <ProgressView />
            ) : (
              <Picker label="Статус" selection={tier} onSelectionChange={(value) => setTier(String(value))} modifiers={[pickerStyle('menu')]}>
                {tierList.map((t) => (
                  <Text key={t.key} modifiers={[tag(t.key)]}>
                    {tierLook(t.key, tiers.data).label}
                  </Text>
                ))}
              </Picker>
            )}
          </Section>

          <Section title="Теги" footer={<Text>Через запятую. Поиск клиентов находит и по тегам.</Text>}>
            <FieldRow value={tagsText} placeholder="VIP, друг, постоянный" onChange={setTagsText} />
          </Section>

          {initial && (
            <Section title="GoMafia">
              {linkedId ? (
                <>
                  <LinkRow icon="checkmark.seal.fill" color="#34C759" title={`Профиль #${linkedId}`} subtitle="Открыть на gomafia.pro" onPress={() => void Linking.openURL(`https://gomafia.pro/stats/${linkedId}`)} />
                  <ActionRow title="Отвязать" icon="link.badge.plus" destructive onPress={unlink} />
                </>
              ) : linking ? (
                <>
                  <FieldRow value={linkQuery} placeholder="Ник игрока на GoMafia" autoFocus onChange={setLinkQuery} />
                  {showSuggestions && results((player) => void link(player))}
                  <ActionRow title="Отмена" icon="xmark.circle" onPress={() => setLinking(false)} />
                </>
              ) : (
                <ActionRow
                  title="Сопоставить с GoMafia"
                  icon="link.badge.plus"
                  onPress={() => {
                    setLinking(true);
                    setLinkQuery(initial.nickname);
                  }}
                />
              )}
            </Section>
          )}
        </Form>
      </FormHost>
    </>
  );
}

const styles = StyleSheet.create({
  photo: { alignItems: 'center', gap: 10, paddingVertical: 14 },
  photoBusy: { position: 'absolute', top: 34, left: 34 },
  photoActions: { flexDirection: 'row', gap: 24 },
  photoAction: { fontSize: 16, color: colors.accent, fontWeight: '500' },
  remove: { color: colors.red },
});
