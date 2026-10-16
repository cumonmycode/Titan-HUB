import SwiftUI
import MafBoardCore

// MARK: - Фаза

/// Что сейчас происходит и что от ведущего нужно: голоса, ночной ход, итоги.
struct PhaseSection: View {
    let game: GameController
    let onBestMove: () -> Void

    private var state: GameState { game.state }

    var body: some View {
        Section {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.currentStep.title(in: state)).font(.title3.weight(.semibold))
                    Text("\(state.setup.variant.displayName) · в игре \(state.aliveSeats.count) из \(state.seats.count)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                FormatTag(format: state.setup.format)
            }
            content
            if let author = state.bestMoveAuthor, state.bestMove == nil {
                Button("Лучший ход игрока №\(author)", systemImage: "star", action: onBestMove)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state.currentStep {
        case let .timed(_, speaker) where speaker == nil:
            TimerView(game: game)
        case let .ballot(candidates, _):
            HandCountBallot(game: game, candidates: candidates).id(candidates)
        case let .liftBallot(candidates):
            LiftBallot(game: game, candidates: candidates)
        case let .night(step):
            NightControls(game: game, step: step)
        case .dusk:
            Text("Нажмите «Далее», чтобы продолжить").foregroundStyle(.secondary)
        case .finished:
            if let record = game.record {
                GameResultsList(record: record) { game.profile(at: $0) }
            }
        default:
            let nominations = state.nominations
            if !nominations.isEmpty {
                LabeledContent("Выставлены") {
                    Text(nominations.map { "№\($0.candidate)" }.joined(separator: ", "))
                        .monospacedDigit()
                }
            }
        }
    }
}

// MARK: - Таймер

/// Таймер речи в стиле «Часов»: нажатие на цифры — старт/пауза, удержание — сброс.
struct TimerView: View {
    let game: GameController

    var body: some View {
        if let timer = game.countdown {
            VStack(spacing: 18) {
                TimelineView(.periodic(from: .now, by: 0.25)) { context in
                    let remaining = timer.remaining(at: context.date)
                    VStack(spacing: 10) {
                        Text(Duration.seconds(remaining.rounded(.up)).formatted(.time(pattern: .minuteSecond)))
                            .font(.system(size: 76, weight: .light))
                            .monospacedDigit()
                            .foregroundStyle(remaining <= 10 ? AnyShapeStyle(.red) : AnyShapeStyle(.primary))
                            .contentTransition(.numericText(countsDown: true))
                            .frame(maxWidth: .infinity)
                        ProgressView(value: timer.duration > 0 ? remaining / timer.duration : 0)
                            .tint(remaining <= 10 ? .red : .accentColor)
                    }
                }
                .contentShape(.rect)
                .onTapGesture { game.toggleTimer() }
                .onLongPressGesture { game.restartTimer() }
                .accessibilityAddTraits(.isButton)
                .accessibilityHint("Нажатие — старт или пауза, удержание — сброс")

                HStack {
                    roundButton("Сброс") { game.restartTimer() }
                        .buttonStyle(.glass)
                    Spacer()
                    roundButton("+30 с") { game.extendTimer() }
                        .buttonStyle(.glass)
                    Spacer()
                    roundButton(timer.isRunning ? "Пауза" : "Старт") { game.toggleTimer() }
                        .buttonStyle(.glassProminent)
                        .tint(timer.isRunning ? .orange : .green)
                }
                .sensoryFeedback(.impact, trigger: timer.isRunning)
            }
            .padding(.vertical, 6)
        }
    }

    private func roundButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .frame(width: 66, height: 66)
        }
        .buttonBorderShape(.circle)
    }
}

// MARK: - Говорящий

struct SpeakerSection: View {
    let game: GameController
    let seat: SeatState
    @State private var isConfirmingRemoval = false

    private var label: String {
        switch game.state.currentStep {
        case .farewell: "Прощальная речь"
        case .tieSpeech: "Оправдание"
        case let .timed(step, _): step.kind.displayName
        default: "Говорит"
        }
    }

