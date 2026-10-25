#if DEBUG
import Foundation
import MafBoardCore

/// Только в отладочной сборке: аргумент запуска `-demoGame` открывает спортивную игру на 10 без входа —
/// чтобы проверить экран игры на симуляторе. Игра живёт в памяти и никуда не сохраняется.
@MainActor
enum DemoGame {
    static var isRequested: Bool { ProcessInfo.processInfo.arguments.contains("-demoGame") }

    /// Мафия — 3 и 8, дон — 6, шериф — 4.
    static func make() -> GameController? {
        let names = ["Lirica", "BITTIR", "Geralt", "Минахор", "Касатка", "Гость", "Тень", "Сова", "Борода", "Кай"]
        let players = names.map { PlayerProfile(nickname: $0) }
        let roles: [Role] = [.civilian, .civilian, .mafia, .sheriff, .civilian, .don, .civilian, .mafia, .civilian, .civilian]
        guard let setup = try? GameSetup(format: .rating, ruleset: .sport, players: players.map(\.id), roles: roles) else {
            return nil
        }
        return GameController(session: GameSession(setup: setup), players: players)
    }
}
#endif
