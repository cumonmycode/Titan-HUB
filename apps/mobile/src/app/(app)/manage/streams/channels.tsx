import { Form, Section, Text } from '@expo/ui/swift-ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { FieldRow, FormHost } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';
import { setStreamChannels, useStreams, type StreamLink } from '@/lib/telegram-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isHttps = (url: string) => /^https:\/\/\S+\.\S+/i.test(url.trim());
const SLOTS = 3;
const PLACEHOLDERS = [
  { label: 'VK Видео', url: 'https://live.vkvideo.ru/titan' },
  { label: 'YouTube', url: 'https://youtube.com/@titan' },
  { label: 'Twitch', url: 'https://twitch.tv/titan' },
];

interface Slot { label: string; url: string }

/**
 * «Маркетинг → Трансляции → Площадки и донат»: где клуб стримит (до трёх каналов) и ссылка на донат.
 * Клиент видит их в «Трансляциях» всегда — и между эфирами; во время эфира рядом
 * показываются ссылки самого эфира.
 */
export default function StreamChannelsEditor() {
  const { data } = useStreams();
  // Редактор открывается из «Стримов», где данные уже загружены.
  return data ? <Editor initial={data.channels ?? []} /> : null;
}

function Editor({ initial }: { initial: StreamLink[] }) {
  const router = useRouter();
  const club = useClubKey();
  const watch = initial.filter((l) => l.kind === 'watch');
  const [slots, setSlots] = useState<Slot[]>(
    Array.from({ length: SLOTS }, (_, i) => ({ label: watch[i]?.label ?? '', url: watch[i]?.url ?? '' })),
  );
  const [donate, setDonate] = useState(initial.find((l) => l.kind === 'donate')?.url ?? '');
  const [busy, setBusy] = useState(false);

  const filled = slots.filter((s) => s.url.trim());
  const valid = filled.every((s) => isHttps(s.url)) && (!donate.trim() || isHttps(donate));
  const update = (i: number, patch: Partial<Slot>) => setSlots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const submit = async () => {
    const links: StreamLink[] = [
      ...filled.map((s): StreamLink => ({ kind: 'watch', label: s.label.trim() || 'Смотреть', url: s.url.trim() })),
      ...(donate.trim() ? [{ kind: 'donate' as const, label: 'Донат', url: donate.trim() }] : []),
    ];
    setBusy(true);
    try {
      await setStreamChannels(links);
      haptic.success();
      await queryClient.invalidateQueries({ queryKey: [club, 'telegram', 'streams'] });
      router.back();
    } catch (error) {
      haptic.error();
      Alert.alert('Не сохранилось', errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <EditorToolbar title="Площадки и донат" canSave={valid} busy={busy} onSave={() => void submit()} />
      <FormHost>
        <Form>
          {slots.map((slot, i) => (
            <Section
              key={i}
              title={`Площадка ${i + 1}`}
              footer={i === 0 ? <Text>Ссылка на канал клуба (только https). Пустую площадку клиент не увидит.</Text> : undefined}
            >
              <FieldRow value={slot.label} placeholder={PLACEHOLDERS[i]!.label} maxLength={40} onChange={(v) => update(i, { label: v })} />
              <FieldRow value={slot.url} placeholder={PLACEHOLDERS[i]!.url} keyboard="url" maxLength={500} onChange={(v) => update(i, { url: v })} />
            </Section>
          ))}
          <Section title="Донат" footer={<Text>Кнопка «Поддержать донатом» в My Titan. Если у эфира своя ссылка на донат — во время эфира покажется она.</Text>}>
            <FieldRow value={donate} placeholder="https://www.donationalerts.com/r/titan" keyboard="url" maxLength={500} onChange={setDonate} />
          </Section>
        </Form>
      </FormHost>
    </>
  );
}
