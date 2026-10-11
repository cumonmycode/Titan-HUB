import { SymbolView } from 'expo-symbols';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import type { SFSymbol } from 'sf-symbols-typescript';

import { InfoRow } from '@/components/events/info-row';
import { GlassView } from '@/components/glass';
import { GlassCard } from '@/components/new-check-parts';
import { Text } from '@/components/text';
import { normalizePhone } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { FONT_SCALE_MAX } from '@/lib/text-scale';
import { colors, space, type } from '@/lib/theme';

/** Заказчик: имя и телефон, связь в один тап — звонок, WhatsApp, Telegram. */
export function CustomerCard({ name, phone }: { name: string | null; phone: string | null }) {
  const number = phone ? normalizePhone(phone) : null;
  return (
    <GlassCard style={styles.card}>
      <InfoRow icon="person.crop.circle" label="Заказчик" value={[name, phone].filter(Boolean).join(' · ')} />
      {number && (
        <View style={styles.actions}>
          <ContactButton icon="phone.fill" label="Позвонить" onPress={() => void Linking.openURL(`tel:+${number}`)} />
          <ContactButton icon="message.fill" label="WhatsApp" onPress={() => void Linking.openURL(`https://wa.me/${number}`)} />
          <ContactButton icon="paperplane.fill" label="Telegram" onPress={() => void Linking.openURL(`tg://resolve?phone=${number}`)} />
        </View>
      )}
    </GlassCard>
  );
}

function ContactButton({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Pressable
      style={styles.flex}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={label}>
      <GlassView isInteractive style={styles.contact}>
        <SymbolView name={icon} size={17} tintColor={colors.accent} />
        <Text
          style={[type.caption1, styles.contactText]}
          maxFontSizeMultiplier={FONT_SCALE_MAX.compact}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}>
          {label}
        </Text>
      </GlassView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: space.lg, gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm },
  contact: { alignItems: 'center', gap: 6, minHeight: 64, paddingVertical: space.md, paddingHorizontal: space.xs, borderRadius: 18, borderCurve: 'continuous' },
  contactText: { color: colors.label, fontWeight: '600' },
});
