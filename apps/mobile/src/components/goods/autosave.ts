import { useEffect, useEffectEvent, useRef, useState } from 'react';

const DELAY_MS = 1200;

/**
 * Черновик документа сохраняется сам: через секунду после последней правки. Уйти из
 * редактора можно в любой момент — ничего не теряется, и не нужен диалог «Сохранить?».
 *
 * `key` — отпечаток содержимого: сменился — пора сохранять. `flush` дожидается начатого
 * сохранения и отменяет отложенное: перед проведением документа, чтобы не родился
 * лишний черновик. Возвращает время последнего удачного сохранения.
 *
 * Сохранения идут строго по очереди: следующее ждёт предыдущее, иначе два запроса, ещё
 * не знающие id черновика, создали бы два черновика. Правка, не дождавшаяся таймера,
 * сохраняется и при уходе из редактора.
 */
export function useAutosave(key: string, enabled: boolean, save: () => Promise<void>) {
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Есть правка, которая ждёт таймера и ещё не ушла на сервер.
  const pending = useRef(false);
  // Свежий save — для сохранения при уходе из редактора.
  const saveRef = useRef(save);
  // Открытый черновик не пересохраняем, пока его не тронули.
  const initialKey = useRef(key);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    saveRef.current = save;
  });

  const run = useEffectEvent(() => {
    timer.current = null;
    pending.current = false;
    const job = (inflight.current ?? Promise.resolve())
      .then(() => save())
      .then(() => setSavedAt(new Date()))
      .catch(() => {
        // Сеть пропала — сохраним при следующей правке; проведение покажет ошибку само.
      });
    inflight.current = job;
  });

  useEffect(() => {
    if (!enabled || key === initialKey.current) {
      // Сохранять нечего или нельзя (документ проводят, удаляют) — уход из редактора не сохраняет.
      pending.current = false;
      return;
    }
    pending.current = true;
    timer.current = setTimeout(run, DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [key, enabled]);

  // Ушли из редактора раньше таймера — последняя правка всё равно уходит на сервер.
  useEffect(
    () => () => {
      if (!pending.current) return;
      pending.current = false;
      const latest = saveRef.current;
      inflight.current = (inflight.current ?? Promise.resolve())
        .then(() => latest())
        .catch(() => {
          // Сеть пропала — на сервере останется предыдущая версия черновика.
        });
    },
    [],
  );

  const flush = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = false;
    if (inflight.current) await inflight.current;
  };

  return { savedAt, flush };
}
