import Foundation
import Testing
@testable import MafBoardCore

@Suite("Рассадка и составы")
struct SetupTests {
    @Test("Спортивный состав: 1 дон, 2 мафии, 1 шериф, 6 мирных")
    func sportStandardRoles() throws {
        let roles = try Ruleset.sport.standardRoles(playerCount: 10)
        let counts = Ruleset.counts(of: roles)
        #expect(counts == [.don: 1, .mafia: 2, .sheriff: 1, .civilian: 6])
    }

    @Test("Спортивная мафия требует ровно 10 игроков")
    func sportRequiresTenPlayers() {
        #expect(throws: GameError.invalidSetup(.playerCount(.sport, allowed: 10...10))) {
            try Ruleset.sport.standardRoles(playerCount: 9)
        }
    }

    @Test("Уникальная роль не может быть у двух игроков")
    func uniqueRoleOnlyOnce() {
        var roles = Fixture.cityRoles
        roles[0] = .sheriff
        #expect(throws: GameError.invalidSetup(.duplicateUniqueRole(.sheriff))) {
            try Ruleset.city.validate(roles: roles)
        }
    }

    @Test("Спортивная мафия не допускает городских ролей")
    func sportRejectsCityRoles() {
        var roles = Fixture.sportRoles
        roles[0] = .doctor
        #expect(throws: GameError.invalidSetup(.sportComposition)) {
            try Ruleset.sport.validate(roles: roles)
        }
    }

    @Test("Городская на 13: появляются маньяк и камикадзе")
    func cityThirteenPlayers() throws {
        let roles = try Ruleset.city.standardRoles(playerCount: 13)
        #expect(roles.count == 13)
        #expect(roles.contains(.maniac))
        #expect(roles.contains(.kamikaze))
        try Ruleset.city.validate(roles: roles)
    }

    @Test("Городская на 17+: базовый набор плюс выбранные роли")
    func cityOptionalRoles() throws {
        let roles = try Ruleset.city.standardRoles(playerCount: 17, optionalRoles: [.detective, .lawyer])
        let counts = Ruleset.counts(of: roles)
        #expect(roles.count == 17)
        #expect(counts[.detective] == 1)
        #expect(counts[.lawyer] == 1)
        #expect(counts[.civilian] == 5)
    }

    @Test("Один игрок не может сидеть на двух местах")
    func duplicatePlayerRejected() {
        var players = Fixture.players(10)
        players[9] = players[0]
        #expect(throws: GameError.invalidSetup(.duplicatePlayer)) {
            try GameSetup(format: .funky, ruleset: .sport, players: players, roles: Fixture.sportRoles)
        }
    }

    @Test("Жеребьёвка воспроизводима по зерну и сажает всех игроков")
    func dealtSetupIsDeterministic() throws {
        let players = Fixture.players(10)
        var first = SeededRandomNumberGenerator(seed: 42)
        var second = SeededRandomNumberGenerator(seed: 42)

        let a = try GameSetup.dealt(format: .rating, ruleset: .sport, players: players, using: &first, createdAt: Fixture.createdAt)
        let b = try GameSetup.dealt(format: .rating, ruleset: .sport, players: players, using: &second, createdAt: Fixture.createdAt)

        #expect(a.seats == b.seats)
        #expect(Set(a.seats.map(\.playerID)) == Set(players))
        #expect(Ruleset.counts(of: a.seats.map(\.role)) == [.don: 1, .mafia: 2, .sheriff: 1, .civilian: 6])
    }

    @Test("Игра серии берёт её формат, правила и систему баллов")
    func setupFromSeries() throws {
        var scoring = ScoringPolicy.standard
        scoring.win = 2
        let series = Series(title: "Миникап, октябрь", format: .miniCup, variant: .city, scoring: scoring)
        let setup = try GameSetup(series: series, players: Fixture.players(10), roles: Fixture.cityRoles)

        #expect(setup.format == .miniCup)
        #expect(setup.variant == .city)
        #expect(setup.seriesID == series.id)
        #expect(setup.scoring.win == 2)
    }
}
