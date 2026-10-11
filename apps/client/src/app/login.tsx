// Вход в My Titan по номеру телефона с подтверждением в Telegram-боте клуба
// (@titanwalletrobot). Как в Telegram: знакомство → разрешения (уведомления и камера,
// только если ещё не спрашивали) → номер → (анкета нового клиента) → подтверждение
// в боте. Входить нужно один раз — дальше приложение само продлевает сессию.
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ConfirmStep, type ConfirmState } from '@/components/login/confirm-step';
import { CAMERA_PERMISSION, IntroStep, NOTIFICATIONS_PERMISSION, PermissionStep } from '@/components/login/onboarding-steps';
import { PhoneStep } from '@/components/login/phone-step';
import { RegisterStep, type RegistrationDraft } from '@/components/login/register-step';
import { errorText } from '@/lib/api';
import { resetDemo } from '@/lib/demo';
import { displayPhone, inputToBirthday, isFullNationalPhone } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  clearPending, loadPending, loginStatus, openTelegram, type PendingLogin, savePending, startLogin, uploadRegistrationPhoto,
} from '@/lib/login-flow';
import { pickSquarePhoto } from '@/lib/photo';
import { pushPermission, registerForPush } from '@/lib/push';
import { useSession } from '@/lib/session';
import type { LoginStart } from '@/lib/types';

type Step = 'restoring' | 'intro' | 'notifications' | 'camera' | 'phone' | 'register' | 'confirm';

const POLL_MS = 2000;
const EMPTY_DRAFT: RegistrationDraft = { nickname: '', fullName: '', birthday: '', photoUri: null };

/** Камеру ещё не спрашивали (системный запрос показывается один раз). */
async function cameraUndetermined(): Promise<boolean> {
  const p = await ImagePicker.getCameraPermissionsAsync().catch(() => null);
  return !!p && !p.granted && p.canAskAgain && p.status === ImagePicker.PermissionStatus.UNDETERMINED;
}

/** Следующий экран: разрешения, которые ещё не спрашивали, затем номер телефона. */
async function nextAfter(step: 'intro' | 'notifications'): Promise<Step> {
  if (step === 'intro' && (await pushPermission().catch(() => 'denied')) === 'undetermined') return 'notifications';
  if (await cameraUndetermined()) return 'camera';
  return 'phone';
}

/** Проверка анкеты до отправки; null — всё заполнено. */
function draftError(draft: RegistrationDraft): string | null {
  if (!draft.photoUri) return 'Добавьте фото';
  if (draft.nickname.trim().length < 2) return 'Придумайте никнейм — от 2 символов';
  if (draft.fullName.trim().length < 2) return 'Введите имя';
  const birthday = inputToBirthday(draft.birthday);
  if (!birthday || birthday === 'invalid') return 'День рождения — в формате ДД.ММ.ГГГГ';
  return null;
}

