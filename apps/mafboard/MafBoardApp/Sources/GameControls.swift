import SwiftUI
import MafBoardCore

// MARK: - Шапка шага с таймером

struct StepHeader: View {
    let game: GameController

    var body: some View {
        VStack(spacing: 8) {
            Text(game.state.currentStep.title(in: game.state))
                .font(.title2.bold())
                .multilineTextAlignment(.center)
            if let speaker = game.state.currentSpeaker {
                Text(game.name(of: speaker)).foregroundStyle(.secondary)
            }
            if let timer = game.countdown {
                TimerView(timer: timer, game: game)
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 24))
    }
}

private struct TimerView: View {
    let timer: Countdown
    let game: GameController

    var body: some View {
        VStack(spacing: 8) {
            TimelineView(.periodic(from: .now, by: 0.25)) { context in
                let remaining = timer.remaining(at: context.date)
                Text(Duration.seconds(remaining.rounded(.up)).formatted(.time(pattern: .minuteSecond)))
                    .font(.system(size: 64, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(remaining <= 10 ? .red : .primary)
                    .contentTransition(.numericText(countsDown: true))
            }
            HStack(spacing: 12) {
                Button(timer.isRunning ? "Пауза" : "Старт", systemImage: timer.isRunning ? "pause.fill" : "play.fill") {
                    game.toggleTimer()
                }
                Button("+30 с", systemImage: "plus") { game.extendTimer() }
                Button("Сброс", systemImage: "arrow.counterclockwise") { game.restartTimer() }
            }
            .buttonStyle(.glass)
            .labelStyle(.iconOnly)
        }
    }
}

// MARK: - Управление текущим шагом

struct StepControls: View {
    let game: GameController

    var body: some View {
        switch game.state.currentStep {
        case let .speech(speaker) where game.state.ruleset.day.candidateSource == .nominations:
            NominationPanel(game: game, speaker: speaker)
        case let .ballot(candidates, _):
            HandCountBallot(game: game, candidates: candidates)
                .id(candidates)
        case let .liftBallot(candidates):
            LiftBallot(game: game, candidates: candidates)
        case let .night(step):
            NightPanel(game: game, step: step)
        case .finished:
            if let record = game.record {
                ResultsView(game: game, record: record)
            }
        default:
            EmptyView()
        }
    }
}

private struct NominationPanel: View {
    let game: GameController
    let speaker: Seat

    private var nominations: [Nomination] { game.state.nominations }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if nominations.isEmpty {
                Text("Кандидатур нет. Нажмите на номер игрока, чтобы выставить его от №\(speaker).")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Text("Выставлены").font(.headline)
                ForEach(nominations, id: \.by) { nomination in
                    HStack {
                        Text("№\(nomination.candidate) \(game.name(of: nomination.candidate))")
                        Spacer()
                        Text("от №\(nomination.by)").foregroundStyle(.secondary)
                        Button("Снять", systemImage: "xmark.circle.fill", role: .destructive) {
                            game.perform(.withdrawNomination(by: nomination.by))
                        }
                        .labelStyle(.iconOnly)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}

/// Голоса «по рукам». Если по правилам воздержавшиеся голосуют за последнего — его число считается само.
private struct HandCountBallot: View {
    let game: GameController
    let candidates: [Seat]
    @State private var votes: [Seat: Int] = [:]

    private var voters: Int { game.state.aliveSeats.count }
    private var autoLast: Bool { game.state.ruleset.voting.abstainersVoteForLastCandidate }
    private var editable: [Seat] { autoLast ? Array(candidates.dropLast()) : candidates }
    private var given: Int { editable.reduce(0) { $0 + votes[$1, default: 0] } }

    var body: some View {
        VStack(spacing: 8) {
            ForEach(editable, id: \.self) { candidate in
                Stepper(value: binding(for: candidate), in: 0...max(0, voters - given + votes[candidate, default: 0])) {
                    Text("№\(candidate) \(game.name(of: candidate)): \(votes[candidate, default: 0])")
                }
            }
            if autoLast, let last = candidates.last {
                LabeledContent("№\(last) \(game.name(of: last))", value: "\(voters - given)")
                Text("Не проголосовавшие уходят последней кандидатуре").font(.footnote).foregroundStyle(.secondary)
            }
            Button("Подсчитать", systemImage: "checkmark") {
                var counts = editable.map { CandidateVotes($0, votes: votes[$0, default: 0]) }
                if autoLast, let last = candidates.last {
                    counts.append(CandidateVotes(last, votes: voters - given))
                }
                game.perform(.submitBallot(.handCount(counts)))
            }
            .buttonStyle(.glassProminent)
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }

    private func binding(for candidate: Seat) -> Binding<Int> {
        Binding(get: { votes[candidate, default: 0] }, set: { votes[candidate] = $0 })
    }
}

private struct LiftBallot: View {
    let game: GameController
    let candidates: [Seat]
    @State private var count = 0

    var body: some View {
        VStack(spacing: 8) {
            Text("Поднять всех: " + candidates.map { "№\($0)" }.joined(separator: ", "))
            Stepper("«За»: \(count) из \(game.state.aliveSeats.count)", value: $count, in: 0...game.state.aliveSeats.count)
            Button("Подсчитать", systemImage: "checkmark") { game.perform(.submitBallot(.liftCount(count))) }
                .buttonStyle(.glassProminent)
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}

private struct NightPanel: View {
    let game: GameController
    let step: NightStep

    var body: some View {
        VStack(spacing: 8) {
            Text("Нажмите на номер игрока").foregroundStyle(.secondary)
            HStack {
                if step.killer != nil {
                    Button("Промах", systemImage: "scope") { game.perform(.night(.shot(nil))) }
                }
                Button("Пропустить", systemImage: "forward") { game.perform(.night(.skip)) }
            }
            .buttonStyle(.glass)
        }
    }
}

// MARK: - Стол

struct SeatGrid: View {
    let game: GameController

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
            ForEach(game.state.seats) { seat in
                SeatTile(game: game, seat: seat)
            }
        }
    }
}

private struct SeatTile: View {
    let game: GameController
    let seat: SeatState

    /// Основное действие по нажатию на место в текущем шаге (выстрел, проверка, выставление).
    private var primaryAction: GameAction? {
        guard seat.isAlive else { return nil }
        switch game.state.currentStep {
        case let .night(step):
            switch step {
            case .mafiaShot, .maniacShot: return .night(.shot(seat.seat))
            case .donCheck, .sheriffCheck: return .night(.check(seat.seat))
            case .doctorHeal: return .night(.heal(seat.seat))
            }
        case let .speech(speaker) where game.state.ruleset.day.candidateSource == .nominations:
            return .nominate(candidate: seat.seat, by: speaker)
        default:
            return nil
        }
    }

    var body: some View {
        if let primaryAction {
            Button { game.perform(primaryAction) } label: { tile }
                .buttonStyle(.plain)
                .contextMenu { discipline }
        } else {
            Menu { discipline } label: { tile }
                .buttonStyle(.plain)
        }
    }

    private var tile: some View {
        VStack(spacing: 4) {
            Text("\(seat.seat.number)").font(.title.bold()).monospacedDigit()
            Text(game.name(of: seat.seat)).font(.caption).lineLimit(1)
            if game.showsRoles {
                Text(seat.role.displayName)
                    .font(.caption2.bold())
                    .foregroundStyle(seat.team == .black ? .red : .blue)
            }
            if let elimination = seat.elimination {
                Text(elimination.cause.label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            } else {
                FoulDots(fouls: seat.fouls, techFouls: seat.techFouls, warnings: seat.warnings)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 96)
        .padding(6)
        .opacity(seat.isAlive ? 1 : 0.4)
        .glassEffect(isHighlighted ? .regular.tint(.red.opacity(0.35)).interactive() : .regular.interactive(), in: .rect(cornerRadius: 18))
    }

    private var isHighlighted: Bool {
        game.state.currentSpeaker == seat.seat
            || game.state.nominations.contains { $0.candidate == seat.seat }
    }

    @ViewBuilder
    private var discipline: some View {
        let number = seat.seat
        Button("Фол", systemImage: "hand.raised") { game.perform(.foul(number)) }
        Button("Снять фол", systemImage: "hand.raised.slash") { game.perform(.cancelFoul(number)) }
        Button("Техфол", systemImage: "exclamationmark.triangle") { game.perform(.techFoul(number)) }
        Button("Снять техфол", systemImage: "xmark.octagon") { game.perform(.cancelTechFoul(number)) }
        Button("Предупреждение", systemImage: "exclamationmark.bubble") { game.perform(.warning(number)) }
        Divider()
        Button("Выбыл по решению ведущего", systemImage: "person.fill.xmark") {
            game.perform(.eliminateByHost(number, note: nil))
        }
        Button("Дисквалифицировать", systemImage: "nosign", role: .destructive) {
            game.perform(.disqualify(number, note: nil))
        }
    }
}

private struct FoulDots: View {
    let fouls: Int
    let techFouls: Int
    let warnings: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<fouls, id: \.self) { _ in Circle().fill(.orange).frame(width: 7, height: 7) }
            ForEach(0..<techFouls, id: \.self) { _ in Circle().fill(.red).frame(width: 7, height: 7) }
            ForEach(0..<warnings, id: \.self) { _ in Circle().stroke(.yellow, lineWidth: 1.5).frame(width: 7, height: 7) }
        }
        .frame(height: 9)
    }
}

// MARK: - Лучший ход

struct BestMoveSheet: View {
    let game: GameController
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<Seat> = []

    private var author: Seat? { game.state.bestMoveAuthor }
    private var limit: Int { game.state.ruleset.bestMove.maxSeats(playerCount: game.state.seats.count) }

    var body: some View {
        NavigationStack {
            List(game.state.seats.map(\.seat).filter { $0 != author }, id: \.self) { seat in
                Button {
                    if selected.contains(seat) {
                        selected.remove(seat)
                    } else if selected.count < limit {
                        selected.insert(seat)
                    }
                } label: {
                    HStack {
                        Text("№\(seat) \(game.name(of: seat))")
                        Spacer()
                        if selected.contains(seat) { Image(systemName: "checkmark") }
                    }
                }
            }
            .navigationTitle("Лучший ход: до \(limit)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") {
                        game.perform(.recordBestMove(selected.sorted()))
                        dismiss()
                    }
                    .disabled(selected.isEmpty)
                }
            }
        }
    }
}

// MARK: - Итоги

private struct ResultsView: View {
    let game: GameController
    let record: GameRecord

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(record.outcome.winner.displayName).font(.title.bold())
            ForEach(GameScorer.score(record)) { score in
                HStack {
                    Text("\(score.seat.number)").monospacedDigit().frame(width: 28, alignment: .trailing)
                    VStack(alignment: .leading) {
                        Text(game.name(of: score.seat))
                        Text(score.role.displayName).font(.caption).foregroundStyle(score.role.team == .black ? .red : .blue)
                    }
                    Spacer()
                    if score.bonus > .zero { Text("+\(score.bonus.description)").foregroundStyle(.green) }
                    if score.penalty > .zero { Text("−\(score.penalty.description)").foregroundStyle(.red) }
                    Text(score.total.description).font(.headline).monospacedDigit().frame(minWidth: 36, alignment: .trailing)
                }
            }
        }
        .padding()
        .glassEffect(.regular, in: .rect(cornerRadius: 20))
    }
}

// MARK: - Тексты

extension CurrentStep {
    func title(in state: GameState) -> String {
        switch self {
        case let .timed(step, speaker):
            speaker.map { "\(step.kind.displayName): №\($0)" } ?? step.kind.displayName
        case let .farewell(seat): "Прощальная речь №\(seat)"
        case let .speech(seat): "Речь №\(seat)"
        case let .ballot(_, kind):
            switch kind {
            case .main: "Голосование"
            case .revote: "Переголосование"
            case .lift: "Поднять всех"
            }
        case let .tieSpeech(seat): "Оправдание №\(seat)"
        case .liftBallot: "Поднять всех?"
        case .dusk: state.phase == .day(.dusk) ? "День окончен — наступает ночь" : "Далее"
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
