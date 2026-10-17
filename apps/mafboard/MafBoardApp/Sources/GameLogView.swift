import SwiftUI
import MafBoardCore

/// «Ход игры»: что происходило по фазам — для ведущего во время игры и для разборов после.
struct GameLogView: View {
    let events: [GameEvent]
    let name: (Seat) -> String

    private var sections: [(moment: GameMoment, lines: [LogLine])] {
        var result: [(moment: GameMoment, lines: [LogLine])] = []
        for (index, event) in events.enumerated() {
            guard let line = event.logLine(id: index, name: name) else { continue }
            if let last = result.last, last.moment == event.moment {
                result[result.count - 1].lines.append(line)
            } else {
                result.append((event.moment, [line]))
            }
        }
        return result
    }

    var body: some View {
        let sections = sections
        List {
            ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                Section(section.moment.displayName) {
                    ForEach(section.lines) { line in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Image(systemName: line.icon)
                                .foregroundStyle(line.color)
                                .frame(width: 22)
                            Text(line.text)
                            Spacer(minLength: 8)
                            Text(line.time.formatted(date: .omitted, time: .shortened))
                                .font(.caption)
                                .monospacedDigit()
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
        .ambientBackground()
        .overlay {
            if sections.isEmpty {
                ContentUnavailableView("Пока пусто", systemImage: "list.bullet.rectangle",
                                       description: Text("Здесь появятся выставления, голосования, ночные ходы и фолы."))
            }
        }
        .navigationTitle("Ход игры")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct LogLine: Identifiable {
    let id: Int
    let icon: String
    let color: Color
    let text: String
    let time: Date
}

extension NightCheck {
    /// «чёрный», «красный», «шериф», «не шериф».
    var verdictText: String {
        switch checker {
        case .don: isPositive ? "шериф" : "не шериф"
        default: isPositive ? "чёрный" : "красный"
        }
    }
}

private extension GameEvent {
    /// Строка журнала. Служебные события (начало шага, очередная речь) не показываем.
    func logLine(id: Int, name: (Seat) -> String) -> LogLine? {
        func who(_ seat: Seat) -> String { "№\(seat) \(name(seat))" }
        func line(_ icon: String, _ color: Color, _ text: String) -> LogLine {
            LogLine(id: id, icon: icon, color: color, text: text, time: date)
        }
        switch kind {
        case let .nominated(candidate, by):
            return line("hand.point.up.left.fill", .accentColor, "№\(by) выставил \(who(candidate))")
        case let .nominationWithdrawn(candidate, by):
            return line("arrow.uturn.backward", .secondary, "№\(by) снял кандидатуру №\(candidate)")
        case let .votingRound(round):
            if let lift = round.liftVotes {
                return line("hand.raised.fill", .accentColor, "Поднять всех: за — \(lift)")
            }
            let votes = round.results.map { "№\($0.candidate) — \($0.votes)" }.joined(separator: ", ")
            return line("checklist", .accentColor, round.kind == .revote ? "Переголосование: \(votes)" : "Голоса: \(votes)")
        case let .votingFinished(record):
            if let skip = record.skipReason { return line("xmark.circle", .secondary, skip.displayName) }
            if record.eliminated.isEmpty { return line("equal.circle", .secondary, "По голосованию никто не выбывает") }
            let out = record.eliminated.map(who).joined(separator: ", ")
            return line("person.fill.xmark", .orange, record.isAutomatic ? "Без голосования выбывает \(out)" : "По голосованию выбывает \(out)")
        case let .shot(killer, target):
            let shooter = killer == .mafia ? "Мафия" : "Маньяк"
            let text = target.seat.map { "\(shooter) стреляет в \(who($0))" } ?? "\(shooter): промах"
            return line("scope", .red, text)
        case let .check(check):
            return line("magnifyingglass", .indigo, "\(check.checker.displayName) проверяет \(who(check.target)): \(check.verdictText)")
        case let .heal(seat):
            return line("cross.case.fill", .green, "Доктор лечит \(who(seat))")
        case let .nightResolved(report):
            if report.victims.isEmpty { return line("sunrise.fill", .orange, "Утро: ночь без жертв") }
            return line("sunrise.fill", .orange, "Утро: убит " + report.victims.map { who($0.seat) }.joined(separator: ", "))
        case let .eliminated(seat, cause):
            return line("person.fill.xmark", .red, "\(who(seat)) — \(cause.label.lowercased())")
        case let .foul(seat, total):
            return line("hand.raised.fill", .orange, "Фол \(who(seat)) — \(total)-й")
        case let .foulCancelled(seat, total):
            return line("arrow.uturn.backward", .secondary, "Снят фол \(who(seat)), осталось \(total)")
        case let .techFoul(seat, total):
            return line("exclamationmark.triangle.fill", .red, "Техфол \(who(seat)) — \(total)-й")
        case let .bigTechFoul(seat, total):
            return line("exclamationmark.octagon.fill", .red, "Большой техфол \(who(seat)) — \(total)-й")
        case let .speechHalved(seat):
            return line("timer", .orange, "\(who(seat)): 3 фола — ближайшая речь полминуты")
        case let .criticalRemovalMarked(seat, isCritical):
            return line("person.fill.xmark", .red, isCritical ? "Удаление \(who(seat)) — на критике" : "Удаление \(who(seat)) — не на критике")
        case let .sheriffClaimMarked(seat, claimed):
            return line("checkmark.shield.fill", .orange, claimed ? "\(who(seat)) вскрылся шерифом" : "Снята отметка вскрытия \(who(seat))")
        case let .bestMoveAvailable(seat):
            return line("star", .yellow, "\(who(seat)) получает право лучшего хода")
        case let .protocolRecorded(proto):
            return line("list.clipboard.fill", .accentColor, "Протокол \(who(proto.author)): " + proto.summary.lowercased())
        case let .techFoulCancelled(seat, total):
            return line("arrow.uturn.backward", .secondary, "Снят техфол \(who(seat)), осталось \(total)")
        case let .warning(seat, total):
            return line("exclamationmark.bubble", .yellow, "Предупреждение \(who(seat)) — \(total)-е")
        case let .silenced(seat):
            return line("speaker.slash.fill", .orange, "\(who(seat)) пропустит речь")
        case let .speechSkipped(seat):
            return line("speaker.slash", .secondary, "\(who(seat)) пропускает речь")
        case let .bestMove(move):
            return line("star.fill", .yellow, "Лучший ход №\(move.author): " + move.seats.map { "№\($0)" }.joined(separator: ", "))
        case let .scoreAdjustmentsSet(seat, adjustments):
            let values = adjustments.filter { $0.points != .zero }.map(\.points.signed)
            return line("plusminus.circle.fill", .accentColor, "Допбаллы \(who(seat)): " + (values.isEmpty ? "нет" : values.joined(separator: ", ")))
        case let .scoreAdjusted(adjustment):
            let sign = adjustment.points > .zero ? "+" : ""
            return line("plusminus.circle.fill", .accentColor, "Баллы \(who(adjustment.seat)): \(sign)\(adjustment.points.description)")
        case let .gameFinished(outcome):
            return line("flag.checkered", outcome.winner.dot, "\(outcome.winner.displayName). \(outcome.reason.text)")
        default:
            return nil
        }
    }
}
