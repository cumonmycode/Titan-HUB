import { Form, Picker, ProgressView, Section, Text, Toggle } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { EditorToolbar } from '@/components/editor-toolbar';
import { ActionRow, FieldRow, FormHost } from '@/components/native-form';
import { haptic } from '@/lib/haptics';
import {
  FITS,
  MENU_DURATIONS,
  SLIDE_DURATIONS,
  SPEEDS,
  TRANSITIONS,
  createSlide,
  deleteSlide,
  durationLabel,
  pickScreenImages,
  reorderSlides,
  speedLabel,
  updateSlide,
  useScreen,
  withCurrent,
  type Fit,
  type Screen,
  type ScreenSlide,
  type Transition,
} from '@/lib/screens-api';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Элемент экрана. В показе — меню или картинка на весь экран: время, анимация появления
 * и её скорость, у картинки — вписывание. В ленте меню — картинка или карточка с QR.
 */
export default function ScreenSlideEditor() {
  const { screenId, slideId, kind } = useLocalSearchParams<{ screenId: string; slideId?: string; kind?: 'card' }>();
  const query = useScreen(screenId);

  if (!query.data) {
    return (
      <FormHost>
        <ProgressView />
      </FormHost>
    );
  }
  const { screen, show, slides } = query.data;
  const original = slideId ? ([...show, ...slides].find((s) => s.id === slideId) ?? null) : null;
  const list = original?.placement === 'show' ? show : slides;
  return <SlideForm key={original?.id ?? 'new'} screen={screen} original={original} list={list} newKind={kind === 'card' ? 'card' : 'image'} />;
}

