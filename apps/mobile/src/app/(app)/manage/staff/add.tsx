import { Button, ContentUnavailableView, Form, HStack, Image, Picker, ProgressView, RNHostView, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FormHost, primary, SearchRow, secondary, tertiary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import { useDebounced } from '@/components/player-picker';
import { haptic } from '@/lib/haptics';
import { defaultPermissions, PERMISSIONS, promoteToStaff, useStaffCandidates, type StaffCandidate, type StaffRole } from '@/lib/staff-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Новый человек в команде: выбрать клиента клуба и выдать роль и права. Профиль тот же —
 * история, баланс и Telegram остаются. Войти в HUB он сможет через Telegram, PIN задаст сам.
 */
export default function AddStaffScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 250);
  const candidates = useStaffCandidates(q);
  const [picked, setPicked] = useState<StaffCandidate | null>(null);
  const [role, setRole] = useState<StaffRole>('staff');
  const [permissions, setPermissions] = useState<Record<string, boolean>>(defaultPermissions);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!picked || busy) return;
    haptic.medium();
    setBusy(true);
    try {
      await promoteToStaff(picked.id, role, role === 'owner' ? {} : permissions);
      haptic.success();
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не добавлен', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title={picked ? picked.nickname : 'Кого добавить'} canSave={!!picked} busy={busy} saveLabel="Добавить" busyLabel="Добавляем…" onSave={() => void save()} />
      <FormHost>
        <Form>
          {picked ? (
            <>
              <Section>
                <HStack spacing={14}>
                  <RNHostView matchContents>
                    <Avatar name={picked.nickname} photoUrl={picked.photoUrl} size={56} />
                  </RNHostView>
                  <VStack alignment="leading" spacing={2}>
                    <Text modifiers={[font({ textStyle: 'title3', weight: 'semibold' }), primary, lineLimit(1)]}>{picked.nickname}</Text>
                    <Text modifiers={[secondary, lineLimit(1)]}>{[picked.fullName, picked.phone].filter(Boolean).join(' · ') || 'Клиент клуба'}</Text>
                  </VStack>
                  <Spacer />
                  <Button label="Другой" onPress={() => setPicked(null)} />
                </HStack>
              </Section>

              <Section title="Роль" footer={<Text>{role === 'owner' ? 'Владелец видит всё: деньги, аналитику, настройки клуба. Зарплату не получает.' : 'Сотрудник работает в кассе, ходит на смены и получает зарплату.'}</Text>}>
                <Picker selection={role} onSelectionChange={(v) => setRole(v as StaffRole)} modifiers={[pickerStyle('segmented')]}>
                  <Text modifiers={[tag('staff')]}>Сотрудник</Text>
                  <Text modifiers={[tag('owner')]}>Владелец</Text>
                </Picker>
              </Section>

              {role === 'staff' && (
                <Section title="Права" footer={<Text>Какие разделы «Управления» он увидит. Поменять можно в любой момент в его карточке.</Text>}>
                  {PERMISSIONS.map((p) => (
                    <Toggle key={p.key} label={p.label} isOn={permissions[p.key] ?? p.defaultOn} onIsOnChange={(on) => setPermissions({ ...permissions, [p.key]: on })} />
                  ))}
                </Section>
              )}

              <Section>
                <Text modifiers={[secondary]}>
                  {picked.tgLinked
                    ? 'Telegram уже привязан — войти в HUB можно сразу через Tai, PIN он задаст при первом входе.'
                    : 'Telegram не привязан: после добавления откройте его карточку и отправьте ссылку для привязки.'}
                </Text>
              </Section>
            </>
          ) : (
            <>
              <Section>
                <SearchRow placeholder="Ник, имя или телефон клиента" onChange={setQuery} />
              </Section>
              <Section title={q ? 'Найдено' : 'Клиенты'} footer={<Text>Сотрудником становится клиент клуба — с тем же профилем, балансом и историей.</Text>}>
                {candidates.isLoading ? (
                  <ProgressView />
                ) : !candidates.data?.length ? (
                  <ContentUnavailableView title="Никого не нашли" systemImage="person.crop.circle.badge.questionmark" description="Если человека ещё нет в клиентах — сначала добавьте его в «Клиенты»." />
                ) : (
                  candidates.data.map((c) => (
                    <Button
                      key={c.id}
                      onPress={() => {
                        haptic.selection();
                        setPicked(c);
                      }}>
                      <HStack spacing={12}>
                        <RNHostView matchContents>
                          <Avatar name={c.nickname} photoUrl={c.photoUrl} size={38} />
                        </RNHostView>
                        <VStack alignment="leading" spacing={2}>
                          <Text modifiers={[primary, lineLimit(1)]}>{c.nickname}</Text>
                          <Text modifiers={[font({ textStyle: 'footnote' }), secondary, lineLimit(1)]}>
                            {[c.tierLabel, c.fullName, c.phone, c.tgLinked ? null : 'без Telegram'].filter(Boolean).join(' · ')}
                          </Text>
                        </VStack>
                        <Spacer />
                        <Image systemName="plus.circle.fill" size={20} modifiers={[tertiary]} />
                      </HStack>
                    </Button>
                  ))
                )}
              </Section>
            </>
          )}
        </Form>
      </FormHost>
    </>
  );
}
