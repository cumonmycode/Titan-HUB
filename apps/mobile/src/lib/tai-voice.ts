import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';

import { haptic } from './haptics';

/**
 * Голосовой режим Tai, как разговор с Siri: нажали микрофон — телефон слушает и сразу
 * показывает распознанный текст; пауза ~1,3 с — фраза уходит Tai; ответ озвучивается
 * по фразам, пока ещё печатается; после ответа Tai снова слушает. Распознавание и
 * голос — системные (бесплатно, без задержки на сеть); выход — кнопка «Стоп» или тишина.
 */

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

const SILENCE_AFTER_SPEECH_MS = 1_300;
const SILENCE_BEFORE_SPEECH_MS = 7_000;
const RELISTEN_DELAY_MS = 350;

/** Лучший русский голос устройства: «улучшенный» раньше обычного. */
let voicePromise: Promise<string | undefined> | null = null;
function russianVoice(): Promise<string | undefined> {
  voicePromise ??= Speech.getAvailableVoicesAsync()
    .then((voices) => {
      const ru = voices.filter((v) => v.language?.toLowerCase().startsWith('ru'));
      const best = ru.find((v) => v.quality === Speech.VoiceQuality.Enhanced) ?? ru[0];
      return best?.identifier;
    })
    .catch(() => undefined);
  return voicePromise;
}

const RUBLE_FORMS = ['рубль', 'рубля', 'рублей'] as const;
function rubles(n: number) {
  const a = n % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return RUBLE_FORMS[2];
  if (b === 1) return RUBLE_FORMS[0];
  if (b > 1 && b < 5) return RUBLE_FORMS[1];
  return RUBLE_FORMS[2];
}

/** Текст для озвучки: без разметки, «48 200 ₽» → «48200 рублей». */
export function speakable(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*([-*•]|\d+[.)])\s+/gm, '')
    .replace(/(\d[\d\s ]*)(?:,\d+)?\s*₽/g, (_, digits: string) => {
      const n = Number(digits.replace(/[\s ]/g, ''));
      return Number.isFinite(n) ? `${n} ${rubles(n)}` : digits;
    })
    .replace(/[«»]/g, '')
    .trim();
}

/** Конец законченной фразы в тексте после позиции from; -1 — фраза ещё не дописана. */
function sentenceEnd(text: string, from: number): number {
  const rest = text.slice(from);
  const match = /[.!?…](?=\s|$)|\n/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = match.exec(rest))) last = from + m.index + 1;
  return last;
}

