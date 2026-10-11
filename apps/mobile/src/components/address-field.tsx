import { useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Text } from '@/components/text';
import { FormField } from '@/components/form-parts';
import { sheetStyles } from '@/components/new-check-parts';
import { useDebounced } from '@/components/player-picker';
import { api } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useClubKey } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';

type Suggestion = { title: string; subtitle: string; value: string; short?: string; pickValue?: string };

/**
 * Адрес с подсказками Яндекс Геосаджеста — как AddressAutocomplete в вебе. Ключ живёт на
 * сервере (`/geo/suggest`); если интеграция не настроена, это обычное поле без подсказок.
 * После выбора подставляется «улица, дом» (у организации — «название, улица дом»), а
 * регион и город остаются только подписью в списке.
 */
export function AddressField({ value, onChange, placeholder }: { value: string; onChange: (text: string) => void; placeholder: string }) {
  const club = useClubKey();
  // Выбранное значение не ищем повторно: иначе после выбора список тут же открылся бы снова.
  const [picked, setPicked] = useState<string | null>(null);
  const query = useDebounced(value.trim(), 250);
  const active = query.length >= 3 && query !== picked;

  const suggestions = useQuery({
    queryKey: [club, 'geo', 'suggest', query],
    queryFn: ({ signal }) =>
      api
        .get<{ enabled: boolean; suggestions: Suggestion[] }>(`/geo/suggest?text=${encodeURIComponent(query)}`, { signal })
        .then((r) => (r.enabled ? r.suggestions : [])),
    enabled: active,
    staleTime: 5 * 60_000,
  });

  const list = active ? (suggestions.data ?? []) : [];

  return (
    <View>
      <FormField icon="mappin.and.ellipse" value={value} onChange={onChange} placeholder={placeholder} autoCapitalize="sentences" />
      {list.length > 0 && (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)}>
          {list.map((s, index) => (
            <Pressable
              key={`${s.value}-${index}`}
              onPress={() => {
                haptic.selection();
                const next = s.pickValue || s.short || s.title || s.value;
                setPicked(next);
                onChange(next);
              }}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={[s.title, s.subtitle].filter(Boolean).join(', ')}>
              <View style={sheetStyles.separator} />
              <View style={styles.rowInner}>
                <SymbolView name="mappin" size={14} tintColor={colors.tertiaryLabel} />
                <View style={styles.flex}>
                  <Text style={[type.body, styles.title]} numberOfLines={1}>
                    {s.title || s.value}
                  </Text>
                  {s.subtitle ? (
                    <Text style={[type.footnote, styles.subtitle]} numberOfLines={1}>
                      {s.subtitle}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          ))}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {},
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  title: { color: colors.label },
  subtitle: { color: colors.secondaryLabel },
  pressed: { opacity: 0.55 },
});
