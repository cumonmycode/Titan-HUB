import ActivityKit
import AppIntents
import Foundation

// Общее для приложения и расширения виджетов: что показывает Live Activity идущей игры и что делают её кнопки.

/// Live Activity идущей игры: кто говорит и сколько ему осталось — на экране блокировки и в Dynamic Island.
struct GameActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Номер говорящего. `nil` — шаг без говорящего: договорка, голосование, ночь.
        var seat: Int?
        var name: String?
        /// «Речь №5», «Заключительная речь №3», «Голосование».
        var title: String
        /// «День 2», «Ночь 1».
        var moment: String
        var isNight: Bool
        /// Таймер идёт до этого момента — отсчёт система показывает сама, без обновлений из приложения.
        var endsAt: Date?
        /// На паузе: сколько осталось.
        var remaining: Double?
        /// Полное время речи — для шкалы. `nil` — на шаге нет таймера.
        var duration: Double?
        /// Куда ведёт «Следующий»: «Речь №6».
        var next: String
        var canAdvance: Bool
    }

    var gameID: String
    /// Тон акцента приложения (0…1): цвет шкалы и кнопки «Следующий».
    var accentHue: Double

    /// Касание активности — обратно в игру.
    static let openURL = URL(string: "mafboard://game")!
}

/// Что делает кнопка активности. Выполняет приложение — оно задаёт `handler` при запуске.
enum GameActivityAction: Sendable {
    case next
    case toggleTimer
}

enum GameActivityActions {
    @MainActor static var handler: ((GameActivityAction, String) async -> Void)?

    @MainActor static func perform(_ action: GameActivityAction, gameID: String) async {
        await handler?(action, gameID)
    }
}

/// «Следующий игрок» с экрана блокировки или из Dynamic Island: приложение в фоне жмёт «Далее» и не открывается.
struct NextStepIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Следующий игрок"
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Игра") var gameID: String

    init() {}

    init(gameID: String) {
        self.gameID = gameID
    }

    func perform() async throws -> some IntentResult {
        await GameActivityActions.perform(.next, gameID: gameID)
        return .result()
    }
}

/// Пауза или старт таймера речи прямо с активности.
struct ToggleTimerIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Пауза или старт таймера"
    static var isDiscoverable: Bool { false }

    @Parameter(title: "Игра") var gameID: String

    init() {}

    init(gameID: String) {
        self.gameID = gameID
    }

    func perform() async throws -> some IntentResult {
        await GameActivityActions.perform(.toggleTimer, gameID: gameID)
        return .result()
    }
}
