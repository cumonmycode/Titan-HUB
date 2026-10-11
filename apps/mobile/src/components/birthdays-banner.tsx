import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { create } from 'zustand';

import { Text } from '@/components/text';
import { GlassView } from '@/components/glass';
import { Avatar } from '@/components/new-check-parts';
import { api } from '@/lib/api';
import { todayMsk } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { useClubKey, useShiftSummary } from '@/lib/queries';
import { colors, radius, space, type } from '@/lib/theme';

type BirthdayPerson = { id: string; nickname: string; birthday: string | null; photoUrl: string | null };

/** Скрытие — до конца дня: завтра будут другие именинники. */
const useDismissed = create<{ day: string | null; dismiss: (day: string) => void }>((set) => ({
  day: null,
  dismiss: (day) => set({ day }),
}));

const TINT = 'rgba(255,45,85,0.16)';

/**
 * Именинники дня — как всплывающее окно веб-кассы при открытой смене, только без
 * перекрытия кассы: карточка над чеками, закрывается крестиком до завтра.
 */
export function BirthdaysBanner() {
  const club = useClubKey();
  const summary = useShiftSummary();
  const shiftOpen = !!summary.data?.shift;
  const today = todayMsk();
  const dismissedDay = useDismissed((s) => s.day);

  const birthdays = useQuery({
    queryKey: [club, 'shifts', 'birthdays-today', today],
    queryFn: () => api.get<{ birthdays: BirthdayPerson[] }>('/shifts/birthdays-today').then((r) => r.birthdays),
    enabled: shiftOpen,
    staleTime: 60 * 60_000,
  });

  const people = birthdays.data ?? [];
  if (!shiftOpen || people.length === 0 || dismissedDay === today) return null;

  const names = people.map((p) => p.nickname).join(', ');

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.wrap}>
      <GlassView tintColor={TINT} style={styles.card}>
        <View style={styles.icon}>
          <SymbolView name="birthday.cake" size={20} tintColor={colors.pink} />
        </View>
        <View style={styles.text}>
          <Text style={[type.headline, styles.title]}>
            {people.length === 1 ? 'Сегодня день рождения' : `Сегодня дни рождения · ${people.length}`}
          </Text>
          <Text style={[type.subhead, styles.names]} numberOfLines={2}>
            {names}
          </Text>
        </View>
        <View style={styles.avatars}>
          {people.slice(0, 3).map((p, index) => (
            <View key={p.id} style={[styles.avatar, index > 0 && styles.avatarOverlap]}>
              <Avatar name={p.nickname} photoUrl={p.photoUrl} size={30} />
            </View>
          ))}
        </View>
        <Pressable
          hitSlop={10}
          onPress={() => {
            haptic.selection();
            useDismissed.getState().dismiss(today);
          }}
          accessibilityRole="button"
          accessibilityLabel="Скрыть до завтра">
          <SymbolView name="xmark.circle.fill" size={22} tintColor={colors.tertiaryLabel} />
        </Pressable>
      </GlassView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 6, paddingBottom: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,45,85,0.16)' },
  text: { flex: 1, gap: 2 },
  title: { color: colors.label },
  names: { color: colors.secondaryLabel },
  avatars: { flexDirection: 'row' },
  avatar: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' },
  avatarOverlap: { marginLeft: -10 },
});