    private var takesNominations: Bool {
        guard case .speech = game.state.currentStep else { return false }
        return game.state.ruleset.day.candidateSource == .nominations
    }

    var body: some View {
        Section {
            HStack(spacing: 12) {
                PlayerAvatar(name: game.name(of: seat.seat), url: game.profile(at: seat.seat)?.avatarURL, seat: seat.seat.number, size: 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text(game.name(of: seat.seat)).font(.title3.weight(.semibold)).lineLimit(1)
                    Label(label, systemImage: "mic.fill").font(.subheadline).foregroundStyle(.tint)
                    if game.showsRoles { RoleText(role: seat.role) }
                }
                Spacer(minLength: 0)
                FoulCounters(game: game, seat: seat)
            }
            TimerView(game: game)
            if takesNominations {
                NominationGrid(game: game, speaker: seat.seat)
            }
            Button("Удалить игрока", systemImage: "person.fill.xmark", role: .destructive) {
                isConfirmingRemoval = true
            }
            .confirmationDialog(
                "Удалить игрока №\(seat.seat) \(game.name(of: seat.seat))?",
                isPresented: $isConfirmingRemoval,
                titleVisibility: .visible
            ) {
                Button("Удалить", role: .destructive) { game.perform(.disqualify(seat.seat, note: nil)) }
            } message: {
                Text("Дисквалификация со штрафом. Отменить можно кнопкой «Отменить».")
            }
        }
    }
}

