import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';

import { haptic } from './haptics';
import { speakTai } from './tai-api';
import { revealTai, setTaiAudioListener, ungateTai, type TaiAudioClip } from './tai-store';

/**
 * Голосовой режим Tai, как разговор с Siri: нажали микрофон — телефон слушает и сразу
 * показывает распознанный текст; пауза ~1,3 с — фраза уходит Tai. Отвечает Tai
 * нейросетевым голосом: сервер озвучивает ответ по фразам, пока тот ещё пишется, и
 * присылает звук в том же потоке (системный голос телефона звучал роботом). После
 * ответа Tai снова слушает; выход — кнопка «Стоп» или тишина.
 */

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

const SILENCE_AFTER_SPEECH_MS = 1_300;
const SILENCE_BEFORE_SPEECH_MS = 7_000;
const RELISTEN_DELAY_MS = 350;

type Clip = { file: File; reveal?: { replyId: string; upTo: number; blocks: number } };

/** onUtterance отправляет фразу Tai; вернёт строку — её озвучим (ответа модели не было). */
export function useTaiVoice(onUtterance: (text: string) => Promise<string | null>) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [transcript, setTranscript] = useState('');
  const [level, setLevel] = useState(0);
  const conversation = useRef(false);
  const heard = useRef('');
  const lastHeardAt = useRef(0);
  const queue = useRef<Clip[]>([]);
  const playing = useRef<AudioPlayer | null>(null);
  const replyFinished = useRef(false);
  const clipCounter = useRef(0);
  // Следующий фрагмент по окончании текущего (слушатель плеера живёт дольше рендера).
  const playNextRef = useRef<() => void>(() => undefined);

  const stopPlayback = useCallback(() => {
    playing.current?.pause();
    playing.current?.remove();
    playing.current = null;
    for (const clip of queue.current) clip.file.delete();
    queue.current = [];
  }, []);

  const listen = useCallback(async () => {
    stopPlayback();
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
    replyFinished.current = false;
    haptic.light();
    ExpoSpeechRecognitionModule.start({
      lang: 'ru-RU',
      interimResults: true,
      // Паузу ловим сами: так одинаково на iOS и Android и без писка Android в конце фразы.
      continuous: true,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
      iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'default' },
    });
    setPhase('listening');
  }, [stopPlayback]);

  /** Всё сказано и ответ дописан — снова слушаем (или выходим, если разговор окончен). */
  const afterSpeech = useCallback(() => {
    if (playing.current || queue.current.length || !replyFinished.current) return;
    ungateTai();
    if (conversation.current) setTimeout(() => conversation.current && void listen(), RELISTEN_DELAY_MS);
    else setPhase('idle');
  }, [listen]);

  const playNext = useCallback(async () => {
    if (playing.current) return;
    const clip = queue.current.shift();
    if (!clip) {
      if (!replyFinished.current && conversation.current) setPhase('thinking');
      afterSpeech();
      return;
    }
    // Ответ — в динамик, громко, даже в беззвучном режиме: Tai заговорил по просьбе.
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      allowsRecording: false,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
    const player = createAudioPlayer({ uri: clip.file.uri });
    playing.current = player;
    setPhase('speaking');
    // Субтитры: текст этой фразы и блоки перед ней появляются вместе со звуком.
    if (clip.reveal) revealTai(clip.reveal.replyId, clip.reveal.upTo, clip.reveal.blocks);
    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (!status.didJustFinish) return;
      subscription.remove();
      player.remove();
      clip.file.delete();
      if (playing.current === player) playing.current = null;
      playNextRef.current();
    });
    player.play();
  }, [afterSpeech]);

  useEffect(() => {
    playNextRef.current = () => void playNext();
  }, [playNext]);

  const enqueue = useCallback(
    (format: 'mp3' | 'wav', data: string, reveal?: Clip['reveal']) => {
      if (!conversation.current) return;
      try {
        const file = new File(Paths.cache, `tai-voice-${Date.now()}-${(clipCounter.current += 1)}.${format}`);
        file.write(data, { encoding: 'base64' });
        queue.current.push({ file, reveal });
        void playNext();
      } catch {
        // Не записали звук — фраза уже на экране, разговор продолжается.
      }
    },
    [playNext],
  );

  // Звук ответа приходит из потока Tai (стор диалога).
  useEffect(() => {
    setTaiAudioListener((clip: TaiAudioClip) => enqueue(clip.format, clip.data, { replyId: clip.replyId, upTo: clip.upTo, blocks: clip.blocks }));
    return () => setTaiAudioListener(null);
  }, [enqueue]);

  /** Ответ модели дописан — когда звук доиграет, снова слушаем. */
  const replyDone = useCallback(() => {
    replyFinished.current = true;
    afterSpeech();
  }, [afterSpeech]);

  /** Короткая реплика голосом Tai (итог карточки после голосового «да»). */
  const say = useCallback(
    async (text: string) => {
      replyFinished.current = false;
      if (conversation.current) {
        const audio = await speakTai(text);
        if (audio) enqueue(audio.format, audio.data);
      }
      replyDone();
    },
    [enqueue, replyDone],
  );

  /** Закончить фразу сейчас (кнопка «Готово») — распознанное уйдёт Tai. */
  const finishListening = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  /** Выйти из голосового режима. */
  const end = useCallback(() => {
    conversation.current = false;
    ExpoSpeechRecognitionModule.abort();
    stopPlayback();
    ungateTai();
    setLevel(0);
    setPhase('idle');
  }, [stopPlayback]);

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
    replyFinished.current = false;
    void onUtterance(said).then((reply) => (reply ? say(reply) : replyDone()));
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
      stopPlayback();
    },
    [stopPlayback],
  );

  return { phase, transcript, level, active: phase !== 'idle', listen, finishListening, end };
}

/** Пример голоса в настройках: одна фраза, без голосового режима. */
let samplePlayer: AudioPlayer | null = null;
export async function playTaiSample(audio: { format: 'mp3' | 'wav'; data: string }): Promise<void> {
  samplePlayer?.pause();
  samplePlayer?.remove();
  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    allowsRecording: false,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  }).catch(() => undefined);
  const file = new File(Paths.cache, `tai-sample-${Date.now()}.${audio.format}`);
  file.write(audio.data, { encoding: 'base64' });
  const player = createAudioPlayer({ uri: file.uri });
  samplePlayer = player;
  const subscription = player.addListener('playbackStatusUpdate', (status) => {
    if (!status.didJustFinish) return;
    subscription.remove();
    player.remove();
    file.delete();
    if (samplePlayer === player) samplePlayer = null;
  });
  player.play();
}
