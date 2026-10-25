import SwiftUI
import UIKit

// MARK: - Фото игроков

/// Фото игроков из GoMafia: качаются один раз, хранятся уменьшенными в памяти и на диске.
/// `AsyncImage` ничего не помнил — фото мигали и заново шли из сети при каждой прокрутке и открытии экрана.
@MainActor
final class AvatarCache {
    static let shared = AvatarCache()

    /// Сторона уменьшенного фото в пикселях: хватает на самый крупный аватар (≈ 80 pt на @3x).
    private nonisolated static let pixelSide: CGFloat = 240

    private let memory = NSCache<NSURL, UIImage>()
    private var loading: [URL: Task<UIImage?, Never>] = [:]
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 4 << 20, diskCapacity: 64 << 20, directory: nil)
        configuration.requestCachePolicy = .useProtocolCachePolicy
        return URLSession(configuration: configuration)
    }()

    private init() {
        memory.countLimit = 300
    }

    /// Уже готовое фото — сразу, без ожидания и мигания.
    func cached(_ url: URL) -> UIImage? {
        memory.object(forKey: url as NSURL)
    }

    /// Фото из памяти, с диска или из сети. Одновременные запросы одного адреса качаются один раз.
    func image(for url: URL) async -> UIImage? {
        if let image = cached(url) { return image }
        if let running = loading[url] { return await running.value }
        let task = Task.detached(priority: .userInitiated) { [session] in
            await Self.download(url, with: session)
        }
        loading[url] = task
        let image = await task.value
        loading[url] = nil
        if let image { memory.setObject(image, forKey: url as NSURL) }
        return image
    }

    /// Скачать и сразу уменьшить: декодирование большого фото — не на главном потоке.
    private nonisolated static func download(_ url: URL, with session: URLSession) async -> UIImage? {
        guard let (data, _) = try? await session.data(from: url), let image = UIImage(data: data) else { return nil }
        let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let ratio = min(1, pixelSide / max(1, min(pixels.width, pixels.height)))
        let target = CGSize(width: (pixels.width * ratio).rounded(), height: (pixels.height * ratio).rounded())
        return await image.byPreparingThumbnail(ofSize: target) ?? image
    }
}

/// Фото по адресу: из памяти — сразу, иначе подгружается и появляется без перерисовки соседей.
struct AvatarImage: View {
    let url: URL
    /// Подгруженное фото и его адрес: при смене игрока на месте старое фото не показываем.
    @State private var loaded: (url: URL, image: UIImage)?

    private var image: UIImage? {
        AvatarCache.shared.cached(url) ?? loaded.flatMap { $0.url == url ? $0.image : nil }
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Color.clear
            }
        }
        .task(id: url) {
            // Из памяти — сразу; присваиваем всегда: фото мог положить в память соседний аватар, и этот должен перерисоваться.
            guard let image = await AvatarCache.shared.image(for: url) else { return }
            loaded = (url, image)
        }
    }
}
