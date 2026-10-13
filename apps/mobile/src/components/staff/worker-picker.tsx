import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { haptic } from '@/lib/haptics';
import { colors, space, type } from '@/lib/theme';

export type Worker = { id: string; nickname: string; photoUrl: string | null };

const TILE = 84;
const AVATAR = 52;

/**
 * Кто работает на смене: плитки с фото, отмечаются касанием (можно несколько).
 * locked — нельзя снять (сотруднику за эту смену уже выдали зарплату).
 */
export function WorkerPicker({ workers, selected, locked = [], onToggle }: { workers: Worker[]; selected: string[]; locked?: string[]; onToggle: (id: string) => void }) {
  if (!workers.length) {
    return <Text style={[type.footnote, styles.empty]}>В команде пока нет сотрудников — добавьте их в «Управление → Сотрудники».</Text>;
  }
  return (
    <View style={styles.grid}>
      {workers.map((w) => {
        const on = selected.includes(w.id);
        const fixed = locked.includes(w.id);
        return (
          <Pressable
            key={w.id}
            onPress={() => {
              if (fixed) return;
              haptic.selection();
              onToggle(w.id);
            }}
            style={({ pressed }) => [styles.tile, pressed && !fixed && styles.pressed]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: fixed }}
            accessibilityLabel={w.nickname}>
            <View style={[styles.ring, on && styles.ringOn]}>
              <Avatar name={w.nickname} photoUrl={w.photoUrl} size={AVATAR} />
              {on ? (
                <View style={styles.badge}>
                  <SymbolView name={fixed ? 'lock.fill' : 'checkmark'} size={11} weight="bold" tintColor="white" />
                </View>
              ) : null}
            </View>
            <Text style={[type.footnote, on ? styles.nameOn : styles.name]} numberOfLines={1}>
              {w.nickname}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { width: TILE, alignItems: 'center', gap: 6, paddingVertical: space.xs },
  pressed: { opacity: 0.6 },
  ring: { padding: 3, borderRadius: (AVATAR + 6) / 2 + 2, borderWidth: 2, borderColor: 'transparent' },
  ringOn: { borderColor: colors.accent },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.sheetBackground,
  },
  name: { color: colors.secondaryLabel, maxWidth: TILE },
  nameOn: { color: colors.label, fontWeight: '600', maxWidth: TILE },
  empty: { color: colors.secondaryLabel },
});
