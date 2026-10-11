import { Button, HStack, RNHostView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, lineLimit } from '@expo/ui/swift-ui/modifiers';

import { primary, secondary } from '@/components/native-form';
import { Avatar } from '@/components/new-check-parts';
import type { Registration } from '@/lib/clients-api';
import { haptic } from '@/lib/haptics';

/** «1995-03-12» → «12.03.1995». */
function birthdayText(value: string | null): string | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** Строка новой регистрации из My Titan: фото, ник, имя и контакты из анкеты. */
export function RegistrationLine({ registration, onPress }: { registration: Registration; onPress: () => void }) {
  const birthday = birthdayText(registration.birthday);
  const contacts = [registration.phone, birthday ? `ДР ${birthday}` : null, registration.tgUsername ? `@${registration.tgUsername}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Button
      onPress={() => {
        haptic.selection();
        onPress();
      }}>
      <HStack spacing={12}>
        <RNHostView matchContents>
          <Avatar name={registration.nickname} photoUrl={registration.photoUrl} size={44} />
        </RNHostView>
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[primary, font({ weight: 'semibold' }), lineLimit(1)]}>{registration.nickname}</Text>
          <Text modifiers={[font({ textStyle: 'subheadline' }), secondary, lineLimit(1)]}>{registration.fullName ?? 'Имя не указано'}</Text>
          {contacts ? <Text modifiers={[font({ textStyle: 'caption' }), secondary, lineLimit(1)]}>{contacts}</Text> : null}
        </VStack>
        <Spacer />
      </HStack>
    </Button>
  );
}
