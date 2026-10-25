import SwiftUI

/// Логотип MafBoard — маска для сна на ночном небе, как на иконке приложения (scripts/icon/AppIcon*.svg).
/// Рисуется в координатах иконки 1024×1024 и масштабируется под `size`; в тёмной теме — тёмная версия иконки.
struct SleepMaskLogo: View {
    var size: CGFloat
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let palette = scheme == .dark ? Palette.dark : Palette.light
        Canvas { context, canvas in
            Self.draw(in: &context, scale: canvas.width / 1024, palette: palette)
        }
        .frame(width: size, height: size)
        .clipShape(.rect(cornerRadius: size * 0.2237, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous)
                .strokeBorder(.white.opacity(0.18), lineWidth: 1)
        }
        .shadow(color: palette.tileShadow, radius: size * 0.08, y: size * 0.04)
        .accessibilityHidden(true)
    }
}

// MARK: - Рисунок

private extension SleepMaskLogo {
    struct Palette {
        let background: Gradient
        let halo: Color
        let star: Color
        let moon: Color
        let mask: Gradient
        let strap: Gradient
        let sheen: Double
        let seam: Color
        let lash: Color
        let lashGlows: Bool
        let maskShadow: Color
        let tileShadow: Color

        /// Обычная иконка: фиолетовый Titan, тёмная маска, светящиеся ресницы.
        static let light = Palette(
            background: Gradient(stops: [.init(color: Color(hex: 0xB199FC), location: 0),
                                         .init(color: Color(hex: 0x8B5CF6), location: 0.45),
                                         .init(color: Color(hex: 0x4C1D95), location: 1)]),
            halo: Color(hex: 0xE9E1FF, opacity: 0.28),
            star: .white,
            moon: Color(hex: 0xF6F2FF),
            mask: Gradient(stops: [.init(color: Color(hex: 0x2D2639), location: 0),
                                   .init(color: Color(hex: 0x1C1726), location: 0.5),
                                   .init(color: Color(hex: 0x110E17), location: 1)]),
            strap: Gradient(colors: [Color(hex: 0x1C1726), Color(hex: 0x0D0B12)]),
            sheen: 0.16,
            seam: Color(hex: 0x8B7BB0),
            lash: Color(hex: 0xD4C6FF),
            lashGlows: true,
            maskShadow: Color(hex: 0x1E0B47, opacity: 0.55),
            tileShadow: Color(hex: 0x4C1D95, opacity: 0.3)
        )

        /// Тёмная иконка: фон Titan HUB, фиолетовая маска.
        static let dark = Palette(
            background: Gradient(colors: [Color(hex: 0x1F1A2B), Color(hex: 0x0B0910)]),
            halo: Color(hex: 0x8B5CF6, opacity: 0.42),
            star: Color(hex: 0xA78BFA),
            moon: Color(hex: 0xE8DFEE),
            mask: Gradient(stops: [.init(color: Color(hex: 0xB49DFC), location: 0),
                                   .init(color: Color(hex: 0x8B5CF6), location: 0.55),
                                   .init(color: Color(hex: 0x6D3FE0), location: 1)]),
            strap: Gradient(colors: [Color(hex: 0x7C4AE8), Color(hex: 0x5B21B6)]),
            sheen: 0.28,
            seam: Color(hex: 0xE4DBFF),
            lash: Color(hex: 0x140F20),
            lashGlows: false,
            maskShadow: .black.opacity(0.55),
            tileShadow: .black.opacity(0.4)
        )
    }

    /// Звёзды: центр, радиус, непрозрачность.
    static let stars: [(x: CGFloat, y: CGFloat, r: CGFloat, opacity: Double)] = [
        (196, 196, 8, 0.95), (300, 126, 4.5, 0.75), (146, 330, 4.5, 0.6), (600, 150, 3.5, 0.5), (884, 420, 4, 0.55),
    ]

    /// Маска на иконке увеличена на 8 % относительно точки (512, 540).
    static let maskScale: CGFloat = 1.08

