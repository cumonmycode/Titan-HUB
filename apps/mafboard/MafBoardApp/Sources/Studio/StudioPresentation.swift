import SwiftUI
import UIKit

extension View {
    /// Показ входа в MafBoard Studio. Камера может открыть ссылку посреди партии, а партия идёт
    /// в полноэкранном окне поверх всего, поэтому обычный `.sheet` отсюда не сработал бы.
    func studioLoginPresenter() -> some View {
        modifier(StudioLoginPresenter())
    }
}

private struct StudioLoginPresenter: ViewModifier {
    @Environment(AppModel.self) private var model
    @State private var host: UIViewController?

    func body(content: Content) -> some View {
        content.onChange(of: model.studioLogin != nil, initial: true) { _, isRequested in
            if isRequested {
                present()
            } else {
                host?.dismiss(animated: true)
                host = nil
            }
        }
    }

    private func present() {
        guard host == nil, let top = Self.topmostController() else { return }
        let sheet = UIHostingController(rootView: AnyView(
            StudioLoginSheet()
                .environment(model)
                .onDisappear { [model] in model.closeStudioLogin() }
        ))
        sheet.modalPresentationStyle = .pageSheet
        host = sheet
        top.present(sheet, animated: true)
    }

    /// Верхнее окно на экране: лист новой игры, полноэкранная партия или просто главный экран.
    private static func topmostController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        guard var top = scene?.keyWindow?.rootViewController else { return nil }
        while let next = top.presentedViewController, !next.isBeingDismissed {
            top = next
        }
        return top
    }
}
