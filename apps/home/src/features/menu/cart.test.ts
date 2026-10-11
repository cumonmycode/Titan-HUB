import { describe, expect, test } from '@jest/globals';

import { addLine, cartSummary, qtyOf, removeLine } from './cart';

const tea = { id: 't', name: 'Чай', price: 420, categoryId: null, isTop: false, tags: [] };
const nuggets = { id: 'n', name: 'Наггетсы', price: 250.5, categoryId: null, isTop: false, tags: [] };

describe('корзина', () => {
  test('добавление увеличивает количество той же позиции', () => {
    const lines = addLine(addLine([], tea), tea);
    expect(lines).toHaveLength(1);
    expect(qtyOf(lines, 't')).toBe(2);
  });

  test('удаление последней штуки убирает строку', () => {
    expect(removeLine(addLine([], tea), 't')).toEqual([]);
  });

  test('удаление несуществующей позиции ничего не меняет', () => {
    const lines = addLine([], tea);
    expect(removeLine(lines, 'x')).toBe(lines);
  });

  test('итог считает количество и сумму с копейками', () => {
    const lines = addLine(addLine(addLine([], tea), nuggets), nuggets);
    expect(cartSummary(lines)).toEqual({ count: 3, total: 921 });
  });
});
