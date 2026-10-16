// Иконка приложения 1024×1024 без альфа-канала (App Store её требует).
// Запуск: swift scripts/make-icon.swift Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png
// Временная: маски театра на тёмно-красном градиенте — заменим на финальную вместе с дизайном.
import AppKit
import ImageIO
import UniformTypeIdentifiers

let output = CommandLine.arguments.dropFirst().first ?? "AppIcon.png"
let size = 1024

guard let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
) else { fatalError("не удалось создать холст") }

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
let rect = NSRect(x: 0, y: 0, width: size, height: size)
NSGradient(
    starting: NSColor(srgbRed: 0.55, green: 0.04, blue: 0.10, alpha: 1),
    ending: NSColor(srgbRed: 0.08, green: 0.02, blue: 0.05, alpha: 1)
)?.draw(in: rect, angle: -90)

let configuration = NSImage.SymbolConfiguration(pointSize: 520, weight: .regular)
    .applying(.init(paletteColors: [.white]))
if let symbol = NSImage(systemSymbolName: "theatermasks.fill", accessibilityDescription: nil)?
    .withSymbolConfiguration(configuration) {
    let symbolSize = symbol.size
    let origin = NSPoint(x: (CGFloat(size) - symbolSize.width) / 2, y: (CGFloat(size) - symbolSize.height) / 2)
    symbol.draw(in: NSRect(origin: origin, size: symbolSize))
}
NSGraphicsContext.restoreGraphicsState()

guard let image = context.makeImage(),
      let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("не удалось подготовить PNG") }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("не удалось записать PNG") }
print("иконка: \(output)")
