// Показ экрана: идёт ли запись, FaceTime, AirPlay или дублирование (только iOS).
import { requireOptionalNativeModule } from 'expo';

type Subscription = { remove: () => void };

interface NativeScreenCapture {
  addListener(event: 'onChange', listener: (e: { captured: boolean }) => void): Subscription;
}

export const ScreenCapture = requireOptionalNativeModule<NativeScreenCapture>('TitanScreenCapture');
