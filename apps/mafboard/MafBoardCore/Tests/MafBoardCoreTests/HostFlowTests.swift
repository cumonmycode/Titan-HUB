import Foundation
import Testing
@testable import MafBoardCore

/// Правки ведущего: время за фолы, порядок заключительной минуты, промахи, проверки выбывших,
/// решающее удаление и техфолы после игры.
@Suite("Ход игры у ведущего")
struct HostFlowTests {
    // Стол из `Fixture`: мафия — 3 и 8, дон — 6, шериф — 4.

    // MARK: Дополнительное время

    @Test("+30 секунд — только за 2 фола: время речи растёт, на следующей речи — обычное")
    func extraTimeCostsTwoFouls() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        #expect(session.step == .speech(1))
        try session.run(.extraTime(1))
        #expect(session.state.seat(1)?.fouls == 2)
        #expect(session.state.timerSeconds == 90)
        try session.advance()
        #expect(session.state.timerSeconds == 60)
    }

    @Test("С одним фолом время дают (станет 3), с двумя — нет (стало бы 4)")
    func extraTimeLimitedByFouls() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.foul(1))
        #expect(session.state.canTakeExtraTime(1))
        try session.run(.extraTime(1))
        #expect(session.state.seat(1)?.fouls == 3)
        #expect(session.state.seat(1)?.halvesNextSpeech == true)

        try session.run(.foul(2), .foul(2), .advance)
        #expect(session.step == .speech(2))
        #expect(!session.state.canTakeExtraTime(2))
        #expect(throws: GameError.tooManyFoulsForExtraTime(2, max: 3)) { try session.perform(.extraTime(2)) }
    }

    @Test("Время берёт только говорящий — не на договорке и не за другого")
    func extraTimeOnlyForSpeaker() throws {
        var session = try Fixture.session()
        #expect(throws: GameError.notAllowedNow(.extraTimeOnlyForSpeaker(current: nil))) {
            try session.perform(.extraTime(1))
        }
        try session.advance(times: 2)
        #expect(throws: GameError.notAllowedNow(.extraTimeOnlyForSpeaker(current: 1))) {
            try session.perform(.extraTime(2))
        }
    }

    @Test("Фолы, взятые за время, не снять на той же речи — только отменой «+30»")
    func extraTimeFoulsCannotBeCancelled() throws {
        var session = try Fixture.session()
        try session.advance(times: 2)
        try session.run(.extraTime(1))
        #expect(throws: GameError.extraTimeFoulsLocked(1)) { try session.perform(.cancelFoul(1)) }
        try session.undo()
        #expect(session.state.seat(1)?.fouls == 0)
        #expect(session.state.timerSeconds == 60)
        // На следующей речи прежние фолы снимаются как обычно.
        try session.run(.extraTime(1), .advance, .cancelFoul(1))
        #expect(session.state.seat(1)?.fouls == 1)
    }

    @Test("Правила, сохранённые до новых настроек, читаются: +30 и решающее удаление — по стандарту")
    func legacyRulesetDecodes() throws {
        var json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(Ruleset.sport)) as? [String: Any])
        json["farewell"] = nil
        var discipline = try #require(json["discipline"] as? [String: Any])
        discipline["extraTime"] = nil
        discipline["detectsDecisiveRemoval"] = nil
        json["discipline"] = discipline
        let legacy = try JSONDecoder().decode(Ruleset.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(legacy.farewell == nil)
        #expect(legacy.discipline.extraTimeRule == .standard)

        var removal = try Fixture.session(ruleset: legacy)
        try removal.run(.eliminateByHost(1, note: nil), .eliminateByHost(2, note: nil), .disqualify(5, note: nil))
        #expect(removal.state.seat(5)?.isCriticalRemoval == true)

        var session = try Fixture.session(ruleset: legacy)
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(7)), .night(.skip), .night(.skip))
        #expect(session.step == .farewell(7))
        try session.run(.extraTime(7))
        #expect(session.state.timerSeconds == 90)
    }

    @Test("Выбывший на заключительной речи тоже берёт время фолами")
    func extraTimeOnFarewell() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip), .advance)
        #expect(session.step == .farewell(1))
        try session.run(.extraTime(1))
        #expect(session.state.seat(1)?.fouls == 2)
        #expect(session.state.timerSeconds == 90)
    }

    // MARK: Заключительная минута

    @Test("Первый убитый: лучший ход → речь → протокол → говорит следующий")
    func firstKilledFarewellOrder() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        #expect(session.step == .farewellBestMove(1))
        #expect(session.state.timerSeconds == nil)
        #expect(session.state.currentSpeaker == 1)

        try session.run(.recordBestMove([3, 6]))
        #expect(session.step == .farewell(1))
        #expect(session.state.timerSeconds == 60)

        try session.advance()
        #expect(session.step == .farewellProtocol(1))
        try session.run(.recordProtocol(ColorProtocol(author: 1, blacks: [3, 6], reds: [2])))
        #expect(session.step == .speech(2))
    }

    @Test("«Далее» без ЛХ ведёт к речи, без протокола — к следующему игроку")
    func farewellStepsCanBeSkipped() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        try session.advance()
        #expect(session.step == .farewell(1))
        #expect(session.state.awaitsBestMove(from: 1))
        try session.advance(times: 2)
        #expect(session.step == .speech(2))
        #expect(session.state.protocols.isEmpty)
    }

    @Test("Протокол, оставленный во время речи, отдельным шагом не просят")
    func protocolRecordedDuringSpeechSkipsStep() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip), .advance)
        try session.run(.recordProtocol(ColorProtocol(author: 1, blacks: [3], reds: [])), .advance)
        #expect(session.step == .speech(2))
    }

    @Test("Заголосованный после речи протокол отдельным шагом не оставляет")
    func votedOutHasNoProtocolStep() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(nil)), .night(.skip), .night(.skip))
        try session.speak(nominating: [(9, 2)])
        // Одна кандидатура в день 2 уходит без голосования, стол полный — у неё «слом» и ЛХ.
        #expect(session.step == .farewellBestMove(9))
        try session.advance()
        #expect(session.step == .farewell(9))
        try session.advance()
        #expect(session.state.isDusk)
    }

    @Test("Игры по старым правилам: ЛХ и протокол во время речи, без отдельных шагов")
    func legacyRulesKeepSingleFarewellStep() throws {
        var rules = Ruleset.sport
        rules.farewell = nil
        var session = try Fixture.session(ruleset: rules)
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip))
        #expect(session.step == .farewell(1))
        try session.run(.recordBestMove([3]))
        #expect(session.step == .farewell(1))
        try session.advance()
        #expect(session.step == .speech(2))
    }

    // MARK: Ночь

    @Test("Промах с подробностями: кто куда стрелял, не названные — не стреляли")
    func detailedMiss() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.miss([MissedShot(3, at: 5), MissedShot(6, at: 7)])), .night(.skip), .night(.skip))
        let night = try #require(session.state.nights.first)
        #expect(night.victims.isEmpty)
        #expect(night.actions.mafiaShot == .miss)
        #expect(night.actions.missedShots == [MissedShot(3, at: 5), MissedShot(6, at: 7), MissedShot(8, at: nil)])
        #expect(session.state.events.contains { $0.kind == .missedShots(night.actions.missedShots ?? []) })
    }

    @Test("Промах проверяется: все в одного — это выстрел; стреляет только мафия")
    func missValidation() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        #expect(throws: GameError.invalidMiss(.sameTarget(5))) {
            try session.perform(.night(.miss([MissedShot(3, at: 5), MissedShot(6, at: 5), MissedShot(8, at: 5)])))
        }
        #expect(throws: GameError.invalidMiss(.notShooter(1))) {
            try session.perform(.night(.miss([MissedShot(1, at: 5)])))
        }
        #expect(throws: GameError.invalidMiss(.duplicateShooter(3))) {
            try session.perform(.night(.miss([MissedShot(3, at: 5), MissedShot(3, at: 7)])))
        }
    }

    @Test("Дон и шериф проверяют и тех, кто уже покинул стол")
    func checksOfEliminatedPlayers() throws {
        var session = try Fixture.session()
        try session.run(.disqualify(9, note: nil))
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(nil)), .night(.check(9)), .night(.check(9)))
        let checks = try #require(session.state.nights.first?.actions.checks)
        #expect(checks.map(\.target) == [9, 9])
        #expect(checks.map(\.isPositive) == [false, false])
    }

    // MARK: Решающее удаление

    @Test("Красный удалён, когда без него город проигрывает, — штраф −1; без этого — −0.6")
    func decisiveRedRemoval() throws {
        // 8 за столом, 3 чёрных: без красного ошибка в голосовании или выстрел мафии решают игру.
        var decisive = try Fixture.session()
        try decisive.run(.eliminateByHost(1, note: nil), .eliminateByHost(2, note: nil), .disqualify(5, note: nil))
        #expect(decisive.state.seat(5)?.isCriticalRemoval == true)
        try decisive.run(.declareOutcome(.red, note: nil))
        let score = try #require(GameScorer.score(GameRecord(session: decisive)).first { $0.seat == 5 })
        #expect(score.components.map(\.kind) == [.result(.win), .criticalRemoval])
        #expect(score.total == 0)

        // 9 за столом — ещё не решающее.
        var ordinary = try Fixture.session()
        try ordinary.run(.eliminateByHost(1, note: nil), .disqualify(5, note: nil))
        #expect(ordinary.state.seat(5)?.isCriticalRemoval == false)
    }

    @Test("Чёрный удалён последним — удаление решающее, и отметка не видна в журнале")
    func decisiveBlackRemoval() throws {
        var session = try Fixture.session()
        try session.run(.eliminateByHost(3, note: nil), .disqualify(8, note: nil))
        #expect(session.state.seat(8)?.isCriticalRemoval == false)
        try session.run(.disqualify(6, note: nil))
        #expect(session.state.seat(6)?.isCriticalRemoval == true)
        #expect(session.state.outcome?.winner == .red)
        #expect(!session.state.events.contains { if case .criticalRemovalMarked = $0.kind { true } else { false } })
    }

    // MARK: Итоги

    @Test("После игры техфол ставят и снимают любому игроку — только штраф, без удаления")
    func techFoulAfterGame() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(1)), .night(.skip), .night(.skip), .declareOutcome(.red, note: nil))
        try session.run(.techFoul(1), .bigTechFoul(1), .techFoul(2), .techFoul(2))
        #expect(session.state.seat(1)?.techFoulKinds == [.ordinary, .big])
        #expect(session.state.isAlive(2))
        try session.run(.cancelTechFoul(2))

        // После игры техфол не удаляет — и не удваивается: МТФ −0.3 + БТФ −0.6.
        let scores = GameScorer.score(try GameRecord(session: session))
        #expect(scores.first { $0.seat == 1 }?.total == 0.1)
        #expect(scores.first { $0.seat == 2 }?.total == 0.7)
    }

    @Test("Лучший ход и протокол чёрного игрока баллов не дают")
    func blackBestMoveAndProtocolNotScored() throws {
        var session = try Fixture.session()
        try session.advance(until: \.isNight)
        try session.run(.night(.shot(3)), .night(.skip), .night(.skip))
        try session.run(.recordBestMove([6, 8]), .advance)
        try session.run(.recordProtocol(ColorProtocol(author: 3, blacks: [6, 8], reds: [1])))
        try session.run(.declareOutcome(.black, note: nil))
        let record = try GameRecord(session: session)
        let proto = try #require(record.protocols.first)
        #expect(GameScorer.protocolPoints(proto, seats: record.seats, nights: record.nights, policy: record.setup.scoring) == nil)
        let score = try #require(GameScorer.score(record).first { $0.seat == 3 })
        #expect(score.components.map(\.kind) == [.result(.win)])
    }
}
