import SwiftUI

/// Площадки эфира на телефоне: цвет, значок и имя, как в MafBoard Studio.
enum StudioPlatform {
    static func name(_ id: String) -> String {
        switch id {
        case "youtube": "YouTube"
        case "twitch": "Twitch"
        case "vk": "VK Видео"
        case "rutube": "Ручной ввод"
        default: id
        }
    }

    static func tint(_ id: String) -> Color {
        switch id {
        case "youtube": Color(red: 1, green: 0, blue: 0.2)
        case "twitch": Color(red: 0.57, green: 0.27, blue: 1)
        case "vk": Color(red: 0, green: 0.47, blue: 1)
        default: Color(white: 0.4)
        }
    }

    /// Цвет ника из `#RRGGBB`; слишком тёмный осветляется, иначе на тёмном фоне его не прочитать.
    static func nick(hex: String?, platform: String) -> Color {
        guard let hex, hex.count == 7, let value = UInt32(hex.dropFirst(), radix: 16) else { return tint(platform) }
        let red = Double((value >> 16) & 0xFF) / 255, green = Double((value >> 8) & 0xFF) / 255, blue = Double(value & 0xFF) / 255
        let lift = max(0, 0.45 - max(red, green, blue))
        return Color(red: min(1, red + lift), green: min(1, green + lift), blue: min(1, blue + lift))
    }
}

/// Значок площадки: цветной квадрат со знаком.
struct StudioPlatformBadge: View {
    let platform: String
    var size: CGFloat = 28

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous).fill(StudioPlatform.tint(platform).gradient)
            switch platform {
            case "youtube":
                Image(systemName: "play.fill").font(.system(size: size * 0.42, weight: .bold))
            case "twitch":
                Image(systemName: "bubble.left.fill").font(.system(size: size * 0.42, weight: .bold))
            case "vk":
                Text("VK").font(.system(size: size * 0.4, weight: .heavy, design: .rounded))
            default:
                Image(systemName: "antenna.radiowaves.left.and.right").font(.system(size: size * 0.42, weight: .semibold))
            }
        }
        .foregroundStyle(.white)
        .frame(width: size, height: size)
        .accessibilityLabel(StudioPlatform.name(platform))
    }
}

/// Обложка от MBS: та же картинка, что рисует студия для YouTube.
struct StudioCoverArt: View {
    let title: String
    let host: String

    var body: some View {
        GeometryReader { box in
            let unit = box.size.width / 320
            ZStack(alignment: .bottomLeading) {
                LinearGradient(colors: [Color(red: 0.06, green: 0.16, blue: 0.31), Color(red: 0.14, green: 0.08, blue: 0.31), Color(red: 0.37, green: 0.07, blue: 0.22)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                Text("M").font(.system(size: 150 * unit, weight: .black)).foregroundStyle(.white.opacity(0.05))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing).offset(x: -8 * unit, y: -30 * unit)
                VStack(alignment: .leading, spacing: 4 * unit) {
                    Text("МАФИЯ").font(.system(size: 9 * unit, weight: .heavy)).tracking(2 * unit).foregroundStyle(Color(red: 1, green: 0.45, blue: 0.5))
                    Text(title).font(.system(size: 22 * unit, weight: .heavy)).lineLimit(2).minimumScaleFactor(0.6)
                    Text(Date.now.formatted(.dateTime.day().month(.wide).locale(Locale(identifier: "ru_RU"))) + (host.isEmpty ? "" : " · ведущий \(host)"))
                        .font(.system(size: 10 * unit, weight: .medium)).foregroundStyle(.white.opacity(0.75))
                }
                .foregroundStyle(.white)
                .padding(14 * unit)
            }
        }
        .aspectRatio(16 / 9, contentMode: .fit)
        .clipShape(.rect(cornerRadius: 18))
    }
}

/// Карточка на стекле с заголовком, как остальные блоки пульта.
struct StudioCard<Content: View>: View {
    var title: String?
    var note: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if title != nil || note != nil {
                HStack {
                    if let title { Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary) }
                    Spacer()
                    if let note { Text(note).font(.caption).foregroundStyle(.tertiary) }
                }
            }
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}
