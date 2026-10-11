// Счёт оплачен или закрыт: «спасибо» и оценка вечера (звёзды → быстрые теги →
// комментарий). Без касаний минуту — сами возвращаемся к ожиданию следующего гостя.
import { Check, Heart, Send, Star } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { sendFeedback } from '@/data/actions';
import { StaffLogo } from '@/features/guest/Header';
import { useVisit } from '@/features/visit/store';
import { idleFor } from '@/lib/activity';
import { money } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { Button } from '@/ui/button';
import { Glass, glassStyle } from '@/ui/glass';
import { Icon } from '@/ui/icon';
import { useKeyboardHeight } from '@/ui/keyboard';
import { Press } from '@/ui/press';
import { T } from '@/ui/text';
import { color, font, radius } from '@/ui/tokens';

const GOOD_TAGS = ['Вкусно', 'Уютно', 'Быстро обслужили', 'Отличная игра', 'Приятная атмосфера', 'Вернёмся ещё'];
const BAD_TAGS = ['Долго ждали', 'Невкусно', 'Шумно', 'Душно или холодно', 'Не убрано', 'Дорого'];
const RATING_TEXT = ['Коснитесь звезды', 'Очень плохо', 'Плохо', 'Нормально', 'Хорошо', 'Отлично!'];

const IDLE_MS = 60_000;
const THANKS_MS = 3500;

const done = () => useVisit.getState().dispatch({ type: 'done' });

export function FinishView() {
  const phase = useVisit((s) => s.phase);
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const keyboard = useKeyboardHeight();
  const scroll = useRef<ScrollView>(null);

  useEffect(() => {
    if (keyboard > 0) scroll.current?.scrollToEnd({ animated: true });
  }, [keyboard]);

  // Гость ушёл, не оценив, — через минуту без касаний экран вернётся к ожиданию.
  useEffect(() => {
    const t = setInterval(() => {
      if (idleFor() > IDLE_MS) done();
    }, 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(done, THANKS_MS);
    return () => clearTimeout(t);
  }, [sent]);

  if (phase.kind !== 'finish') return null;

  const choose = (value: number) => {
    haptic.select();
    // Переход «хорошо ↔ плохо» меняет набор тегов — выбранные из другого набора убираем.
    if ((value >= 4) !== (rating >= 4)) setTags([]);
    setRating(value);
  };

  const send = async () => {
    setSending(true);
    await sendFeedback(phase.checkId, rating, tags, comment);
    haptic.success();
    setSending(false);
    setSent(true);
  };

  if (sent) {
    return (
      <Animated.View entering={FadeIn.duration(220)} style={styles.center}>
        <View style={[styles.badge, { backgroundColor: 'rgba(236,72,153,0.12)', borderColor: 'rgba(236,72,153,0.35)' }]}>
          <Icon as={Heart} size={60} tone="#F472B6" stroke={2} />
        </View>
        <T variant="title" style={styles.hero}>Спасибо за оценку!</T>
        <T variant="body" tone="secondary">Ждём вас снова</T>
      </Animated.View>
    );
  }

  return (
    <View style={{ flex: 1, paddingBottom: keyboard }}>
      <View style={styles.top}>
        <StaffLogo />
      </View>
      <ScrollView ref={scroll} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.badge, { backgroundColor: color.greenTint, borderColor: 'rgba(52,211,153,0.5)' }]}>
          <Icon as={Check} size={56} tone={color.green} stroke={2.4} />
        </View>
        <T variant="title" style={styles.hero}>{phase.paid ? 'Оплата прошла!' : 'Счёт закрыт'}</T>
        <T variant="body" tone="secondary" numeric style={{ fontSize: 18 }}>
          {phase.total != null && phase.total > 0 ? `${money(phase.total)} · ` : ''}Спасибо, что были у нас
        </T>

        <Glass kind="panel" radius={radius.panel} style={styles.card}>
          <T variant="heading" style={{ textAlign: 'center' }}>Как вам вечер?</T>
          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((v) => (
              <Press key={v} onPress={() => choose(v)} haptics={false} scaleTo={0.85} accessibilityLabel={`${v} из 5`} hitSlop={6}>
                <Star size={64} color={v <= rating ? color.amber : color.textTertiary} fill={v <= rating ? color.amber : 'transparent'} strokeWidth={1.6} />
              </Press>
            ))}
          </View>
          <T variant="label" tone="secondary" style={{ textAlign: 'center' }}>{RATING_TEXT[rating]}</T>

          {rating > 0 ? (
            <View style={{ gap: 16, marginTop: 8 }}>
              <View style={styles.tags}>
                {(rating >= 4 ? GOOD_TAGS : BAD_TAGS).map((tag) => {
                  const on = tags.includes(tag);
                  return (
                    <Press
                      key={tag}
                      onPress={() => setTags((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]))}
                      haptics={false}
                      scaleTo={0.95}
                      accessibilityState={{ selected: on }}
                      style={[styles.tag, glassStyle(on ? 'accent' : 'control', radius.pill)]}
                    >
                      <T variant="label" style={{ fontSize: 15, color: on ? color.onAccent : color.textSecondary }}>{tag}</T>
                    </Press>
                  );
                })}
              </View>
              <View style={[styles.comment, glassStyle('inset', 22)]}>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder={rating >= 4 ? 'Что понравилось больше всего? (необязательно)' : 'Что нам исправить? (необязательно)'}
                  placeholderTextColor={color.textTertiary}
                  multiline
                  maxLength={1000}
                  disableFullscreenUI
                  style={styles.commentText}
                />
              </View>
              <Button title="Отправить оценку" icon={Send} variant="primary" size="lg" onPress={() => void send()} loading={sending} />
            </View>
          ) : null}
        </Glass>

        <Button title="Пропустить" variant="quiet" onPress={done} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { height: 56, justifyContent: 'center' },
  scroll: { alignItems: 'center', paddingBottom: 24, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  badge: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  hero: { fontSize: 40, lineHeight: 46, textAlign: 'center' },
  card: { width: '100%', maxWidth: 700, marginTop: 12, padding: 24, gap: 8 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 8 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  tag: { height: 46, paddingHorizontal: 18, justifyContent: 'center' },
  comment: { minHeight: 84, maxHeight: 140, padding: 16 },
  commentText: { fontSize: 16, fontFamily: font.regular, color: color.text, textAlignVertical: 'top', padding: 0 },
});
