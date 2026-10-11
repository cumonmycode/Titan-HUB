import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { FormField, FormSection } from '@/components/form-parts';
import { GlassCard, sheetStyles } from '@/components/new-check-parts';
import { useCustomers } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { cleanPhone, pickContact } from '@/lib/phone-book';
import { colors, space, type } from '@/lib/theme';

import { formStyles } from './parts';

/**
 * Заказчик: имя и телефон в одной карточке. Значок справа от имени берёт карточку из
 * контактов телефона, подсказки из справочника заказчиков — строками под полями.
 */
export function CustomerSection({
  name,
  phone,
  required,
  onName,
  onPhone,
}: {
  name: string;
  phone: string;
  required: boolean;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
}) {
  // Выбранного из подсказок не ищем повторно — иначе список тут же открылся бы снова.
  // Заказчик, уже записанный в мероприятии, — тоже выбранный: подсказки появятся, когда имя начнут менять.
  const [picked, setPicked] = useState(() => name.trim().length > 0);
  const customers = useCustomers(picked ? '' : name);
  const typed = name.trim().toLowerCase();
  const suggestions = picked ? [] : (customers.data ?? []).filter((c) => c.name && c.name.toLowerCase() !== typed).slice(0, 3);

  const typeName = (value: string) => {
    onName(value);
    setPicked(false);
  };

  /** Системный выбор контакта — без доступа ко всей адресной книге. */
  const fromContacts = () => {
    haptic.light();
    void pickContact().then((contact) => {
      if (!contact) return;
      if (contact.name) {
        onName(contact.name);
        setPicked(true);
      }
      if (contact.phone) onPhone(cleanPhone(contact.phone));
      haptic.success();
    });
  };

  return (
    <FormSection title={required ? 'ЗАКАЗЧИК' : 'ЗАКАЗЧИК · НЕОБЯЗАТЕЛЬНО'}>
      <GlassCard style={formStyles.card}>
        <View style={styles.nameRow}>
          <View style={formStyles.flex}>
            <FormField icon="person" value={name} onChange={typeName} placeholder="Имя заказчика" autoCapitalize="words" />
          </View>
          <Pressable onPress={fromContacts} hitSlop={8} style={styles.contacts} accessibilityRole="button" accessibilityLabel="Взять из контактов">
            <SymbolView name="person.crop.circle.badge.plus" size={22} tintColor={colors.accent} />
          </Pressable>
        </View>
        <View style={sheetStyles.separator} />
        <FormField icon="phone" value={phone} onChange={onPhone} placeholder="Телефон" keyboardType="phone-pad" />
        {suggestions.map((c) => (
          <Pressable
            key={c.id}
            onPress={() => {
              haptic.selection();
              onName(c.name ?? '');
              if (c.phone) onPhone(c.phone);
              setPicked(true);
            }}
            style={({ pressed }) => pressed && sheetStyles.pressedRow}
            accessibilityRole="button"
            accessibilityLabel={[c.name, c.phone].filter(Boolean).join(', ')}>
            <View style={sheetStyles.separator} />
            <View style={styles.suggestion}>
              <SymbolView name="person.crop.circle" size={18} tintColor={colors.tertiaryLabel} />
              <Text style={[type.body, sheetStyles.label, formStyles.flex]} numberOfLines={1}>
                {c.name}
              </Text>
              {c.phone ? <Text style={[type.footnote, sheetStyles.secondary]}>{c.phone}</Text> : null}
            </View>
          </Pressable>
        ))}
      </GlassCard>
    </FormSection>
  );
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  contacts: { minWidth: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44 },
});
