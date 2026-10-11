import { ContentUnavailableView, Form, Host, ProgressView, Section } from '@expo/ui/swift-ui';
import { refreshable } from '@expo/ui/swift-ui/modifiers';
import { useLocalSearchParams } from 'expo-router';

import { RevisionView, SupplyView, WriteOffView } from '@/components/goods/doc-views';
import { useGoods } from '@/lib/goods-api';
import { queryClient } from '@/lib/query';
import { useClubKey } from '@/lib/queries';

/** Проведённый документ склада: приход, списание или ревизия (`?type=…&id=…`). */
export default function GoodsDocScreen() {
  const { type, id } = useLocalSearchParams<{ type: 'supply' | 'write_off' | 'revision'; id: string }>();
  const club = useClubKey();
  const goods = useGoods();

  const refresh = async () => {
    await queryClient.refetchQueries({ queryKey: [club, 'goods'], type: 'active' });
  };

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <Form modifiers={[refreshable(refresh)]}>
        {!goods.data ? (
          <Section>
            {goods.isError ? (
              <ContentUnavailableView title="Нет связи" systemImage="wifi.exclamationmark" description={goods.error.message} />
            ) : (
              <ProgressView />
            )}
          </Section>
        ) : type === 'supply' ? (
          <SupplyView id={id} catalog={goods.data} />
        ) : type === 'write_off' ? (
          <WriteOffView id={id} catalog={goods.data} />
        ) : (
          <RevisionView id={id} catalog={goods.data} />
        )}
      </Form>
    </Host>
  );
}
