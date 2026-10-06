// Вкладка «Оплатить» — не экран, а кнопка в таб-баре: она `disabled` (выбрать нельзя,
// но нажатие приходит событием), и таб-бар открывает шторку оплаты. Сюда можно попасть
// только ссылкой — тогда сразу уводим на оплату.
import { Redirect } from 'expo-router';

export default function PayAction() {
  return <Redirect href="/pay" />;
}