private struct NominationGrid: View {
    let game: GameController
    let speaker: Seat

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Выставить на голосование").font(.subheadline).foregroundStyle(.secondary)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 8) {
                ForEach(game.state.seats) { target in
                    let nomination = game.state.nominations.first { $0.candidate == target.seat }
                    let button = Button {
                        if let nomination, nomination.by == speaker {
                            game.perform(.withdrawNomination(by: speaker))
                        } else {
                            game.perform(.nominate(candidate: target.seat, by: speaker))
                        }
                    } label: {
                        Text("\(target.seat.number)")
                            .font(.body.weight(.semibold))
                            .monospacedDigit()
                            .frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonBorderShape(.roundedRectangle(radius: 10))
                    .disabled(!target.isAlive)
                    if nomination == nil {
                        button.buttonStyle(.bordered)
                    } else {
                        button.buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Строка игрока

struct SeatRow: View {
    let game: GameController
    let seat: SeatState

    /// Ночью нажатие на игрока — ход текущей роли.
    private var nightAction: GameAction? {
        guard seat.isAlive, case let .night(step) = game.state.currentStep else { return nil }
        return switch step {
        case .mafiaShot, .maniacShot: .night(.shot(seat.seat))
        case .donCheck, .sheriffCheck: .night(.check(seat.seat))
        case .doctorHeal: .night(.heal(seat.seat))
        }
    }

    private var status: String? {
        if let elimination = seat.elimination { return elimination.cause.label }
        if game.state.currentSpeaker == seat.seat { return "Говорит" }
        if game.state.nominations.contains(where: { $0.candidate == seat.seat }) { return "Выставлен" }
        return nil
    }

    var body: some View {
        Group {
            if let nightAction {
                Button { game.perform(nightAction) } label: {
                    HStack {
                        info
                        Image(systemName: "scope").foregroundStyle(.tint)
                    }
                }
                .foregroundStyle(.primary)
            } else {
                HStack {
                    info
                    if seat.isAlive { FoulCounters(game: game, seat: seat) }
                }
            }
        }
        .opacity(seat.isAlive ? 1 : 0.5)
        .swipeActions(edge: .leading) {
            if seat.isAlive {
                Button("Фол", systemImage: "hand.raised.fill") { game.perform(.foul(seat.seat)) }
                    .tint(.orange)
            }
        }
        .swipeActions(edge: .trailing) {
            if seat.isAlive {
                Button("Техфол", systemImage: "exclamationmark.triangle.fill") { game.perform(.techFoul(seat.seat)) }
                    .tint(.red)
                Button("Предупр.", systemImage: "exclamationmark.bubble.fill") { game.perform(.warning(seat.seat)) }
                    .tint(.yellow)
            }
        }
        .contextMenu { DisciplineMenu(game: game, seat: seat.seat) }
    }

    private var info: some View {
        HStack(spacing: 12) {
            PlayerAvatar(name: game.name(of: seat.seat), url: game.profile(at: seat.seat)?.avatarURL, seat: seat.seat.number)
            VStack(alignment: .leading, spacing: 2) {
                Text(game.name(of: seat.seat)).fontWeight(.semibold).lineLimit(1)
                HStack(spacing: 6) {
                    if game.showsRoles { RoleText(role: seat.role) }
                    if let status { Text(status).font(.subheadline).foregroundStyle(.secondary) }
                    if seat.warnings > 0 {
                        Label("\(seat.warnings)", systemImage: "exclamationmark.bubble.fill")
                            .font(.caption)
                            .foregroundStyle(.yellow)
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }
}

private struct RoleText: View {
    let role: Role

    var body: some View {
        Text(role.displayName).font(.subheadline.weight(.medium)).foregroundStyle(role.team.tint)
    }
}

private struct DisciplineMenu: View {
    let game: GameController
    let seat: Seat

    var body: some View {
        Button("Фол", systemImage: "hand.raised") { game.perform(.foul(seat)) }
        Button("Снять фол", systemImage: "hand.raised.slash") { game.perform(.cancelFoul(seat)) }
        Button("Техфол", systemImage: "exclamationmark.triangle") { game.perform(.techFoul(seat)) }
        Button("Снять техфол", systemImage: "xmark.octagon") { game.perform(.cancelTechFoul(seat)) }
        Button("Предупреждение", systemImage: "exclamationmark.bubble") { game.perform(.warning(seat)) }
        Divider()
        Button("Выбыл по решению ведущего", systemImage: "person.fill.xmark") {
            game.perform(.eliminateByHost(seat, note: nil))
        }
        Button("Дисквалифицировать", systemImage: "nosign", role: .destructive) {
            game.perform(.disqualify(seat, note: nil))
        }
    }
}

// MARK: - Фолы

/// Кнопки «Ф» и «Т»: нажатие добавляет, долгое нажатие — меню «Снять».
struct FoulCounters: View {
    let game: GameController
    let seat: SeatState

    var body: some View {
        let rules = game.state.ruleset.discipline
        HStack(spacing: 6) {
            CounterButton(letter: "Ф", count: seat.fouls, warnAt: rules.foulsToSilence ?? 3,
                          add: { game.perform(.foul(seat.seat)) }, remove: { game.perform(.cancelFoul(seat.seat)) })
            CounterButton(letter: "Т", count: seat.techFouls, warnAt: 1,
                          add: { game.perform(.techFoul(seat.seat)) }, remove: { game.perform(.cancelTechFoul(seat.seat)) })
        }
    }
}

private struct CounterButton: View {
    let letter: String
    let count: Int
    let warnAt: Int
    let add: () -> Void
    let remove: () -> Void

    private var tint: Color { count >= warnAt ? .red : (count > 0 ? .orange : .secondary) }

    var body: some View {
        Button(action: add) {
            Text("\(letter) \(count)")
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .frame(minWidth: 34)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(tint)
        .contextMenu {
            Button("Снять", systemImage: "minus.circle", action: remove).disabled(count == 0)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: count)
        .accessibilityLabel(letter == "Ф" ? "Фолы: \(count)" : "Техфолы: \(count)")
    }
}

// MARK: - Голосование и ночь

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
        ForEach(editable, id: \.self) { candidate in
            Stepper(value: binding(for: candidate), in: 0...max(0, voters - given + votes[candidate, default: 0])) {
                candidateLabel(candidate, votes: votes[candidate, default: 0])
            }
        }
        if autoLast, let last = candidates.last {
            VStack(alignment: .leading, spacing: 4) {
                candidateLabel(last, votes: voters - given)
                Text("Не проголосовавшие уходят последней кандидатуре").font(.footnote).foregroundStyle(.secondary)
            }
        }
        Button {
            var counts = editable.map { CandidateVotes($0, votes: votes[$0, default: 0]) }
            if autoLast, let last = candidates.last {
                counts.append(CandidateVotes(last, votes: voters - given))
            }
            game.perform(.submitBallot(.handCount(counts)))
        } label: {
            Label("Подсчитать голоса", systemImage: "checkmark.circle.fill")
        }
    }

    private func candidateLabel(_ seat: Seat, votes: Int) -> some View {
        HStack(spacing: 10) {
            PlayerAvatar(name: game.name(of: seat), url: game.profile(at: seat)?.avatarURL, seat: seat.number, size: 32)
            Text(game.name(of: seat)).lineLimit(1)
            Spacer()
            Text("\(votes)").font(.headline).monospacedDigit()
        }
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
        LabeledContent("Кандидаты", value: candidates.map { "№\($0)" }.joined(separator: ", "))
        Stepper("«За»: \(count) из \(game.state.aliveSeats.count)", value: $count, in: 0...game.state.aliveSeats.count)
        Button {
            game.perform(.submitBallot(.liftCount(count)))
        } label: {
            Label("Подсчитать голоса", systemImage: "checkmark.circle.fill")
        }
    }
}

private struct NightControls: View {
    let game: GameController
    let step: NightStep

    private var performers: String {
        game.state.seats
            .filter { $0.isAlive && step.isPerformed(by: $0.role) }
            .map { "№\($0.seat)" }
            .joined(separator: ", ")
    }

    var body: some View {
        if !performers.isEmpty {
            LabeledContent("Ходит", value: performers)
        }
        Text("Выберите игрока в списке ниже").foregroundStyle(.secondary)
        if step.killer != nil {
            Button("Промах", systemImage: "scope") { game.perform(.night(.shot(nil))) }
        }
        Button("Пропустить шаг", systemImage: "forward") { game.perform(.night(.skip)) }
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
            List {
                Section {
                    ForEach(game.state.seats.map(\.seat).filter { $0 != author }, id: \.self) { seat in
                        Button {
                            if selected.contains(seat) {
                                selected.remove(seat)
                            } else if selected.count < limit {
                                selected.insert(seat)
                            }
                        } label: {
                            HStack(spacing: 12) {
                                PlayerAvatar(name: game.name(of: seat), url: game.profile(at: seat)?.avatarURL, seat: seat.number, size: 36)
                                Text(game.name(of: seat))
                                Spacer()
                                if selected.contains(seat) {
                                    Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(.tint)
                                }
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                } footer: {
                    Text("Игрок №\(author.map { "\($0)" } ?? "—") называет до \(limit) номеров, которых считает мафией.")
                }
            }
            .navigationTitle("Лучший ход")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово", systemImage: "checkmark") {
                        game.perform(.recordBestMove(selected.sorted()))
                        dismiss()
                    }
                    .disabled(selected.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Итоги игры

/// Баллы игроков строками списка. Используется и в игре, и в истории.
struct GameResultsList: View {
    let record: GameRecord
    let profile: (Seat) -> PlayerProfile?

    var body: some View {
        ForEach(GameScorer.score(record)) { score in
            let player = profile(score.seat)
            HStack(spacing: 12) {
                PlayerAvatar(name: player?.nickname ?? "Игрок \(score.seat)", url: player?.avatarURL, seat: score.seat.number, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(player?.nickname ?? "Игрок \(score.seat)").lineLimit(1)
                    Text(score.role.displayName).font(.subheadline).foregroundStyle(score.role.team.tint)
                }
                Spacer()
                if score.bonus > .zero { Text("+\(score.bonus.description)").font(.subheadline).foregroundStyle(.green) }
                if score.penalty > .zero { Text("−\(score.penalty.description)").font(.subheadline).foregroundStyle(.red) }
                Text(score.total.description).font(.headline).monospacedDigit().frame(minWidth: 32, alignment: .trailing)
            }
        }
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
