// «Администратор» — одно место для всего, что связано с персоналом: позвать к
// столу и переписка в рамках счёта (быстрые фразы + своё сообщение).
import { BellRing, Check, Send, X } from 'lucide-react-native';
import { useEffect, useEffectEvent, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';

import { callStaff, markChatRead, sendChat, useCallState } from '@/data/actions';
import { useChat } from '@/data/chat';
import type { ChatMessage } from '@/data/types';
import { useVisit } from '@/features/visit/store';
import { hhmm } from '@/lib/format';
import { Button, IconButton } from '@/ui/button';
import { Loader } from '@/ui/controls';
import { Glass, glassStyle } from '@/ui/glass';
import { useKeyboardHeight } from '@/ui/keyboard';
import { Layer } from '@/ui/layer';
import { Press } from '@/ui/press';
import { useScreen } from '@/ui/screen';
import { T } from '@/ui/text';
import { color, font, radius } from '@/ui/tokens';

const QUICK = ['Принесите воды', 'Уберите со стола', 'Нужны салфетки', 'Спасибо!'];
const CALLED_MS = 30_000;

export function AdminLayer() {
  const open = useVisit((s) => s.layer === 'admin');
  const { width, height } = useScreen();
  const keyboard = useKeyboardHeight();
  return (
    <Layer visible={open} onClose={() => useVisit.getState().close()} variant="dialog" style={{ width: Math.min(760, width - 48), height: height - 48 - keyboard }}>
      <AdminBody />
    </Layer>
  );
}

function AdminBody() {
  const checkId = useVisit((s) => (s.phase.kind === 'session' ? s.phase.checkId : null));
  const calledAt = useCallState((s) => s.calledAt);
  const typing = useKeyboardHeight() > 0;
  const [now, setNow] = useState(() => Date.now());
  const called = now - calledAt < CALLED_MS;

  // Подпись «уже идёт» гаснет сама через 30 секунд после вызова.
  useEffect(() => {
    if (!called) return;
    const t = setTimeout(() => setNow(Date.now()), CALLED_MS - (Date.now() - calledAt) + 50);
    return () => clearTimeout(t);
  }, [called, calledAt]);

  return (
    <>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 3 }}>
          <T variant="title">Администратор</T>
          {typing ? null : <T variant="caption" tone="secondary">{checkId ? 'Ответят прямо здесь — обычно за пару минут' : 'Подойдёт к вашему столу'}</T>}
        </View>
        <IconButton icon={X} label="Закрыть" onPress={() => useVisit.getState().close()} />
      </View>

      {typing ? null : called ? (
        <Glass kind="panel" radius={radius.pill} style={[styles.call, { backgroundColor: color.greenTint, borderColor: 'rgba(52,211,153,0.45)' }]}>
          <Check size={24} color={color.green} strokeWidth={2.2} />
          <T variant="subheading" tone="green">Администратор уже идёт</T>
        </Glass>
      ) : (
        <Button
          title="Позвать к столу"
          icon={BellRing}
          variant="primary"
          size="lg"
          onPress={() => void callStaff().then(() => setNow(Date.now()))}
          style={styles.call}
        />
      )}

      {checkId ? <Chat checkId={checkId} /> : (
        <View style={styles.noChat}>
          <T variant="body" tone="tertiary" style={{ textAlign: 'center' }}>Переписка появится здесь, когда администратор откроет счёт</T>
        </View>
      )}
    </>
  );
}

function Chat({ checkId }: { checkId: string }) {
  const chat = useChat(checkId, true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const typing = useKeyboardHeight() > 0;
  const messages = chat.data ?? [];
  const unread = messages.filter((m) => m.sender === 'staff' && !m.readAt).length;

  // Гость видит сообщения персонала — отмечаем прочитанными (персонал увидит галочки).
  const read = useEffectEvent(() => markChatRead(checkId));
  useEffect(() => {
    if (unread) read();
  }, [unread]);

  const send = async (value: string) => {
    if (sending) return;
    setSending(true);
    const ok = await sendChat(checkId, value);
    setSending(false);
    if (ok && value === text) setText('');
  };

  return (
    <>
      <Glass kind="inset" radius={28} style={styles.thread}>
        {chat.isLoading ? (
          <Loader />
        ) : (
          <FlatList
            data={[...messages].reverse()}
            inverted
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.threadContent}
            renderItem={({ item }) => <Bubble message={item} />}
            ListEmptyComponent={
              <T variant="body" tone="tertiary" style={styles.emptyThread}>Напишите, если что-то нужно — администратор увидит сообщение на кассе</T>
            }
          />
        )}
      </Glass>
      {typing ? null : (
        <View style={styles.quick}>
          {QUICK.map((q) => (
            <Press key={q} onPress={() => void send(q)} disabled={sending} scaleTo={0.95} style={[styles.chip, glassStyle('control', radius.pill)]}>
              <T variant="label" style={{ color: '#E4DCFF', fontSize: 15 }}>{q}</T>
            </Press>
          ))}
        </View>
      )}
      <View style={styles.composer}>
        <View style={[styles.input, glassStyle('control', radius.pill)]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Сообщение"
            placeholderTextColor={color.textTertiary}
            style={styles.inputText}
            maxLength={1000}
            accessibilityLabel="Сообщение администратору"
            onSubmitEditing={() => void send(text)}
            submitBehavior="submit"
            disableFullscreenUI
            returnKeyType="send"
          />
        </View>
        <IconButton icon={Send} label="Отправить" variant="primary" size={60} onPress={() => void send(text)} disabled={!text.trim() || sending} />
      </View>
    </>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.sender === 'guest';
  return (
    <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        {!mine ? <T variant="small" tone="accent" style={{ marginBottom: 2 }}>Администратор</T> : null}
        <T variant="body">{message.text}</T>
        <T variant="small" style={styles.time}>{hhmm(new Date(message.createdAt))}{mine && message.readAt ? ' · прочитано' : ''}</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  call: { height: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  noChat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  thread: { flex: 1, minHeight: 0 },
  threadContent: { padding: 16, gap: 10, flexGrow: 1 },
  emptyThread: { textAlign: 'center', padding: 32, transform: [{ scaleY: -1 }] },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 44, paddingHorizontal: 18, justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, height: 60, paddingHorizontal: 22, justifyContent: 'center' },
  inputText: { fontSize: 17, fontFamily: font.regular, color: color.text, paddingVertical: 0 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { maxWidth: '72%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 22 },
  mine: { backgroundColor: 'rgba(139,92,246,0.55)', borderBottomRightRadius: 8, borderWidth: 1, borderColor: 'rgba(206,190,255,0.35)' },
  theirs: { backgroundColor: 'rgba(255,255,255,0.10)', borderBottomLeftRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  time: { color: 'rgba(236,232,245,0.62)', marginTop: 4, alignSelf: 'flex-end' },
});
