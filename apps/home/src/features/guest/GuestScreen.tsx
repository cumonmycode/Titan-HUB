// Экран гостя — один экран со слоями. Слоями (меню, администратор, оплата,
// «Свет и климат») управляет визит: сменился счёт — всё лишнее закрывается само.
import { useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { BillView, WaitingView } from '@/features/bill/BillView';
import { FinishView } from '@/features/finish/FinishView';
import { MenuLayer } from '@/features/menu/MenuLayer';
import { PayLayer } from '@/features/pay/PayLayer';
import { RoomDock, useDockReserve } from '@/features/room/RoomDock';
import { AdminLayer } from '@/features/service/AdminLayer';
import { useVisit } from '@/features/visit/store';
import { Background } from '@/ui/background';
import { useScreen } from '@/ui/screen';
import { GUTTER } from '@/ui/tokens';

import { ActionBar } from './ActionBar';
import { GuestHeader } from './Header';

export function GuestScreen() {
  const phase = useVisit((s) => s.phase);
  // Меню закрывает экран целиком: то, что под ним, не рисуем — Android не
  // отсекает перекрытые слои, и каждый кадр прокрутки стоил бы двух экранов.
  const covered = useVisit((s) => s.layer === 'menu');
  const { width, height } = useScreen();
  const portrait = width < height;
  // Язычок панели «Свет и климат» на главном экране — счёт под него не заходит.
  const reserve = useDockReserve();

  // «Назад» закрывает верхний слой и не выпускает гостя из киоска.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const v = useVisit.getState();
      if (v.layer) v.close();
      else if (v.roomOpen) v.setRoom(false);
      return true;
    });
    return () => sub.remove();
  }, []);

  const key = phase.kind === 'idle' ? 'idle' : `${phase.kind}:${phase.checkId}`;
  return (
    <View style={styles.screen}>
      <Background />
      <Animated.View key={key} entering={FadeIn.duration(260)} style={[
          styles.content,
          portrait && styles.contentPortrait,
          { paddingBottom: 22 + reserve.bottom, paddingRight: (portrait ? 20 : GUTTER) + reserve.right },
          covered && styles.hidden,
        ]}>
        {phase.kind === 'finish' ? (
          <FinishView />
        ) : (
          <>
            <GuestHeader portrait={portrait} />
            {phase.kind === 'session' ? <BillView portrait={portrait} /> : <WaitingView portrait={portrait} />}
            <ActionBar compact={portrait} />
          </>
        )}
      </Animated.View>
      <MenuLayer />
      <RoomDock />
      <AdminLayer />
      <PayLayer />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, paddingHorizontal: GUTTER, paddingTop: 20, paddingBottom: 22, gap: 16 },
  contentPortrait: { paddingHorizontal: 20 },
  hidden: { display: 'none' },
});
