// Иконки приложения 1024×1024 без альфа-канала (App Store её требует) из исходников scripts/icon/*.svg:
// обычная, тёмная и тонированная («Город засыпает» в цветах Titan HUB).
// Запуск из apps/mafboard/MafBoardApp: swift scripts/make-icon.swift
// SVG рисует Quick Look (WebKit) — NSImage не понимает фильтры свечения и тени.
import AppKit
import ImageIO
import UniformTypeIdentifiers

let size = 1024
let sources = URL(fileURLWithPath: "scripts/icon", isDirectory: true)
let iconSet = URL(fileURLWithPath: "Resources/Assets.xcassets/AppIcon.appiconset", isDirectory: true)
let names = ["AppIcon", "AppIcon-Dark", "AppIcon-Tinted"]

let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("mafboard-icon-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)

func render(_ svg: URL) throws -> CGImage {
    let quickLook = Process()
    quickLook.executableURL = URL(fileURLWithPath: "/usr/bin/qlmanage")
    quickLook.arguments = ["-t", "-s", "\(size)", "-o", scratch.path, svg.path]
    quickLook.standardOutput = FileHandle.nullDevice
    quickLook.standardError = FileHandle.nullDevice
    try quickLook.run()
    quickLook.waitUntilExit()
    let rendered = scratch.appendingPathComponent(svg.lastPathComponent + ".png")
    guard let source = CGImageSourceCreateWithURL(rendered as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { fatalError("Quick Look не отрисовал \(svg.path)") }
    return image
}

/// Перерисовывает картинку на непрозрачный sRGB-холст: альфа-канала в итоговом PNG нет.
func opaque(_ image: CGImage) -> CGImage {
    guard let context = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else { fatalError("не удалось создать холст") }
    let rect = CGRect(x: 0, y: 0, width: size, height: size)
    context.setFillColor(CGColor(gray: 0, alpha: 1))
    context.fill(rect)
    context.draw(image, in: rect)
    guard let flattened = context.makeImage() else { fatalError("не удалось собрать картинку") }
    return flattened
}

for name in names {
    let image = opaque(try render(sources.appendingPathComponent("\(name).svg")))
    let output = iconSet.appendingPathComponent("\(name).png")
    guard let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fatalError("не удалось подготовить PNG") }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("не удалось записать PNG") }
    print("иконка: \(output.path)")
}

try? FileManager.default.removeItem(at: scratch)