/** onUtterance отправляет фразу Tai; вернёт строку — её озвучим (ответа модели не было). */
export function useTaiVoice(onUtterance: (text: string) => Promise<string | null>) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [level, setLevel] = useState(0);
  const conversation = useRef(false);
  const heard = useRef('');
  const lastHeardAt = useRef(0);
  const spoken = useRef<{ id: string; upTo: number } | null>(null);
  const pending = useRef(0);
  const finished = useRef(false);
  const phaseRef = useRef<VoicePhase>('idle');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const listen = useCallback(async () => {
    Speech.stop();
    pending.current = 0;
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      conversation.current = false;
      setPhase('idle');
      Alert.alert('Нет доступа к микрофону', 'Разрешите микрофон и распознавание речи для Titan HUB в Настройках.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Настройки', onPress: () => void Linking.openSettings() },
      ]);
      return;
    }
    heard.current = '';
    setTranscript('');
    lastHeardAt.current = Date.now();
    conversation.current = true;
    haptic.light();
    ExpoSpeechRecognitionModule.start({
      lang: 'ru-RU',
      interimResults: true,
      // Паузу ловим сами: так одинаково на iOS и Android и без писка Android в конце фразы.
      continuous: true,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      // Ответ потом звучит из динамика, а не из разговорного.
      iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'default' },
    });
    setPhase('listening');
  }, []);

  /** Закончить фразу сейчас (кнопка «Готово») — распознанное уйдёт Tai. */
  const finishListening = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  /** Выйти из голосового режима. */
  const end = useCallback(() => {
    conversation.current = false;
    ExpoSpeechRecognitionModule.abort();
    Speech.stop();
    pending.current = 0;
    setLevel(0);
    setPhase('idle');
  }, []);

  const afterSpeech = useCallback(() => {
    if (pending.current > 0 || !finished.current) return;
    if (conversation.current) setTimeout(() => conversation.current && void listen(), RELISTEN_DELAY_MS);
    else setPhase('idle');
  }, [listen]);

  const speak = useCallback(
    async (text: string) => {
      const clean = speakable(text);
      if (!clean) return;
      pending.current += 1;
      setPhase('speaking');
      const voice = await russianVoice();
      const done = () => {
        pending.current = Math.max(0, pending.current - 1);
        afterSpeech();
      };
      Speech.speak(clean, { language: 'ru-RU', voice, rate: Platform.OS === 'ios' ? 1.05 : 1.0, onDone: done, onStopped: done, onError: done });
    },
    [afterSpeech],
  );

  /**
   * Озвучка ответа по мере печати: законченные фразы — сразу, хвост — когда ответ
   * дописан. Вызывается при каждом изменении текста ответа.
   */
  const feed = useCallback(
    (id: string, text: string, complete: boolean) => {
      if (!conversation.current || phaseRef.current === 'listening') return;
      if (spoken.current?.id !== id) spoken.current = { id, upTo: 0 };
      const state = spoken.current;
      const end = complete ? text.length : sentenceEnd(text, state.upTo);
      if (end > state.upTo) {
        const part = text.slice(state.upTo, end);
        state.upTo = end;
        void speak(part);
      }
      if (complete) {
        finished.current = true;
        afterSpeech();
      }
    },
    [afterSpeech, speak],
  );

  /** Короткая реплика (итог карточки после голосового «да»). */
  const say = useCallback(
    (text: string) => {
      finished.current = true;
      if (conversation.current) void speak(text);
      else setPhase('idle');
    },
    [speak],
  );

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    if (text !== heard.current) lastHeardAt.current = Date.now();
    heard.current = text;
    setTranscript(text);
  });
  useSpeechRecognitionEvent('volumechange', (event) => setLevel(Math.max(0, Math.min(1, (event.value + 2) / 12))));
  useSpeechRecognitionEvent('error', (event) => {
    // «Не услышал» — обычный конец; остальное покажем, но режим не роняем молча.
    if (event.error === 'no-speech' || event.error === 'aborted') return;
    if (event.error === 'not-allowed') Alert.alert('Нет доступа к микрофону', 'Разрешите микрофон и распознавание речи в Настройках.');
  });
  useSpeechRecognitionEvent('end', () => {
    setLevel(0);
    const said = heard.current.trim();
    heard.current = '';
    if (!conversation.current) return;
    if (!said) {
      // Тишина — разговор окончен.
      conversation.current = false;
      setPhase('idle');
      return;
    }
    haptic.selection();
    setPhase('thinking');
    finished.current = false;
    void onUtterance(said).then((reply) => {
      if (reply) say(reply);
    });
  });

  // Пауза после речи — конец фразы; долгая тишина без слов — выход.
  useEffect(() => {
    if (phase !== 'listening') return;
    const timer = setInterval(() => {
      const quiet = Date.now() - lastHeardAt.current;
      if (heard.current ? quiet > SILENCE_AFTER_SPEECH_MS : quiet > SILENCE_BEFORE_SPEECH_MS) ExpoSpeechRecognitionModule.stop();
    }, 200);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      conversation.current = false;
      ExpoSpeechRecognitionModule.abort();
      Speech.stop();
    },
    [],
  );

  return { phase, transcript, level, active: phase !== 'idle', listen, finishListening, end, feed, say };
}
