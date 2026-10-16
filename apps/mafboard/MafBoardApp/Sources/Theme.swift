import SwiftUI
import MafBoardCore

// MARK: - Темы

/// Фон приложения. Весь интерфейс — Liquid Glass поверх этого градиента.
enum AppTheme: String, CaseIterable, Identifiable {
    case midnight
    case violet
    case graphite
    case crimson

    static let storageKey = "appTheme"

    var id: Self { self }

    var title: String {
        switch self {
        case .midnight: "Полночь"
        case .violet: "Фиолет"
        case .graphite: "Графит"
        case .crimson: "Бордо"
        }
    }

    var gradient: [Color] {
        switch self {
        case .midnight: [Color(red: 0.04, green: 0.07, blue: 0.16), Color(red: 0.06, green: 0.15, blue: 0.30), Color(red: 0.03, green: 0.05, blue: 0.12)]
        case .violet: [Color(red: 0.07, green: 0.04, blue: 0.18), Color(red: 0.17, green: 0.08, blue: 0.36), Color(red: 0.05, green: 0.03, blue: 0.13)]
        case .graphite: [Color(red: 0.07, green: 0.07, blue: 0.09), Color(red: 0.14, green: 0.15, blue: 0.18), Color(red: 0.05, green: 0.05, blue: 0.06)]
        case .crimson: [Color(red: 0.12, green: 0.03, blue: 0.06), Color(red: 0.28, green: 0.06, blue: 0.12), Color(red: 0.08, green: 0.02, blue: 0.04)]
        }
    }

    var accent: Color {
        switch self {
        case .midnight: Color(red: 0.36, green: 0.62, blue: 1.0)
        case .violet: Color(red: 0.66, green: 0.45, blue: 1.0)
        case .graphite: Color(red: 0.55, green: 0.75, blue: 0.95)
        case .crimson: Color(red: 1.0, green: 0.42, blue: 0.48)
        }
    }

    var glow: Color { accent.opacity(0.35) }
}

struct AppBackground: View {
    @AppStorage(AppTheme.storageKey) private var theme = AppTheme.midnight

    var body: some View {
        ZStack {
            LinearGradient(colors: theme.gradient, startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [theme.glow, .clear], center: .top, startRadius: 10, endRadius: 420)
        }
        .ignoresSafeArea()
    }
}

extension View {
    /// Фон темы под содержимым экрана (внутри NavigationStack).
    func appBackground() -> some View {
        background { AppBackground() }
            .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
    }

    /// Стеклянная карточка.
    func glassCard(cornerRadius: CGFloat = 28, padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: cornerRadius))
    }
}

// MARK: - Мелкие элементы

/// Значок режима: «GOMAFIA», «ФАНКИ».
struct FormatTag: View {
    let text: String
    var color: Color = .cyan

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.heavy))
            .tracking(1)
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .overlay(Capsule().stroke(color.opacity(0.7), lineWidth: 1.5))
    }
}

struct CountBadge: View {
    let count: Int

    var body: some View {
        Text("\(count)")
            .font(.subheadline.bold())
            .monospacedDigit()
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .glassEffect(.regular, in: .rect(cornerRadius: 10))
    }
}

struct SectionTitle: View {
    let title: String
    var count: Int?

    var body: some View {
        HStack {
            Text(title).font(.headline)
            Spacer()
            if let count { CountBadge(count: count) }
        }
        .padding(.horizontal, 4)
    }
}

/// Подпись капсом с разрядкой — «ГОВОРИТ», «ВЫСТАВИТЬ НА ГОЛОСОВАНИЕ».
struct CapsLabel: View {
    let text: String
    var color: Color = .secondary

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.bold))
            .tracking(2)
            .foregroundStyle(color)
    }
}

extension CompetitionFormat {
    var tint: Color {
        switch self {
        case .funky: .cyan
        case .rating: .yellow
        case .miniCup: .mint
        case .tournament: .orange
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
        case .black: .blue
        case .draw: .gray
        }
    }
}

extension Team {
    var tint: Color {
        switch self {
        case .red: .red
        case .black: Color(red: 0.45, green: 0.6, blue: 1.0)
        }
    }
}

// MARK: - Аватар

/// Фото игрока из GoMafia или цветной квадрат с первой буквой ника. С номером места — в углу.
struct PlayerAvatar: View {
    let name: String
    var url: URL?
    var seat: Int?
    var size: CGFloat = 48

    private static let palette: [Color] = [.orange, .pink, .purple, .teal, .blue, .green, .indigo, .red]

    private var color: Color {
        let sum = name.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return Self.palette[sum % Self.palette.count]
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
        ZStack {
            shape.fill(color.gradient)
            Text(name.first.map { String($0).uppercased() } ?? "?")
                .font(.system(size: size * 0.42, weight: .bold, design: .rounded))
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
        .clipShape(shape)
        .overlay(alignment: .bottomTrailing) {
            if let seat {
                Text("\(seat)")
                    .font(.system(size: max(11, size * 0.22), weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .frame(minWidth: size * 0.38, minHeight: size * 0.38)
                    .background(.black, in: .rect(cornerRadius: size * 0.12))
                    .offset(x: size * 0.1, y: size * 0.1)
            }
        }
    }
}
