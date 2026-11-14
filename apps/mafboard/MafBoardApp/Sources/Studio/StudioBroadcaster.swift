import Foundation
import MafBoardCore

/// Инфографика эфира: после каждого хода и каждого старта, паузы и сброса таймера телефон шлёт
/// в MafBoard Studio снимок игры. Быстрые ходы подряд склеиваются в один снимок, как в `GameSync`.
/// Пульт не подключён — снимок просто не уходит; последний дошлётся, когда связь появится.
@MainActor
final class StudioBroadcaster {
    /// Короче, чем у сервера: таймер и голосование должны появиться в кадре почти сразу.
    private static let mergeDelay: Duration = .milliseconds(250)

    private let library: GameLibrary
    private let model: AppModel
    private var task: Task<Void, Never>?
    private var lastRevision: UInt64 = 0

    init(library: GameLibrary, model: AppModel) {
        self.library = library
        self.model = model
    }

    func gameChanged(_ controller: GameController) {
        task?.cancel()
        // Игру держим до отправки: ход прямо перед закрытием экрана игры тоже должен уйти.
        task = Task { [weak self, controller] in
            try? await Task.sleep(for: Self.mergeDelay)
            guard !Task.isCancelled, let self else { return }
            self.publish(controller)
        }
    }

    func gameDiscarded() {
        task?.cancel()
        task = nil
        model.clearStudioGame()
    }

    private func publish(_ controller: GameController) {
        let now = Date.now
        let context = GameBroadcastContext(
            countdown: controller.countdown,
            gameNumber: library.gameNumber(of: controller.session.setup)
        )
        let snapshot = GameBroadcast(
            session: controller.session, players: controller.players, context: context,
            revision: nextRevision(at: now), at: now
        )
        model.publishStudioGame(snapshot, madeAt: now)
    }

    /// Миллисекунды часов, но строго больше прошлой: ревизия растёт и после перезапуска приложения,
    /// а ноутбук отбрасывает снимки старее показанного.
    private func nextRevision(at date: Date) -> UInt64 {
        let clock = UInt64(max(0, date.timeIntervalSince1970 * 1000))
        lastRevision = max(lastRevision + 1, clock)
        return lastRevision
    }
}
