import Foundation
import Network
import Observation
import SwiftUI
import MafBoardClient
import MafBoardCore

/// Синхронизация игр с сервером. Телефон — главный: всё сначала сохраняется на нём,
/// затем отправляется. Нет связи — копим и досылаем, как только она появится.
/// Живёт всё время работы приложения.
@Observable @MainActor
final class GameSync {
    private(set) var isOnline = true
    private(set) var isServerReachable = true
    /// Показать красную точку: нет сети или сервер не ответил.
    var showsProblem: Bool { !isOnline || !isServerReachable }

    private let library: GameLibrary
    private let model: AppModel
    private let monitor = NWPathMonitor()
    private var flushTask: Task<Void, Never>?

    /// Пауза перед отправкой хода: несколько быстрых действий уходят одним снимком.
    private static let pushDelay: Duration = .milliseconds(800)
    /// Повтор, пока связи нет.
    private static let retryDelay: Duration = .seconds(20)

    init(library: GameLibrary, model: AppModel) {
        self.library = library
        self.model = model
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.networkChanged(online: online) }
        }
        monitor.start(queue: DispatchQueue(label: "ru.titan.mafboard.network"))
    }

    // MARK: Когда отправлять

    /// Идущая игра изменилась — отправить с короткой паузой (последний снимок выигрывает).
    func activeChanged() {
        schedule(after: Self.pushDelay)
    }

    /// Приложение открыто или вернулось на экран: подтянуть с сервера и дослать накопленное.
    func refresh() async {
        await restore()
        await flush()
    }

    private func networkChanged(online: Bool) {
        isOnline = online
        if online { schedule(after: .zero) }
    }

    private func schedule(after delay: Duration) {
        flushTask?.cancel()
        flushTask = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            await self?.flush()
        }
    }

    // MARK: Отправка

    /// Дослать всё накопленное: удаления, снимок идущей игры, законченные игры.
    func flush() async {
        guard model.phase == .signedIn else { return }
        var reachedServer = true

        for id in library.pendingDeletions {
            switch await model.deleteActiveGame(id) {
            case .done, .rejected: library.deletionSynced(id)
            case .offline: reachedServer = false
            }
        }

        if let game = library.active, game.needsSync {
            let envelope = ActiveGameEnvelope(
                id: game.id, revision: game.revision, updatedAt: game.updatedAt,
                snapshot: ActiveGameSnapshot(session: game.session, players: game.players)
            )
            switch await model.saveActiveGame(envelope) {
            // Отказ сервера (например, игра уже закончена) — повторять бессмысленно.
            case .done, .rejected: library.markSynced(game.id, revision: game.revision)
            case .offline: reachedServer = false
            }
        }

        if !(await library.uploadPending()) { reachedServer = false }

        isServerReachable = reachedServer
        if !reachedServer { schedule(after: Self.retryDelay) }
    }

    /// Идущая игра с сервера — если на телефоне её нет или там она старее.
    private func restore() async {
        guard model.phase == .signedIn else { return }
        guard let remote = await model.activeGames() else {
            isServerReachable = false
            return
        }
        isServerReachable = true
        library.adoptRemote(remote)
    }
}

// MARK: - Индикатор

/// Маленькая красная точка в правом верхнем углу — только когда нет связи с сервером.
/// Пока всё хорошо, её нет.
private struct ConnectionIndicator: View {
    @Environment(GameSync.self) private var sync

    var body: some View {
        Group {
            if sync.showsProblem {
                Circle()
                    .fill(.red)
                    .frame(width: 7, height: 7)
                    .padding(.top, 3)
                    .padding(.trailing, 14)
                    .transition(.opacity)
                    .accessibilityLabel("Нет связи с сервером. Игра сохранена на телефоне и отправится позже.")
            }
        }
        .animation(.easeInOut(duration: 0.3), value: sync.showsProblem)
        .allowsHitTesting(false)
    }
}

extension View {
    func connectionIndicator() -> some View {
        overlay(alignment: .topTrailing) { ConnectionIndicator() }
    }
}
