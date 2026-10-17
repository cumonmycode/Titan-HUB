import Foundation
import MafBoardCore

// MARK: - Тексты игры: шаги, выбывание, итог и расшифровка баллов (термины — по правилам ФСМ)

extension CurrentStep {
    func title(in state: GameState) -> String {
        switch self {
        case let .timed(step, speaker):
            speaker.map { "\(step.kind.displayName): №\($0)" } ?? step.kind.displayName
        case let .farewell(seat): "Заключительная речь №\(seat)"
        case let .speech(seat): "Речь №\(seat)"
        case let .ballot(_, kind):
            switch kind {
            case .main: "Голосование"
            case .revote: "Переголосование"
            case .lift: "Подъём"
            }
        case let .tieSpeech(seat): "Оправдание №\(seat)"
        case .liftBallot: "Голосование за подъём"
        case .dusk: state.phase == .day(.dusk) ? "Наступает ночь" : "Наступает день"
        case let .night(step): step.displayName
        case .finished: state.outcome?.winner.displayName ?? "Игра окончена"
        }
    }
}

extension EliminationCause {
    var label: String {
        switch self {
        case let .killed(killer): killer == .mafia ? "Убит мафией" : "Убит маньяком"
        case .votedOut: "Заголосован"
        case .removed(.fouls): "Удалён за фолы"
        case .removed(.techFouls): "Удалён за техфолы"
        case .removed(.disqualified): "Дисквалифицирован"
        case .hostDecision: "Выбыл"
        }
    }
}

extension GameOutcome.Reason {
    var text: String {
        switch self {
        case .allBlackEliminated: "Все чёрные выбыли"
        case .blackReachedParity: "Чёрных не меньше, чем красных"
        case let .declaredByHost(note): note ?? "Итог объявил ведущий"
        case let .quietNights(count): "\(count) ночи подряд никто не покидал стол"
        case let .forfeit(seat, note): "ППК: нарушение игрока №\(seat)" + (note.map { " — \($0)" } ?? "")
        }
    }
}

extension Points {
    /// «+0.3», «−0.6», «0» — со знаком, минус типографский.
    var signed: String {
        self > .zero ? "+\(description)" : description.replacingOccurrences(of: "-", with: "−")
    }
}

extension ScoreComponent {
    /// «ЛХ (2) +0.3», «Техфолы ×2 −0.6». `nil` — баллы за результат, они видны отдельно.
    var label: String? {
        let title: String
        switch kind {
        case .result: return nil
        case let .bestMove(guessed): title = "ЛХ (\(guessed))"
        case .removal: title = "Удаление"
        case .criticalRemoval: title = "Удаление на критике"
        case let .techFouls(count): title = count == 1 ? "Техфол" : "Техфолы ×\(count)"
        case .forfeit: title = "ППК"
        case .doubleSplit: title = "Двойное деление"
        case let .adjustment(note): title = note
        case let .colorProtocol(firstKilled): title = firstKilled ? "Протокол ПУ" : "Протокол"
        }
        return "\(title) \(points.signed)"
    }
}

extension PlayerGameScore {
    /// «ЛХ (2) +0.3 · Техфол −0.3». Пусто, если баллы только за результат.
    var breakdown: String {
        components.compactMap(\.label).joined(separator: " · ")
    }
}

extension ColorProtocol {
    /// «Чёрные №3, №6 · красные №2 · шериф №4».
    var summary: String {
        func seats(_ list: [Seat]) -> String { list.sorted().map { "№\($0)" }.joined(separator: ", ") }
        var parts: [String] = []
        if !blacks.isEmpty { parts.append("чёрные \(seats(blacks))") }
        if !reds.isEmpty { parts.append("красные \(seats(reds))") }
        if let version { parts.append("шериф №\(version.sheriff) (версия \(version.value.description))") }
        return parts.joined(separator: " · ").capitalizedFirst
    }
}

private extension String {
    var capitalizedFirst: String { prefix(1).uppercased() + dropFirst() }
}
