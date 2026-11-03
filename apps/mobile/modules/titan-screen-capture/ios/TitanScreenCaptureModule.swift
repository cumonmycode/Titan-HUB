import ExpoModulesCore
import UIKit

/// Мост JS ↔ показ экрана: идёт ли запись, FaceTime, AirPlay или дублирование.
public class TitanScreenCaptureModule: Module {
  private weak var scene: UIWindowScene?
  private var registration: (any UITraitChangeRegistration)?

  public func definition() -> ModuleDefinition {
    Name("TitanScreenCapture")

    Events("onChange")

    OnStartObserving {
      DispatchQueue.main.async { self.attach() }
    }

    OnStopObserving {
      DispatchQueue.main.async { self.detach() }
    }
  }

  /// Сцена уже есть: React Native запускает её делегат (plugins/with-scene-lifecycle.js).
  @MainActor
  private func attach() {
    guard registration == nil,
      let scene = UIApplication.shared.connectedScenes.first(where: { $0.session.role == .windowApplication }) as? UIWindowScene
    else { return }
    self.scene = scene
    registration = scene.registerForTraitChanges([UITraitSceneCaptureState.self]) { [weak self] (scene: UIWindowScene, _: UITraitCollection) in
      self?.report(scene)
    }
    report(scene)
  }

  @MainActor
  private func detach() {
    if let registration { scene?.unregisterForTraitChanges(registration) }
    registration = nil
    scene = nil
  }

  @MainActor
  private func report(_ scene: UIWindowScene) {
    sendEvent("onChange", ["captured": scene.traitCollection.sceneCaptureState == .active])
  }
}
