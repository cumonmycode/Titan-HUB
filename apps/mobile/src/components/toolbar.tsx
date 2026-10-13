// Кнопки и меню в шапке, работающие на обеих платформах.
//
// Иконки в Stack.Toolbar заданы именами SF Symbols. На Android expo-router их
// МОЛЧА ОТБРАСЫВАЕТ («Only ImageSourcePropType icons are rendered» в его типах) —
// кнопка остаётся на месте, но без изображения, и шапка выглядит пустой.
// Обёртки подставляют там картинку из шрифта Material Symbols по той же таблице,
// что и остальные иконки приложения.
import { Stack } from 'expo-router';
import { unstable_getMaterialSymbolSourceAsync, type AndroidSymbol } from 'expo-symbols';
import { Children, Fragment, isValidElement, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { Platform, type ImageSourcePropType } from 'react-native';

import { toMaterialSymbol } from '@/compat/android/sf-to-material';

import { showActionList, type DialogButton } from '@/lib/dialog';

import { ToolbarCircleButton } from './toolbar-circle-button';
import { ToolbarTextButton } from './toolbar-text-button';

const ICON_SIZE = 24;
const cache = new Map<string, ImageSourcePropType>();

/** Картинка Material-символа для Android; на iOS всегда undefined — там хватает имени SF. */
export function useMaterialIcon(sf?: string): ImageSourcePropType | undefined {
  const [source, setSource] = useState<ImageSourcePropType | undefined>(() =>
    sf ? cache.get(sf) : undefined,
  );

  useEffect(() => {
    if (Platform.OS !== 'android' || !sf || cache.has(sf)) return;
    const material = toMaterialSymbol(sf);
    if (!material) return;
    let alive = true;
    // Таблица отдаёт имя строкой, а типы модуля описывают его перечислением.
    unstable_getMaterialSymbolSourceAsync(material as AndroidSymbol, ICON_SIZE, 'white')
      .then((image) => {
        if (!image) return;
        cache.set(sf, image as ImageSourcePropType);
        if (alive) setSource(image as ImageSourcePropType);
      })
      .catch(() => {
        /* без иконки кнопка всё равно работает */
      });
    return () => {
      alive = false;
    };
  }, [sf]);

  return Platform.OS === 'android' ? source : undefined;
}

type MenuProps = ComponentProps<typeof Stack.Toolbar.Menu>;
type MenuActionProps = ComponentProps<typeof Stack.Toolbar.MenuAction>;
type ButtonProps = ComponentProps<typeof Stack.Toolbar.Button>;

/** Пункты меню из детей ToolbarMenu (Android), включая вложенные фрагменты и условия. */
function menuActions(children: ReactNode): DialogButton[] {
  const out: DialogButton[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      out.push(...menuActions((child.props as { children?: ReactNode }).children));
      return;
    }
    const props = child.props as MenuActionProps & { isOn?: boolean };
    if (props.disabled || props.hidden) return;
    const label = typeof props.children === 'string' ? props.children : Children.toArray(props.children).join('');
    out.push({
      text: label,
      icon: typeof props.icon === 'string' ? props.icon : undefined,
      checked: props.isOn,
      style: props.destructive ? 'destructive' : 'default',
      onPress: () => props.onPress?.(),
    });
  });
  return out;
}

function AndroidToolbarMenu({ icon, ...rest }: MenuProps) {
  const source = useMaterialIcon(icon as string | undefined);
  // Выпадающее меню Material в шапке выбивалось из стиля — круглая кнопка и шторка действий.
  const title = rest.accessibilityLabel ?? (typeof rest.title === 'string' ? rest.title : 'Действия');
  return (
    <ToolbarCircleButton
      source={source}
      label={title}
      onPress={() => showActionList(title, [...menuActions(rest.children), { text: 'Отмена', style: 'cancel' }])}
    />
  );
}

/** На Android пункты меню не рисуются сами: их читает AndroidToolbarMenu. */
function AndroidToolbarMenuAction(_props: MenuActionProps) {
  return null;
}

function AndroidToolbarButton({ icon, ...rest }: ButtonProps) {
  const symbol = useMaterialIcon(typeof icon === 'string' ? icon : undefined);
  const source = typeof icon === 'string' || !icon ? symbol : icon;
  // Кнопку без иконки expo-router на Android не рисует вовсе — подставляем свою.
  if (!icon && typeof rest.children === 'string') {
    return <ToolbarTextButton title={rest.children} variant={rest.variant} disabled={rest.disabled} onPress={rest.onPress} />;
  }
  // С иконкой — круглая кнопка, как стеклянные кнопки шапки iPhone.
  return <ToolbarCircleButton source={source} label={rest.accessibilityLabel} disabled={rest.disabled} onPress={rest.onPress} />;
}

/*
 * ВАЖНО: на iOS отдаём ОРИГИНАЛЬНЫЕ компоненты expo-router. iOS собирает кнопки шапки
 * по типу элемента (isChildOfType(StackToolbarButton…)) и любые обёртки молча выбрасывает —
 * из-за этого на iPhone пропали «+», сортировка, меню «…», «Готово» и «Открыть».
 */
export const ToolbarMenu = (Platform.OS === 'ios' ? Stack.Toolbar.Menu : AndroidToolbarMenu) as (props: MenuProps) => ReactNode;
export const ToolbarMenuAction = (Platform.OS === 'ios' ? Stack.Toolbar.MenuAction : AndroidToolbarMenuAction) as (props: MenuActionProps) => ReactNode;
export const ToolbarButton = (Platform.OS === 'ios' ? Stack.Toolbar.Button : AndroidToolbarButton) as (props: ButtonProps) => ReactNode;
