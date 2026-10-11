import { StyleSheet, View } from 'react-native';

import { TextInput } from '@/components/text';
import { FormField, FormSection } from '@/components/form-parts';
import { GlassCard, GlassChip, sheetStyles } from '@/components/new-check-parts';
import type { StaffMember } from '@/lib/events-api';
import { haptic } from '@/lib/haptics';
import { colors, space, type } from '@/lib/theme';

import { formStyles } from './parts';

/** Ответственный (список сотрудников видит только владелец), число гостей и комментарий. */
export function DetailsSection({
  staff,
  responsibleRequired,
  responsibleId,
  onResponsible,
  guests,
  onGuests,
  comment,
  onComment,
}: {
  staff: StaffMember[];
  responsibleRequired: boolean;
  responsibleId: string | null;
  onResponsible: (id: string | null) => void;
  guests: string;
  onGuests: (value: string) => void;
  comment: string;
  onComment: (value: string) => void;
}) {
  return (
    <>
      {staff.length > 0 && (
        <FormSection title={responsibleRequired ? 'ОТВЕТСТВЕННЫЙ · ОБЯЗАТЕЛЬНО' : 'ОТВЕТСТВЕННЫЙ'}>
          <View style={styles.chips}>
            {staff.map((member) => (
              <GlassChip
                key={member.id}
                label={member.nickname}
                icon="person.fill"
                active={responsibleId === member.id}
                onPress={() => {
                  haptic.selection();
                  onResponsible(responsibleId === member.id ? null : member.id);
                }}
              />
            ))}
          </View>
        </FormSection>
      )}
      <FormSection title="ДЕТАЛИ">
        <GlassCard style={formStyles.card}>
          <FormField icon="person.2" value={guests} onChange={onGuests} placeholder="Гостей — необязательно" keyboardType="number-pad" />
          <View style={sheetStyles.separator} />
          <TextInput
            value={comment}
            onChangeText={onComment}
            placeholder="Комментарий: пожелания, детали брони"
            placeholderTextColor={colors.tertiaryLabel}
            selectionColor={colors.accent}
            accessibilityLabel="Комментарий"
            style={[type.body, styles.multiline]}
            multiline
          />
        </GlassCard>
      </FormSection>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  multiline: { color: colors.label, minHeight: 88, paddingVertical: space.md, textAlignVertical: 'top' },
});