export default function LoginScreen() {
  const signIn = useSession((s) => s.signIn);
  const enterDemo = useSession((s) => s.enterDemo);
  const [step, setStep] = useState<Step>('restoring');
  const [digits, setDigits] = useState('');
  const [draft, setDraft] = useState<RegistrationDraft>(EMPTY_DRAFT);
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>('waiting');
  const [botOpened, setBotOpened] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef(false);

  // Вход не закончен (система выгрузила приложение, пока клиент был в Telegram) — продолжаем.
  useEffect(() => {
    void loadPending().then((saved) => {
      if (!saved) { setStep('intro'); return; }
      setPending(saved);
      setDigits(saved.phone.replace(/\D/g, '').slice(-10));
      setBotOpened(true);
      setStep('confirm');
    });
  }, []);

  const go = (next: Step) => { setError(null); setStep(next); };

  async function allowNotifications() {
    setBusy(true);
    await registerForPush(true).catch(() => null);
    setBusy(false);
    go(await nextAfter('notifications'));
  }

  async function allowCamera() {
    setBusy(true);
    await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
    setBusy(false);
    go('phone');
  }

  async function toConfirm(r: Extract<LoginStart, { status: 'pending' }>) {
    const next: PendingLogin = {
      ticket: r.ticket, deepLink: r.deepLink, botUsername: r.botUsername, mode: r.mode, phone: displayPhone(digits), expiresAt: r.expiresAt,
    };
    await savePending(next);
    setPending(next);
    setConfirmState('waiting');
    setBotOpened(false);
    setNote(null);
    go('confirm');
  }

  async function submitPhone() {
    if (!isFullNationalPhone(digits)) { setError('Введите номер полностью'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await startLogin(`+7${digits}`);
      if (r.status === 'register') go('register');
      else await toConfirm(r);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitRegistration() {
    const invalid = draftError(draft);
    if (invalid) { haptic.warning(); setError(invalid); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await startLogin(`+7${digits}`, {
        nickname: draft.nickname.trim(),
        fullName: draft.fullName.trim(),
        birthday: inputToBirthday(draft.birthday) as string,
      });
      if (r.status === 'register') throw new Error('Не удалось начать регистрацию. Попробуйте ещё раз.');
      // Номер могли успеть добавить в клуб — тогда это обычный вход, анкета не нужна.
      if (r.mode === 'register' && draft.photoUri) await uploadRegistrationPhoto(r.ticket, draft.photoUri);
      await toConfirm(r);
    } catch (e) {
      haptic.error();
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto() {
    const asset = await pickSquarePhoto();
    if (asset) setDraft((d) => ({ ...d, photoUri: asset.uri }));
  }

  function openBot() {
    if (!pending) return;
    setBotOpened(true);
    void openTelegram(pending.deepLink);
  }

  function leaveConfirm(next: 'phone' | 'register') {
    void clearPending();
    setPending(null);
    go(next);
  }

  // После отказа (например, «никнейм занят») — обратно к анкете, если она заполнялась.
  const restart = () => leaveConfirm(pending?.mode === 'register' && draft.nickname ? 'register' : 'phone');

  const poll = useEffectEvent(async () => {
    if (step !== 'confirm' || confirmState !== 'waiting' || !pending || polling.current) return;
    polling.current = true;
    try {
      const r = await loginStatus(pending.ticket);
      if (r.status === 'ok') {
        haptic.success();
        await clearPending();
        await signIn(r.token);
      } else if (r.status === 'rejected') {
        haptic.warning();
        await clearPending();
        setNote(r.note);
        setConfirmState('rejected');
      } else if (r.status === 'expired') {
        await clearPending();
        setConfirmState('expired');
      } else if (r.opened) {
        setBotOpened(true);
      }
    } catch { /* сеть моргнула — повторим на следующем тике */ } finally {
      polling.current = false;
    }
  });

  useEffect(() => {
    if (step !== 'confirm' || confirmState !== 'waiting') return;
    const timer = setInterval(() => void poll(), POLL_MS);
    // Вернулись из Telegram (кнопкой «Открыть приложение» или вручную) — проверяем сразу.
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void poll(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [step, confirmState]);

  let content = null;
  if (step === 'intro') {
    content = <IntroStep onStart={() => void nextAfter('intro').then(go)} onDemo={() => { resetDemo(); enterDemo(); }} />;
  } else if (step === 'notifications') {
    content = (
      <PermissionStep info={NOTIFICATIONS_PERMISSION} busy={busy} onAllow={() => void allowNotifications()}
        onSkip={() => void nextAfter('notifications').then(go)} onBack={() => go('intro')} />
    );
  } else if (step === 'camera') {
    content = <PermissionStep info={CAMERA_PERMISSION} busy={busy} onAllow={() => void allowCamera()} onSkip={() => go('phone')} onBack={() => go('intro')} />;
  } else if (step === 'phone') {
    content = (
      <PhoneStep digits={digits} onChangeDigits={(d) => { setDigits(d); setError(null); }} busy={busy} error={error}
        onSubmit={() => void submitPhone()} onBack={() => go('intro')} />
    );
  } else if (step === 'register') {
    content = (
      <RegisterStep draft={draft} onChange={(d) => { setDraft(d); setError(null); }} onPickPhoto={() => void pickPhoto()}
        busy={busy} error={error} onSubmit={() => void submitRegistration()} onBack={() => go('phone')} />
    );
  } else if (step === 'confirm' && pending) {
    content = (
      <ConfirmStep pending={pending} state={confirmState} waiting={botOpened} note={note}
        onOpenBot={openBot} onRestart={restart} onChangePhone={() => leaveConfirm('phone')} />
    );
  }

  // Фон — фирменные пятна стека (backdrop в contentStyle), своего фона у экрана нет.
  return (
    <Animated.View key={step} entering={FadeIn.duration(220)} style={styles.screen}>
      {content}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
