import ActivityKit
import Foundation
import MafBoardCore

/// Live Activity идущей игры: появляется, когда открыт экран игры, обновляется после каждого хода и паузы
/// и закрывается вместе с экраном или концом игры. Свёрнутое приложение продолжает показывать таймер и говорящего
/// на экране блокировки и в Dynamic Island. Кнопки активности выполняются здесь, в приложении.
@MainActor
final class LiveGameActivity {
    static let shared = LiveGameActivity()

    private weak var game: GameController?
    /// Сама `Activity` не переходит между потоками — храним её идентификатор.
    private var activityID: String?
    private var lastState: GameActivityAttributes.ContentState?
    private var isUpdateScheduled = false

    private init() {}

    /// Кнопки «Следующий» и «Пауза» на активности. Вызывается при запуске приложения — и при фоновом запуске ради кнопки.
    func installActions() {
        GameActivityActions.handler = { [weak self] action, gameID in
            await self?.perform(action, gameID: gameID)
        }
    }

    /// Экран игры открыт — активность идёт за этой игрой. Активность этой же игры от прошлого запуска подхватываем.
    func attach(_ game: GameController) {
        self.game = game
        lastState = nil
        let gameID = game.id.description
        if !Activity<GameActivityAttributes>.activities.contains(where: { $0.id == activityID && $0.attributes.gameID == gameID }) {
            activityID = Activity<GameActivityAttributes>.activities.first { $0.attributes.gameID == gameID }?.id
        }
        endOrphans()
        Task { await push() }
    }

    /// Экран игры закрыт — активность больше не нужна.
    func detach(_ game: GameController) {
        guard self.game === game else { return }
        self.game = nil
        end()
    }

    /// Ход сделан или таймер изменился. Несколько изменений за один ход — одно обновление.
    func setNeedsUpdate(_ game: GameController) {
        guard self.game === game, !isUpdateScheduled else { return }
        isUpdateScheduled = true
        Task {
            isUpdateScheduled = false
            await push()
        }
    }

    /// Закрыть активности, за которыми нет открытой игры: остались от прошлого запуска или от другой игры.
    func endOrphans() {
        let orphans = Activity<GameActivityAttributes>.activities.map(\.id).filter { $0 != activityID }
        guard !orphans.isEmpty else { return }
        Task { await Self.end(orphans) }
    }

    // MARK: Кнопки

    private func perform(_ action: GameActivityAction, gameID: String) async {
        guard let game, game.id.description == gameID else { return }
        switch action {
        case .next:
            guard game.state.canAdvance, !game.state.isFinished else { return }
            game.perform(.advance)
        case .toggleTimer:
            game.toggleTimer()
        }
        // Пока система держит приложение проснувшимся ради кнопки: показать новый шаг и дописать игру на диск.
        await push()
        await SavedGameStore.flush()
    }

    // MARK: Обновление

    private func push() async {
        guard let game else { return }
        guard !game.state.isFinished else {
            end()
            return
        }
        let state = GameActivityAttributes.ContentState(game)
        guard state != lastState else { return }
        lastState = state
        let content = ActivityContent(state: state, staleDate: nil)
        if let activityID {
            await Self.update(activityID, with: content)
        } else {
            start(game, content: content)
        }
    }

    /// Запустить можно, только пока приложение на экране, — поэтому активность появляется с открытием игры.
    private func start(_ game: GameController, content: ActivityContent<GameActivityAttributes.ContentState>) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let accent = UserDefaults.standard.string(forKey: AccentChoice.storageKey).flatMap(AccentChoice.init) ?? .blue
        let attributes = GameActivityAttributes(gameID: game.id.description, accentHue: accent.hue)
        activityID = (try? Activity.request(attributes: attributes, content: content, pushType: nil))?.id
    }

    private func end() {
        guard let ending = activityID else { return }
        activityID = nil
        lastState = nil
        Task { await Self.end([ending]) }
    }

    private nonisolated static func update(_ id: String, with content: ActivityContent<GameActivityAttributes.ContentState>) async {
        await Activity<GameActivityAttributes>.activities.first { $0.id == id }?.update(content)
    }

    private nonisolated static func end(_ ids: [String]) async {
        for activity in Activity<GameActivityAttributes>.activities where ids.contains(activity.id) {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}

extension GameActivityAttributes.ContentState {
    /// Снимок идущей игры для активности: говорящий, шаг, таймер и куда ведёт «Следующий».
    @MainActor init(_ game: GameController) {
        let state = game.state
        let speaker = state.currentSpeaker
        let timer = game.countdown
        let isNight = switch state.phase {
        case .night, .nightZero: true
        default: false
        }
        self.init(
            seat: speaker?.number,
            name: speaker.map(game.name(of:)),
            title: state.currentStep.title(in: state),
            moment: state.moment.displayName,
            isNight: isNight,
            endsAt: timer?.endDate,
            remaining: timer.flatMap { $0.isRunning ? nil : $0.remaining(at: .now) },
            duration: timer?.duration,
            next: game.nextHint,
            canAdvance: state.canAdvance
        )
    }
}
