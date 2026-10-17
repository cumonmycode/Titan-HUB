import SwiftUI
import MafBoardCore

// MARK: - Оформление

/// Акцентный цвет приложения (Профиль → Оформление).
enum AccentChoice: String, CaseIterable, Identifiable {
    case blue, indigo, purple, pink, red, orange, green, teal

    static let storageKey = "accentColor"

    var id: Self { self }

    var color: Color {
        switch self {
        case .blue: .blue
        case .indigo: .indigo
        case .purple: .purple
        case .pink: .pink
        case .red: .red
        case .orange: .orange
        case .green: .green
        case .teal: .teal
        }
    }

    /// Тон акцента для фона (0…1 по кругу цветов).
    var hue: Double {
        switch self {
        case .blue: 0.60
        case .indigo: 0.67
        case .purple: 0.77
        case .pink: 0.93
        case .red: 0.99
        case .orange: 0.07
        case .green: 0.37
        case .teal: 0.50
        }
    }

    var title: String {
        switch self {
        case .blue: "Синий"
        case .indigo: "Индиго"
        case .purple: "Фиолетовый"
        case .pink: "Розовый"
        case .red: "Красный"
        case .orange: "Оранжевый"
        case .green: "Зелёный"
        case .teal: "Бирюзовый"
        }
    }
}

/// Светлая/тёмная тема: как в системе или принудительно.
enum AppearanceChoice: String, CaseIterable, Identifiable {
    case system, dark, light

    static let storageKey = "appearance"

    var id: Self { self }

    var title: String {
        switch self {
        case .system: "Как в системе"
        case .dark: "Тёмная"
        case .light: "Светлая"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .dark: .dark
        case .light: .light
        }
    }
}

// MARK: - Живой фон

/// Фон приложения: mesh-градиент в оттенках акцента, медленно перетекает.
/// В тёмной теме — глубокий со светящимися пятнами, в светлой — пастельный.
/// При «Уменьшении движения» стоит на месте.
/// Настроение фона: акцент приложения или ночь (во время ночных фаз игры).
enum AmbientMood: Equatable {
    case accent
    case night
}

struct AmbientBackground: View {
    var mood: AmbientMood = .accent
    @AppStorage(AccentChoice.storageKey) private var accent = AccentChoice.blue
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
            MeshGradient(
                width: 3, height: 3,
                points: Self.points(at: reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate),
                colors: palette
            )
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.6), value: accent)
        .animation(.easeInOut(duration: 1.2), value: mood)
    }

    /// Углы на месте, края скользят вдоль себя, центр плавает. Периоды разные — узор не повторяется заметно.
    private static func points(at time: Double) -> [SIMD2<Float>] {
        func wave(_ speed: Double, _ phase: Double, _ amplitude: Float) -> Float {
            Float(sin(time * speed + phase)) * amplitude
        }
        return [
            [0, 0], [0.5 + wave(0.21, 0.0, 0.2), 0], [1, 0],
            [0, 0.5 + wave(0.17, 1.3, 0.22)],
            [0.5 + wave(0.13, 2.1, 0.24), 0.5 + wave(0.19, 0.4, 0.24)],
            [1, 0.5 + wave(0.15, 3.0, 0.22)],
            [0, 1], [0.5 + wave(0.23, 4.2, 0.2), 1], [1, 1],
        ]
    }

    private var palette: [Color] {
        // Ночью — глубокий индиго независимо от акцента.
        let hue = mood == .night ? 0.68 : accent.hue
        let dim = mood == .night ? 0.7 : 1.0
        func tone(_ shift: Double, _ saturation: Double, _ brightness: Double) -> Color {
            Color(hue: (hue + shift + 1).truncatingRemainder(dividingBy: 1), saturation: saturation, brightness: brightness)
        }
        if scheme == .dark {
            return [
                tone(-0.06, 0.85, 0.32 * dim), tone(0.00, 0.90, 0.16 * dim), tone(0.07, 0.80, 0.34 * dim),
                tone(0.04, 0.70, 0.10 * dim), tone(0.00, 0.95, 0.48 * dim), tone(-0.05, 0.75, 0.12 * dim),
                tone(0.08, 0.80, 0.22 * dim), tone(-0.03, 0.85, 0.08 * dim), tone(0.02, 0.90, 0.36 * dim),
            ]
        }
        return [
            tone(-0.06, 0.24, 1.00), tone(0.00, 0.10, 1.00), tone(0.07, 0.26, 0.99),
            tone(0.04, 0.08, 1.00), tone(0.00, 0.36, 0.98), tone(-0.05, 0.14, 1.00),
            tone(0.08, 0.20, 0.99), tone(-0.03, 0.08, 1.00), tone(0.02, 0.30, 0.97),
        ]
    }
}

extension View {
    /// Живой фон под списком или прокруткой экрана.
    func ambientBackground(mood: AmbientMood = .accent) -> some View {
        scrollContentBackground(.hidden)
            .background { AmbientBackground(mood: mood) }
    }
}

// MARK: - Мелкие элементы

/// Значок режима: «Фанка», «Рейтинг».
struct FormatTag: View {
    let format: CompetitionFormat

    var body: some View {
        Text(format.displayName)
            .font(.caption.weight(.semibold))
            .foregroundStyle(format.tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(format.tint.opacity(0.15), in: .capsule)
    }
}

extension CompetitionFormat {
    var tint: Color {
        switch self {
        case .funky: .teal
        case .rating: .orange
        case .miniCup: .mint
        case .tournament: .purple
        }
    }
}

extension Winner {
    var shortName: String {
        switch self {
        case .red: "Мирные"
        case .black: "Мафия"
        case .draw: "Ничья"
        }
    }

    var dot: Color {
        switch self {
        case .red: .red
        case .black: .indigo
        case .draw: .gray
        }
    }
}

extension Team {
    var tint: Color {
        switch self {
        case .red: .red
        case .black: .indigo
        }
    }
}

/// Цветная точка + текст — исход игры.
struct WinnerLabel: View {
    let winner: Winner

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(winner.dot).frame(width: 8, height: 8)
            Text(winner.shortName)
        }
    }
}

// MARK: - Аватар

/// Фото игрока из GoMafia или монограмма, как в «Контактах». С номером места — в углу.
struct PlayerAvatar: View {
    let name: String
    var url: URL?
    var seat: Int?
    var size: CGFloat = 40

    private var initials: String {
        let words = name.split(separator: " ").prefix(2)
        let letters = words.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : letters
    }

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Color(white: 0.62), Color(white: 0.45)], startPoint: .top, endPoint: .bottom))
            Text(initials)
                .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
            if let url {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .overlay(alignment: .bottomTrailing) {
            if let seat {
                Text("\(seat)")
                    .font(.system(size: max(10, size * 0.28), weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .frame(minWidth: size * 0.44, minHeight: size * 0.44)
                    .background(.tint, in: .circle)
                    .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                    .offset(x: size * 0.08, y: size * 0.08)
            }
        }
        .accessibilityLabel(seat.map { "Место \($0), \(name)" } ?? name)
    }
}
