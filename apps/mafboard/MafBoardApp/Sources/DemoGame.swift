#if DEBUG
import Foundation
import MafBoardCore

/// Только в отладочной сборке: аргумент запуска `-demoGame` открывает спортивную игру на 10 без входа —
/// чтобы проверить экран игры на симуляторе. Игра живёт в памяти и никуда не сохраняется.
///
/// Скриншоты App Store: `-demoMode -screenshot <сцена>` (см. `ScreenshotScene`) — тот же стол
/// с вымышленными игроками в нужный момент игры, а для списков — засеянная история демо-режима.
@MainActor
enum DemoGame {
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("-demoGame") || ScreenshotScene.requested?.isGame == true
    }

    /// Вымышленные игроки — одни и те же во всех играх, чтобы складывался рейтинг.
    static let players = ["Феникс", "Ворон", "Шерлок", "Лиса", "Барон", "Мадам", "Гном", "Сова", "Тень", "Профессор"]
        .map { PlayerProfile(nickname: $0) }

    /// Мафия — 3 и 8, дон — 6, шериф — 4.
    static let roles: [Role] = [.civilian, .civilian, .mafia, .sheriff, .civilian, .don, .civilian, .mafia, .civilian, .civilian]

    static func make() -> GameController? {
        guard var session = session(roles: roles) else { return nil }
        if let scene = ScreenshotScene.requested { scene.play(&session) }
        return GameController(session: session, players: players)
    }

    static func session(roles: [Role], seriesID: SeriesID? = nil, at date: Date = .now) -> GameSession? {
        guard let setup = try? GameSetup(format: .rating, ruleset: .sport, players: players.map(\.id), roles: roles,
                                         seriesID: seriesID, createdAt: date) else { return nil }
        return GameSession(setup: setup)
    }
}

/// Момент игры или экран списка для скриншота.
enum ScreenshotScene: String {
    /// День: говорит №4, за столом выставлены №8 и №3, у двоих фолы.
    case speech
    /// Голосование по выставленным.
    case voting
    /// Ночь после голосования: ход мафии.
    case night
    /// Итоги законченной игры.
    case results
    /// Главный экран: вечер рейтинга и история игр.
    case games
    /// Вкладка «Рейтинг» за месяц.
    case standings

    @MainActor static let requested: ScreenshotScene? = {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-screenshot"), args.indices.contains(index + 1) else { return nil }
        return ScreenshotScene(rawValue: args[index + 1])
    }()

    var isGame: Bool { [.speech, .voting, .night, .results].contains(self) }

    /// Довести игру до нужного момента. Недопустимый ход (правила поменялись) просто пропускается.
    func play(_ session: inout GameSession) {
        var clock = session.setup.createdAt
        func run(_ actions: GameAction...) {
            for action in actions {
                clock += 20
                try? session.perform(action, at: clock)
            }
        }
        func advance(while condition: (GameState) -> Bool) {
            for _ in 0..<200 where condition(session.state) { run(.advance) }
        }
        func isSpeeches(_ state: GameState) -> Bool {
            if case .day(.speeches) = state.phase { true } else { false }
        }

        advance { !isSpeeches($0) }
        let nominations: [Seat: Seat] = [1: 8, 2: 3]
        while isSpeeches(session.state), let speaker = session.state.currentSpeaker {
            if self == .speech, speaker == 4 {
                run(.foul(2), .foul(7), .foul(2))
                return
            }
            if let candidate = nominations[speaker] { run(.nominate(candidate: candidate, by: speaker)) }
            run(.advance)
        }
        if self == .voting { return }

        run(.submitBallot(.handCount([CandidateVotes(8, votes: 6), CandidateVotes(3, votes: 3)])))
        advance { state in
            if case .night = state.phase { false } else { !state.isFinished }
        }
        if self == .night { return }

        run(.night(.shot(1)), .night(.check(8)), .night(.check(6)))
        run(.recordBestMove([3, 6, 8]))
        run(.declareOutcome(.red, note: nil))
    }

    /// История демо-режима для экранов списков: вечер рейтинга из нескольких игр.
    @MainActor func seed(_ library: GameLibrary) {
        guard !isGame, library.history.isEmpty else { return }
        let start = Date.now.addingTimeInterval(-4 * 3600)
        let evening = library.startEvening(format: .rating, variant: .sport)
        let outcomes: [Winner] = [.red, .black, .red, .red, .black]
        for (index, winner) in outcomes.enumerated() {
            let shift = index * 2
            let roles = Array(DemoGame.roles[shift...] + DemoGame.roles[..<shift])
            let date = start.addingTimeInterval(Double(index) * 2700)
            guard var session = DemoGame.session(roles: roles, seriesID: evening.id, at: date) else { continue }
            let mafia = roles.indices.filter { roles[$0].team == .black }.map { Seat($0 + 1) }
            let firstRed = roles.indices.first { roles[$0].team == .red }.map { Seat($0 + 1) } ?? 1
            var clock = date
            func run(_ action: GameAction) {
                clock += 60
                try? session.perform(action, at: clock)
            }
            for _ in 0..<200 {
                if case .night = session.state.phase { break }
                run(.advance)
            }
            run(.night(.shot(firstRed)))
            run(.night(.skip))
            run(.night(.skip))
            run(.recordBestMove(Array(mafia.prefix(3))))
            run(.declareOutcome(winner, note: nil))
            library.seedFinished(session, players: DemoGame.players)
        }
    }
}
#endif
