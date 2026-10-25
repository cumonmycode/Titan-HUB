import SwiftUI

// MARK: - Плотные кнопки

/// Форма плотной кнопки.
enum SolidButtonShape {
    case rounded(CGFloat)
    case capsule
    case circle

    var shape: AnyShape {
        switch self {
        case let .rounded(radius): AnyShape(.rect(cornerRadius: radius, style: .continuous))
        case .capsule: AnyShape(.capsule)
        case .circle: AnyShape(.circle)
        }
    }
}

/// Кнопка с заливкой и мгновенным откликом: при нажатии чуть темнеет и сжимается, без «желе» стекла.
/// Ею сделано всё, что ведущий жмёт десятки раз за игру (номера, фолы, таймер, «Далее»);
/// стекло осталось у панелей навигации.
struct SolidButtonStyle: ButtonStyle {
    var isProminent = false
    var shape: SolidButtonShape = .rounded(14)
    /// Над прокручиваемым содержимым: подложка — плотный материал, сквозь него не проступает текст снизу.
    var isFloating = false

    func makeBody(configuration: Configuration) -> some View {
        SolidButtonBody(configuration: configuration, isProminent: isProminent, shape: shape, isFloating: isFloating)
    }
}

private struct SolidButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let isProminent: Bool
    let shape: SolidButtonShape
    let isFloating: Bool
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.controlSize) private var controlSize

    /// Отступы вокруг подписи по размеру кнопки: горизонтальный и вертикальный.
    private var insets: (horizontal: CGFloat, vertical: CGFloat) {
        switch controlSize {
        case .mini: (8, 4)
        case .small: (10, 6)
        case .regular: (14, 8)
        case .large: (16, 12)
        case .extraLarge: (20, 16)
        @unknown default: (14, 8)
        }
    }

    var body: some View {
        let insets = insets
        let isCircle = if case .circle = shape { true } else { false }
        let isDestructive = configuration.role == .destructive
        configuration.label
            .foregroundStyle(isProminent ? AnyShapeStyle(.white) : isDestructive ? AnyShapeStyle(.red) : AnyShapeStyle(.tint))
            // Недоступная кнопка бледнеет подписью; подложка остаётся — сквозь стекло не проступает текст снизу.
            .opacity(isEnabled ? 1 : 0.4)
            .padding(.horizontal, isCircle ? insets.vertical : insets.horizontal)
            .padding(.vertical, insets.vertical)
            .background {
                if isProminent {
                    shape.shape.fill(isDestructive ? AnyShapeStyle(.red) : AnyShapeStyle(.tint)).opacity(isEnabled ? 1 : 0.5)
                } else if isFloating {
                    shape.shape.fill(.thickMaterial)
                } else {
                    shape.shape.fill(Color(.tertiarySystemFill)).opacity(isEnabled ? 1 : 0.6)
                }
            }
            .overlay {
                if configuration.isPressed {
                    shape.shape.fill(isProminent ? Color.black.opacity(0.18) : Color.primary.opacity(0.1))
                }
            }
            .contentShape(shape.shape)
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == SolidButtonStyle {
    /// Серая плотная кнопка с подписью цвета акцента.
    static var solid: SolidButtonStyle { SolidButtonStyle() }

    /// Залитая акцентом (или `.tint(...)`) кнопка с белой подписью.
    static var solidProminent: SolidButtonStyle { SolidButtonStyle(isProminent: true) }

    static func solid(_ shape: SolidButtonShape) -> SolidButtonStyle { SolidButtonStyle(shape: shape) }

    static func solidProminent(_ shape: SolidButtonShape) -> SolidButtonStyle { SolidButtonStyle(isProminent: true, shape: shape) }

    /// Кнопка над прокруткой (панель «Назад» / «Далее»): плотный материал вместо прозрачной серой заливки.
    static func floating(_ shape: SolidButtonShape) -> SolidButtonStyle { SolidButtonStyle(shape: shape, isFloating: true) }
}
