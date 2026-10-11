// Выбор вида карты клуба: три живых превью с текущими бонусами, отмеченный — выбран.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClubCard } from '@/components/club-card';
import { Icon } from '@/components/icon';
import { SheetHeader, useCloseSheet } from '@/components/sheet';
import { Tap } from '@/components/tap';
import { CARD_STYLES, useCardStyle } from '@/lib/card-style';
import { haptic } from '@/lib/haptics';
import { useWallet } from '@/lib/queries';
import { colors, GUTTER, MAX_WIDTH, space, type } from '@/lib/theme';

export default function CardStyleScreen() {
  const insets = useSafeAreaInsets();
  const close = useCloseSheet('/profile');
  const { data: w } = useWallet();
  const current = useCardStyle((s) => s.style);
  const setStyle = useCardStyle((s) => s.setStyle);

  const data = {
    nickname: w?.profile.nickname ?? 'titan',
    tierLabel: w?.tier.label ?? 'Резидент',
    tierColor: w?.tier.color ?? colors.violet,
    bonus: w?.bonus ?? 1240,
    bonusHidden: w?.bonusHidden ?? false,
    deposit: w?.deposit ?? 0,
    visits: w?.visitProgress.visits ?? 0,
  };

  return (
    <View style={styles.root}>
      <SheetHeader title="Вид карты" onClose={close} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
        <View style={styles.column}>
          {CARD_STYLES.map((option) => {
            const selected = option.key === current;
            return (
              <Tap
                key={option.key}
                scaleTo={0.98}
                onPress={() => { haptic.select(); setStyle(option.key); }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.title}. ${option.text}`}
                style={styles.option}
              >
                <ClubCard data={data} variant={option.key} motion={selected} />
                <View style={styles.caption}>
                  <View style={styles.flex}>
                    <Text style={type.headline}>{option.title}</Text>
                    <Text style={type.caption}>{option.text}</Text>
                  </View>
                  <View style={[styles.check, selected && styles.checkOn]}>
                    {selected ? <Icon name="check" size={14} color="#fff" weight="bold" /> : null}
                  </View>
                </View>
              </Tap>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER },
  column: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', gap: space.xxl },
  option: { gap: space.md },
  caption: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xs },
  check: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.borderStrong,
  },
  checkOn: { backgroundColor: colors.violet, borderColor: colors.violet },
});
