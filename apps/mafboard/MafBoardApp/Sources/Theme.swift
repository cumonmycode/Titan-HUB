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
