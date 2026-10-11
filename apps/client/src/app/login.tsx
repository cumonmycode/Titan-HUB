// Вход в My Titan по номеру телефона с подтверждением в Telegram-боте клуба
// (@titanwalletrobot). Входить нужно один раз — дальше приложение само продлевает сессию.
// 1) Номер телефона. Есть в клубе → сразу шаг 3.
// 2) Нет в клубе → анкета: фото, никнейм, имя, день рождения.
// 3) Мини-инструкция и «Подтвердить в Telegram»: бот спрашивает «Да / Нет» и даёт
//    кнопку «Открыть приложение»; экран тем временем опрашивает статус и входит.
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmStep, type ConfirmState } from '@/components/login/confirm-step';
import { PhoneStep } from '@/components/login/phone-step';
import { RegisterStep, type RegistrationDraft } from '@/components/login/register-step';
import { errorText } from '@/lib/api';
import { resetDemo } from '@/lib/demo';
import { inputToBirthday, isFullPhone } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import {
  clearPending, loadPending, loginStatus, openTelegram, type PendingLogin, savePending, startLogin, uploadRegistrationPhoto,
} from '@/lib/login-flow';
import { pickSquarePhoto } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { GUTTER, MAX_WIDTH, space } from '@/lib/theme';
import type { LoginStart } from '@/lib/types';

type Step = 'restoring' | 'phone' | 'register' | 'confirm';

const POLL_MS = 2000;
const EMPTY_DRAFT: RegistrationDraft = { nickname: '', fullName: '', birthday: '', photoUri: null };

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
  const insets = useSafeAreaInsets();
  const signIn = useSession((s) => s.signIn);
  const enterDemo = useSession((s) => s.enterDemo);
  const [step, setStep] = useState<Step>('restoring');
  const [phone, setPhone] = useState('');
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
      if (!saved) { setStep('phone'); return; }
      setPending(saved);
      setPhone(saved.phone);
      setBotOpened(true);
      setStep('confirm');
    });
  }, []);

  async function toConfirm(r: Extract<LoginStart, { status: 'pending' }>) {
    const next: PendingLogin = {
      ticket: r.ticket, deepLink: r.deepLink, botUsername: r.botUsername, mode: r.mode, phone, expiresAt: r.expiresAt,
    };
    await savePending(next);
    setPending(next);
    setConfirmState('waiting');
    setBotOpened(false);
    setNote(null);
    setStep('confirm');
  }

  async function submitPhone() {
    if (!isFullPhone(phone)) { setError('Введите номер полностью'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await startLogin(phone);
      if (r.status === 'register') setStep('register');
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
      const r = await startLogin(phone, {
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
    setError(null);
    setStep(next);
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

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xxl }]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <View style={styles.column}>
        {step === 'phone' ? (
          <PhoneStep
            phone={phone}
            onChangePhone={(p) => { setPhone(p); setError(null); }}
            busy={busy}
            error={error}
            onSubmit={() => void submitPhone()}
            onDemo={() => { resetDemo(); enterDemo(); }}
          />
        ) : step === 'register' ? (
          <RegisterStep
            phone={phone}
            draft={draft}
            onChange={(d) => { setDraft(d); setError(null); }}
            onPickPhoto={() => void pickPhoto()}
            busy={busy}
            error={error}
            onSubmit={() => void submitRegistration()}
            onBack={() => { setError(null); setStep('phone'); }}
          />
        ) : step === 'confirm' && pending ? (
          <ConfirmStep
            pending={pending}
            state={confirmState}
            waiting={botOpened}
            note={note}
            onOpenBot={openBot}
            onRestart={restart}
            onChangePhone={() => leaveConfirm('phone')}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Фон — фирменные пятна стека (backdrop в contentStyle), своего фона у экрана нет.
  screen: { flex: 1 },
  container: { paddingHorizontal: GUTTER, flexGrow: 1 },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
});
