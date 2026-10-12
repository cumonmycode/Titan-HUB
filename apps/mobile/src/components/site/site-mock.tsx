import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import type { SiteLook } from '@/lib/site-looks';

/**
 * Миниатюра первого экрана сайта в выбранном оформлении: ночная подложка с пятнами
 * света праздника, шапка-капсула, заголовок, кнопки и частицы (снег, сердца…).
 * Рисуется целиком из примитивов — превью не зависит от сети. Размер задаёт ширина,
 * весь текст масштабируется от неё и не растёт с системным размером шрифта.
 */

// Позиции частиц в долях ширины/высоты: x, y, размер, прозрачность.
const PARTICLES: [number, number, number, number][] = [
  [0.08, 0.2, 0.07, 0.55], [0.78, 0.14, 0.05, 0.4], [0.88, 0.36, 0.08, 0.5], [0.16, 0.5, 0.05, 0.35],
  [0.62, 0.27, 0.04, 0.45], [0.05, 0.74, 0.06, 0.4], [0.9, 0.62, 0.05, 0.35], [0.42, 0.12, 0.045, 0.3],
];

const clear = (rgba: string) => rgba.replace(/,\s*[\d.]+\)$/, ',0)');

function backdrop(look: SiteLook): string {
  const [a, b, c] = look.blobs;
  return (
    `radial-gradient(circle at 12% 8%, ${a} 0%, ${clear(a)} 55%), ` +
    `radial-gradient(circle at 95% 38%, ${b} 0%, ${clear(b)} 50%), ` +
    `radial-gradient(circle at 25% 98%, ${c} 0%, ${clear(c)} 55%), ` +
    'linear-gradient(to bottom, #0B0918 0%, #07060E 100%)'
  );
}

export function SiteMock({ look, width }: { look: SiteLook; width: number }) {
  const height = Math.round(width * 1.38);
  const u = width / 100;
  const fixed = { maxFontSizeMultiplier: 1 } as const;
  return (
    <View style={[styles.frame, { width, height, borderRadius: 7 * u, experimental_backgroundImage: backdrop(look) }]}>
      {look.symbol &&
        PARTICLES.map(([x, y, s, o], i) => (
          <SymbolView
            key={i}
            name={look.symbol!}
            size={s * width}
            tintColor={look.particle}
            style={{ position: 'absolute', left: x * width, top: y * height, opacity: o, width: s * width, height: s * width }}
          />
        ))}

      <View style={[styles.header, { margin: 4 * u, height: 10 * u, borderRadius: 5 * u, paddingHorizontal: 3 * u }]}>
        <View style={[styles.logo, { width: 5 * u, height: 5 * u, borderRadius: 1.4 * u }]} />
        <Text {...fixed} style={[styles.brand, { fontSize: 3.6 * u }]}>TITAN KBR</Text>
        <View style={styles.flex} />
        <View style={[styles.cta, { height: 6 * u, borderRadius: 3 * u, paddingHorizontal: 2.6 * u }]}>
          <Text {...fixed} style={[styles.ctaText, { fontSize: 2.8 * u }]}>Записаться</Text>
        </View>
      </View>

      <View style={[styles.copy, { marginTop: 6 * u, paddingHorizontal: 6 * u, gap: 0.5 * u }]}>
        <Text {...fixed} style={[styles.title, { fontSize: 8.4 * u, lineHeight: 9 * u }]}>Мафия в Нальчике.</Text>
        <Text {...fixed} style={[styles.title, { fontSize: 8.4 * u, lineHeight: 9 * u }]}>Каждый вечер —</Text>
        <Text {...fixed} style={[styles.title, { fontSize: 8.4 * u, lineHeight: 9 * u, color: look.accent }]}>городская</Text>
        <View style={[styles.buttons, { gap: 2 * u, marginTop: 4 * u }]}>
          <View style={[styles.button, styles.primary, { height: 7.5 * u, borderRadius: 3.75 * u, paddingHorizontal: 3.5 * u }]}>
            <Text {...fixed} style={[styles.buttonText, { fontSize: 3 * u }]}>Записаться на игру</Text>
          </View>
          <View style={[styles.button, styles.glass, { height: 7.5 * u, borderRadius: 3.75 * u, paddingHorizontal: 3.5 * u }]}>
            <Text {...fixed} style={[styles.buttonText, { fontSize: 3 * u }]}>Праздник</Text>
          </View>
        </View>
      </View>

      <View style={[styles.photo, { left: 5 * u, right: 5 * u, bottom: 18 * u, height: 38 * u, borderRadius: 5 * u }]}>
        <SymbolView name="person.3.fill" size={14 * u} tintColor="rgba(255,255,255,0.18)" style={{ width: 14 * u, height: 14 * u }} />
      </View>
      <View style={[styles.glass, styles.next, { left: 5 * u, right: 5 * u, bottom: 4 * u, height: 12 * u, borderRadius: 4 * u, paddingHorizontal: 3.5 * u }]}>
        <View style={{ width: 1.8 * u, height: 1.8 * u, borderRadius: 0.9 * u, backgroundColor: look.accent }} />
        <Text {...fixed} style={[styles.nextText, { fontSize: 3.2 * u }]} numberOfLines={1}>Ближайшая игра · пт, 19:00</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  frame: { overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.28)' },
  logo: { backgroundColor: '#8E66FF' },
  brand: { color: '#FFFFFF', fontWeight: '800' },
  cta: { justifyContent: 'center', backgroundColor: '#7C4DFF' },
  ctaText: { color: '#FFFFFF', fontWeight: '700' },
  copy: { alignItems: 'center' },
  title: { color: '#FFFFFF', fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  buttons: { flexDirection: 'row' },
  button: { justifyContent: 'center' },
  primary: { backgroundColor: '#7C4DFF' },
  glass: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)' },
  buttonText: { color: '#FFFFFF', fontWeight: '700' },
  photo: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    experimental_backgroundImage: 'linear-gradient(135deg, rgba(91,60,190,0.9) 0%, rgba(30,20,60,0.95) 70%)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  next: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 8 },
  nextText: { color: '#FFFFFF', fontWeight: '700', flexShrink: 1 },
});