    static func draw(in context: inout GraphicsContext, scale s: CGFloat, palette: Palette) {
        let canvas = CGAffineTransform(scaleX: s, y: s)
        let onMask = CGAffineTransform(translationX: 512 * (1 - maskScale), y: 540 * (1 - maskScale))
            .scaledBy(x: maskScale, y: maskScale)
            .concatenating(canvas)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
        func circle(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Path {
            Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
        }

        // Небо и мягкий свет за маской.
        let tile = Path(CGRect(x: 0, y: 0, width: 1024, height: 1024)).applying(canvas)
        context.fill(tile, with: .linearGradient(palette.background, startPoint: point(0, 0), endPoint: point(717, 1024)))
        context.fill(tile, with: .radialGradient(Gradient(colors: [palette.halo, palette.halo.opacity(0)]),
                                                 center: point(512, 560), startRadius: 0, endRadius: 470 * s))
        for star in stars {
            context.fill(circle(star.x, star.y, star.r).applying(canvas), with: .color(palette.star.opacity(star.opacity)))
        }

        // Месяц со свечением.
        let moon = circle(795, 283, 116).subtracting(circle(851, 254, 97)).applying(canvas)
        context.drawLayer { glow in
            glow.addFilter(.blur(radius: 22 * s))
            glow.opacity = 0.7
            glow.fill(moon, with: .color(palette.moon))
        }
        context.fill(moon, with: .color(palette.moon))

        // Резинка.
        var strap = Path()
        strap.move(to: CGPoint(x: -10, y: 492))
        strap.addCurve(to: CGPoint(x: 512, y: 486), control1: CGPoint(x: 200, y: 476), control2: CGPoint(x: 330, y: 486))
        strap.addCurve(to: CGPoint(x: 1034, y: 492), control1: CGPoint(x: 694, y: 486), control2: CGPoint(x: 824, y: 476))
        strap.addLine(to: CGPoint(x: 1034, y: 540))
        strap.addCurve(to: CGPoint(x: 512, y: 534), control1: CGPoint(x: 824, y: 524), control2: CGPoint(x: 694, y: 534))
        strap.addCurve(to: CGPoint(x: -10, y: 540), control1: CGPoint(x: 330, y: 534), control2: CGPoint(x: 200, y: 524))
        strap.closeSubpath()
        context.fill(strap.applying(canvas), with: .linearGradient(palette.strap, startPoint: point(0, 476), endPoint: point(0, 540)))

        // Маска: тень, заливка, блик сверху, шов по контуру.
        let mask = maskOutline.applying(onMask)
        let maskTop = point(0, 382), maskBottom = point(0, 691)
        context.drawLayer { shadowed in
            shadowed.addFilter(.shadow(color: palette.maskShadow, radius: 36 * s, x: 0, y: 26 * s))
            shadowed.fill(mask, with: .linearGradient(palette.mask, startPoint: maskTop, endPoint: maskBottom))
        }
        context.fill(mask, with: .linearGradient(
            Gradient(stops: [.init(color: .white.opacity(palette.sheen), location: 0), .init(color: .white.opacity(0), location: 0.35)]),
            startPoint: maskTop, endPoint: maskBottom))
        let seam = maskOutline
            .applying(CGAffineTransform(translationX: 512 * 0.1, y: 532 * 0.14).scaledBy(x: 0.9, y: 0.86))
            .applying(onMask)
        context.stroke(seam, with: .color(palette.seam.opacity(0.5)),
                       style: StrokeStyle(lineWidth: 5 * maskScale * s, lineCap: .round,
                                          dash: [14 * maskScale * s, 12 * maskScale * s]))

        // Закрытые глаза.
        let lashes = closedEyes.applying(onMask)
        let lashStyle = StrokeStyle(lineWidth: 21 * maskScale * s, lineCap: .round)
        if palette.lashGlows {
            context.drawLayer { glow in
                glow.addFilter(.blur(radius: 9 * s))
                glow.stroke(lashes, with: .color(palette.lash), style: lashStyle)
            }
        }
        context.stroke(lashes, with: .color(palette.lash), style: lashStyle)
    }

    static let maskOutline: Path = {
        var path = Path()
        path.move(to: CGPoint(x: 212, y: 520))
        path.addCurve(to: CGPoint(x: 382, y: 398), control1: CGPoint(x: 212, y: 432), control2: CGPoint(x: 292, y: 394))
        path.addCurve(to: CGPoint(x: 512, y: 422), control1: CGPoint(x: 446, y: 401), control2: CGPoint(x: 482, y: 422))
        path.addCurve(to: CGPoint(x: 642, y: 398), control1: CGPoint(x: 542, y: 422), control2: CGPoint(x: 578, y: 401))
        path.addCurve(to: CGPoint(x: 812, y: 520), control1: CGPoint(x: 732, y: 394), control2: CGPoint(x: 812, y: 432))
        path.addCurve(to: CGPoint(x: 654, y: 680), control1: CGPoint(x: 812, y: 622), control2: CGPoint(x: 744, y: 680))
        path.addCurve(to: CGPoint(x: 512, y: 636), control1: CGPoint(x: 590, y: 680), control2: CGPoint(x: 560, y: 636))
        path.addCurve(to: CGPoint(x: 370, y: 680), control1: CGPoint(x: 464, y: 636), control2: CGPoint(x: 434, y: 680))
        path.addCurve(to: CGPoint(x: 212, y: 520), control1: CGPoint(x: 280, y: 680), control2: CGPoint(x: 212, y: 622))
        path.closeSubpath()
        return path
    }()

    /// Веко — дуга вниз, под ней три ресницы; правый глаз сдвинут на 280.
    static let closedEyes: Path = {
        var path = Path()
        for dx: CGFloat in [0, 280] {
            path.move(to: CGPoint(x: 296 + dx, y: 522))
            path.addQuadCurve(to: CGPoint(x: 448 + dx, y: 522), control: CGPoint(x: 372 + dx, y: 588))
            for (from, to) in [((322, 558), (304, 590)), ((372, 574), (372, 610)), ((422, 558), (440, 590))] {
                path.move(to: CGPoint(x: CGFloat(from.0) + dx, y: CGFloat(from.1)))
                path.addLine(to: CGPoint(x: CGFloat(to.0) + dx, y: CGFloat(to.1)))
            }
        }
        return path
    }()
}

private extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

#Preview {
    HStack(spacing: 24) {
        SleepMaskLogo(size: 104)
        SleepMaskLogo(size: 104).environment(\.colorScheme, .dark)
    }
    .padding()
}
