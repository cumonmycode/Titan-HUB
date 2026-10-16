import Foundation
import Testing
@testable import MafBoardCore

enum Fixture {
    static let createdAt = Date(timeIntervalSince1970: 1_800_000_000)

    /// Спортивный стол: мафия — 3 и 8, дон — 6, шериф — 4.
    static let sportRoles: [Role] = [
        .civilian, .civilian, .mafia, .sheriff, .civilian, .don, .civilian, .mafia, .civilian, .civilian,
    ]

    /// Городской стол на 10: доктор — 2, мафия — 3 и 8, шериф — 4, дон — 6.
    static let cityRoles: [Role] = [
        .civilian, .doctor, .mafia, .sheriff, .civilian, .don, .civilian, .mafia, .civilian, .civilian,
    ]

    static func players(_ count: Int) -> [PlayerID] {
        (0..<count).map { _ in PlayerID() }
    }

    static func session(
        ruleset: Ruleset = .sport,
        roles: [Role] = sportRoles,
        format: CompetitionFormat = .rating,
        players: [PlayerID]? = nil,
        seriesID: SeriesID? = nil,
        createdAt: Date = createdAt
    ) throws -> GameSession {
        let setup = try GameSetup(
            format: format,
            ruleset: ruleset,
            players: players ?? Self.players(roles.count),
            roles: roles,
            seriesID: seriesID,
            createdAt: createdAt
        )
        return GameSession(setup: setup)
    }
}

extension GameSession {
    var step: CurrentStep { state.currentStep }

    mutating func run(_ actions: GameAction...) throws {
        for action in actions {
            try perform(action)
        }
    }

    mutating func advance(times: Int = 1) throws {
        for _ in 0..<times {
            try perform(.advance)
        }
    }

    /// Жмёт «Далее», пока не выполнится условие.
    mutating func advance(until condition: (GameState) -> Bool) throws {
        var attempts = 0
        while !condition(state) {
            try perform(.advance)
            attempts += 1
            if attempts > 200 {
                Issue.record("advance(until:) не дошёл до нужного состояния")
                return
            }
        }
    }
}

extension GameState {
    var isNight: Bool {
        if case .night = phase { true } else { false }
    }

    var isDusk: Bool { phase == .day(.dusk) }

    var votingSession: VotingSession? {
        if case let .day(.voting(session)) = phase { session } else { nil }
    }

    var nightSteps: [NightStep] {
        if case let .night(progress) = phase { progress.steps } else { [] }
    }
}