function SlideForm({ screen, original, list, newKind }: { screen: Screen; original: ScreenSlide | null; list: ScreenSlide[]; newKind: 'image' | 'card' }) {
  const router = useRouter();
  // Новый элемент отсюда — только карточка ленты; картинки и меню добавляются со страницы экрана.
  const inShow = original?.placement === 'show';
  const kind = original?.kind ?? newKind;
  const [title, setTitle] = useState(original?.title ?? '');
  const [body, setBody] = useState(original?.body ?? '');
  const [link, setLink] = useState(original?.linkUrl ?? '');
  const [imageUrl, setImageUrl] = useState(original?.imageUrl ?? null);
  const [duration, setDuration] = useState(original?.durationSec ?? (kind === 'menu' ? 60 : 10));
  const [transition, setTransition] = useState<Transition>(original?.transition ?? 'fade');
  const [speed, setSpeed] = useState(original?.transitionMs ?? 900);
  const [fit, setFit] = useState<Fit>(original?.fit ?? 'contain');
  const [active, setActive] = useState(original?.isActive ?? true);
  const [busy, setBusy] = useState(false);

  const linkOk = !link.trim() || /^https?:\/\/\S+\.\S+/i.test(link.trim());
  const canSave = kind === 'menu' ? true : kind === 'image' ? !!imageUrl : (title.trim() || body.trim() || link.trim()).length > 0 && linkOk;
  const index = original ? list.findIndex((s) => s.id === original.id) : -1;
  const imageNo = original && kind === 'image' ? list.filter((s) => s.kind === 'image').indexOf(original) + 1 : 0;
  const heading = kind === 'menu' ? 'Меню' : kind === 'image' ? (imageNo ? `Картинка ${imageNo}` : 'Картинка') : original ? 'Карточка' : 'Новая карточка';

  const run = async (action: () => Promise<void>, failure: string, close = true) => {
    haptic.medium();
    setBusy(true);
    try {
      await action();
      haptic.success();
      if (close) router.back();
    } catch (error) {
      haptic.error();
      Alert.alert(failure, errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!canSave) return;
    const fields = {
      imageUrl: kind === 'image' ? imageUrl : null,
      title: kind === 'card' ? title.trim() || null : null,
      body: kind === 'card' ? body.trim() || null : null,
      linkUrl: kind === 'card' ? link.trim() || null : null,
      durationSec: duration,
      transition,
      transitionMs: speed,
      fit,
      isActive: active,
    };
    void run(
      () => (original ? updateSlide(screen.id, original.id, fields) : createSlide(screen.id, { placement: 'band', kind, ...fields })),
      'Не сохранилось',
    );
  };

  const replaceImage = () =>
    void run(
      async () => {
        const [url] = await pickScreenImages(false);
        if (url) setImageUrl(url);
      },
      'Картинка не загрузилась',
      false,
    );

  const move = (dir: -1 | 1) => {
    if (!original || index < 0) return;
    const next = list.slice();
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item!);
    void run(() => reorderSlides(screen.id, next.map((s, i) => ({ id: s.id, sortOrder: i }))), 'Порядок не изменился', false);
  };

  const removeTitle = inShow ? (kind === 'menu' ? 'Убрать меню из показа?' : 'Удалить картинку?') : 'Удалить слайд?';
  const removeNote = kind === 'menu' ? 'Без меню экран будет показывать только картинки.' : 'Она пропадёт с экрана ТВ в течение 20 секунд.';
  const remove = () =>
    original &&
    Alert.alert(removeTitle, removeNote, [
      { text: 'Отмена', style: 'cancel' },
      { text: kind === 'menu' ? 'Убрать' : 'Удалить', style: 'destructive', onPress: () => void run(() => deleteSlide(screen.id, original.id), 'Не удалилось') },
    ]);

  const durations = withCurrent(kind === 'menu' ? MENU_DURATIONS : SLIDE_DURATIONS, duration);
  const speeds = withCurrent(SPEEDS.map((s) => s.ms), speed);
  const pick = <T,>(set: (value: T) => void) => (next: unknown) => {
    haptic.selection();
    set(next as T);
  };

  const animationNote =
    kind === 'menu'
      ? 'Картинка перед меню уходит этой анимацией, меню открывается из-под неё.'
      : 'Картинка входит поверх того, что на экране, — меню или прошлой картинки. «Целиком» — вся картинка на приглушённом фоне, «Во весь экран» — края обрезаются.';
  const orderNote = inShow ? `${index + 1} из ${list.length} в показе.` : `Слайд ${index + 1} из ${list.length}. Перед первым слайдом всегда идёт лента тарифов.`;

  return (
    <>
      <EditorToolbar title={heading} canSave={canSave} busy={busy} onSave={save} />
      <FormHost>
        <Form>
          {kind === 'image' && (
            <Section
              title="Картинка"
              footer={<Text>{inShow ? 'Лучше в пропорциях экрана: вертикальная для вертикального ТВ.' : 'Вписывается в ленту целиком. Лучше широкая, примерно 3:1 (например 1500×500).'}</Text>}>
              <ActionRow title={busy ? 'Загружаем…' : 'Заменить картинку'} icon="photo" disabled={busy} onPress={replaceImage} />
            </Section>
          )}
          {kind === 'card' && (
            <>
              <Section title="Заголовок">
                <FieldRow value={title} placeholder="My Titan — твой клуб в телефоне" autoFocus={!original} maxLength={80} onChange={setTitle} />
              </Section>
              <Section title="Текст">
                <FieldRow value={body} placeholder="Баланс, бонусы и запись на игры" maxLength={240} multiline onChange={setBody} />
              </Section>
              <Section
                title="Ссылка для QR"
                footer={<Text>{linkOk ? 'QR рисуется на экране сам. Без ссылки карточка будет только с текстом.' : 'Нужна ссылка вида https://…'}</Text>}>
                <FieldRow value={link} placeholder="https://…" keyboard="url" maxLength={1000} onChange={setLink} />
              </Section>
            </>
          )}

          <Section title="Показ" footer={inShow ? <Text>{animationNote}</Text> : undefined}>
            <Picker label="Показывать" selection={duration} onSelectionChange={pick<number>((v) => setDuration(Number(v)))} modifiers={[pickerStyle('menu')]}>
              {durations.map((sec) => (
                <Text key={sec} modifiers={[tag(sec)]}>
                  {durationLabel(sec)}
                </Text>
              ))}
            </Picker>
            {inShow && (
              <>
                <Picker label="Появление" selection={transition} onSelectionChange={pick<Transition>(setTransition)} modifiers={[pickerStyle('menu')]}>
                  {TRANSITIONS.map((t) => (
                    <Text key={t.key} modifiers={[tag(t.key)]}>
                      {t.label}
                    </Text>
                  ))}
                </Picker>
                {transition !== 'none' && (
                  <Picker label="Скорость анимации" selection={speed} onSelectionChange={pick<number>((v) => setSpeed(Number(v)))} modifiers={[pickerStyle('menu')]}>
                    {speeds.map((ms) => (
                      <Text key={ms} modifiers={[tag(ms)]}>
                        {speedLabel(ms)}
                      </Text>
                    ))}
                  </Picker>
                )}
                {kind === 'image' && (
                  <Picker label="Картинка" selection={fit} onSelectionChange={pick<Fit>(setFit)} modifiers={[pickerStyle('menu')]}>
                    {FITS.map((f) => (
                      <Text key={f.key} modifiers={[tag(f.key)]}>
                        {f.label}
                      </Text>
                    ))}
                  </Picker>
                )}
              </>
            )}
            <Toggle label="Показывать на экране" isOn={active} onIsOnChange={setActive} />
          </Section>

          {original && list.length > 1 && (
            <Section title="Порядок" footer={<Text>{orderNote}</Text>}>
              <ActionRow title="Показывать раньше" icon="arrow.up" disabled={busy || index <= 0} onPress={() => move(-1)} />
              <ActionRow title="Показывать позже" icon="arrow.down" disabled={busy || index >= list.length - 1} onPress={() => move(1)} />
            </Section>
          )}

          {original && (
            <Section>
              <ActionRow
                title={inShow ? (kind === 'menu' ? 'Убрать меню из показа' : 'Удалить картинку') : 'Удалить слайд'}
                icon="trash"
                destructive
                disabled={busy}
                onPress={remove}
              />
            </Section>
          )}
        </Form>
      </FormHost>
    </>
  );
}
