// Ошибка в интерфейсе не должна оставлять гостя с белым экраном: показываем
// спокойную заглушку и через пару секунд перезапускаем JS.
import { reloadAppAsync } from 'expo';
import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Background } from './background';
import { T } from './text';

const RELOAD_MS = 2500;

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[titan-home] UI crash', error);
    this.timer = setTimeout(() => void reloadAppAsync('ui-crash').catch(() => {}), RELOAD_MS);
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.screen}>
        <Background />
        <T variant="title">Минуточку…</T>
        <T variant="body" tone="secondary">Перезапускаем экран</T>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
});
