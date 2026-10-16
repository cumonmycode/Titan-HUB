import SwiftUI
import MafBoardCore

// MARK: - Карточка фазы

/// Что сейчас происходит и что от ведущего нужно: голоса, ночной ход, итоги.
struct PhaseCard: View {
    let game: GameController
    let onBestMove: () -> Void

    private var state: GameState { game.state }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(state.currentStep.title(in: state)).font(.title2.bold())
                Spacer()
                FormatTag(text: state.setup.format.displayName, color: state.setup.format.tint)
            }
            Text("\(state.setup.variant.displayName) · в игре \(state.aliveSeats.count) из \(state.seats.count)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            content
            if let author = state.bestMoveAuthor, state.bestMove == nil {
                Button("Лучший ход №\(author)", systemImage: "star.fill", action: onBestMove)
                    .buttonStyle(.glass)
            }
        }
        .glassCard()
    }

    @ViewBuilder
    private var content: some View {
        switch state.currentStep {
        case let .timed(_, speaker) where speaker == nil:
            TimerBlock(game: game, isLarge: false)
        case let .ballot(candidates, _):
            HandCountBallot(game: game, candidates: candidates).id(candidates)
        case let .liftBallot(candidates):
            LiftBallot(game: game, candidates: candidates)
        case let .night(step):
            NightPanel(game: game, step: step)
        case .dusk:
            Text("Нажмите «Далее», чтобы продолжить").foregroundStyle(.secondary)
        case .finished:
            if let record = game.record {
                GameResultsList(record: record) { game.profile(at: $0) }
            }
        default:
            NominationsSummary(game: game)
        }
    }
}

private struct NominationsSummary: View {
    let game: GameController

    var body: some View {
        let nominations = game.state.nominations
        if !nominations.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                CapsLabel(text: "Выставлены")
                ScrollView(.horizontal) {
                    HStack(spacing: 8) {
                        ForEach(nominations, id: \.by) { nomination in
                            HStack(spacing: 6) {
                                PlayerAvatar(name: game.name(of: nomination.candidate), url: game.profile(at: nomination.candidate)?.avatarURL, size: 26)
                                Text("№\(nomination.candidate)").font(.subheadline.bold())
                                Text("от \(nomination.by)").font(.caption).foregroundStyle(.secondary)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .glassEffect(.regular, in: .capsule)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }
}

// MARK: - Таймер

/// Большой таймер речи: нажатие — старт/пауза, удержание — сброс.
struct TimerBlock: View {
    let game: GameController
    var isLarge = true

    var body: some View {
        if let timer = game.countdown {
            VStack(spacing: 14) {
                TimelineView(.periodic(from: .now, by: 0.25)) { context in
                    let remaining = timer.remaining(at: context.date)
                    VStack(spacing: 12) {
                        Text("\(Int(remaining.rounded(.up)))")
                            .font(.system(size: isLarge ? 104 : 60, weight: .heavy, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(remaining <= 10 ? AnyShapeStyle(.red) : AnyShapeStyle(timer.isRunning ? .primary : .secondary))
                            .contentTransition(.numericText(countsDown: true))
                            .frame(maxWidth: .infinity)
                        ProgressView(value: timer.duration > 0 ? remaining / timer.duration : 0)
                            .tint(remaining <= 10 ? .red : .white)
                            .padding(.horizontal, 40)
                    }
                }
                .contentShape(.rect)
                .onTapGesture { game.toggleTimer() }
                .onLongPressGesture { game.restartTimer() }
                .sensoryFeedback(.impact, trigger: timer.isRunning)

                HStack(spacing: 12) {
                    Button { game.extendTimer() } label: {
                        Text("+30 СЕК").font(.subheadline.weight(.heavy)).tracking(1).foregroundStyle(.black).padding(.horizontal, 18)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.white)
                    Button("Сброс", systemImage: "arrow.counterclockwise") { game.restartTimer() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                }
                .controlSize(.large)
                Text("Нажатие — старт/пауза · удержание — сброс")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

// MARK: - Говорящий

struct SpeakerCard: View {
    let game: GameController
    let seat: SeatState
    @AppStorage(AppTheme.storageKey) private var theme = AppTheme.midnight

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
        VStack(spacing: 20) {
            HStack(spacing: 14) {
                PlayerAvatar(name: game.name(of: seat.seat), url: game.profile(at: seat.seat)?.avatarURL, seat: seat.seat.number, size: 66)
                VStack(alignment: .leading, spacing: 6) {
                    Text(game.name(of: seat.seat).uppercased())
                        .font(.title2.weight(.heavy))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Label { CapsLabel(text: label, color: theme.accent) } icon: { Image(systemName: "mic.fill") }
                        .foregroundStyle(theme.accent)
                        .font(.caption)
                    if game.showsRoles { RoleText(role: seat.role) }
                }
                Spacer(minLength: 0)
                FoulCounters(game: game, seat: seat)
            }
            TimerBlock(game: game)
            if takesNominations {
                NominationGrid(game: game, speaker: seat.seat)
            }
            HoldToRemoveButton { game.perform(.disqualify(seat.seat, note: nil)) }
        }
        .glassCard(cornerRadius: 32, padding: 18)
        .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).stroke(theme.accent.opacity(0.45), lineWidth: 1.5))
    }
}

private struct NominationGrid: View {
    let game: GameController
    let speaker: Seat
    @AppStorage(AppTheme.storageKey) private var theme = AppTheme.midnight

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CapsLabel(text: "Выставить на голосование")
            GlassEffectContainer(spacing: 10) {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                    ForEach(game.state.seats) { target in
                        let nomination = game.state.nominations.first { $0.candidate == target.seat }
                        Button {
                            if let nomination, nomination.by == speaker {
                                game.perform(.withdrawNomination(by: speaker))
                            } else {
                                game.perform(.nominate(candidate: target.seat, by: speaker))
                            }
                        } label: {
                            Text("\(target.seat.number)")
                                .font(.title3.bold())
                                .monospacedDigit()
                                .frame(maxWidth: .infinity, minHeight: 50)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(
                            nomination == nil ? .regular.interactive() : .regular.tint(theme.accent.opacity(0.7)).interactive(),
                            in: .rect(cornerRadius: 14)
                        )
                        .opacity(target.isAlive ? 1 : 0.25)
                        .disabled(!target.isAlive)
                    }
                }
            }
        }
    }
}

/// «Удалить (удержать)»: случайное нажатие не удаляет игрока.
private struct HoldToRemoveButton: View {
    let action: () -> Void
    @State private var fired = 0

    var body: some View {
        Text("Удалить (удержать)".uppercased())
            .font(.caption.weight(.heavy))
            .tracking(2)
            .foregroundStyle(.red)
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
            .glassEffect(.regular.tint(.red.opacity(0.2)).interactive(), in: .capsule)
            .onLongPressGesture(minimumDuration: 0.8) {
                fired += 1
                action()
            }
            .sensoryFeedback(.warning, trigger: fired)
    }
}

// MARK: - Строка игрока

struct SeatRow: View {
    let game: GameController
    let seat: SeatState
    @AppStorage(AppTheme.storageKey) private var theme = AppTheme.midnight

    /// Ночью нажатие на игрока — ход текущей роли.
    private var nightAction: GameAction? {
        guard seat.isAlive, case let .night(step) = game.state.currentStep else { return nil }
        return switch step {
        case .mafiaShot, .maniacShot: .night(.shot(seat.seat))
        case .donCheck, .sheriffCheck: .night(.check(seat.seat))
        case .doctorHeal: .night(.heal(seat.seat))
        }
    }

    private var isNominated: Bool {
        game.state.nominations.contains { $0.candidate == seat.seat }
    }

    var body: some View {
        HStack(spacing: 12) {
            PlayerAvatar(name: game.name(of: seat.seat), url: game.profile(at: seat.seat)?.avatarURL, seat: seat.seat.number, size: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text(game.name(of: seat.seat).uppercased())
                    .font(.headline.weight(.heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if game.showsRoles { RoleText(role: seat.role) }
                if let elimination = seat.elimination {
                    Text(elimination.cause.label).font(.caption).foregroundStyle(.secondary)
                } else if isNominated {
                    CapsLabel(text: "Выставлен", color: theme.accent)
                }
            }
            Spacer(minLength: 0)
            if seat.isAlive { FoulCounters(game: game, seat: seat) }
        }
        .glassCard(cornerRadius: 24, padding: 12)
        .overlay {
            if nightAction != nil {
                RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(theme.accent.opacity(0.35), lineWidth: 1)
            }
        }
        .opacity(seat.isAlive ? 1 : 0.45)
        .contentShape(.rect)
        .onTapGesture { if let nightAction { game.perform(nightAction) } }
        .contextMenu { DisciplineMenu(game: game, seat: seat.seat) }
    }
}

private struct RoleText: View {
    let role: Role

    var body: some View {
        Text(role.displayName).font(.caption.bold()).foregroundStyle(role.team.tint)
    }
}

private struct DisciplineMenu: View {
    let game: GameController
    let seat: Seat

    var body: some View {
        Button("Предупреждение", systemImage: "exclamationmark.bubble") { game.perform(.warning(seat)) }
        Button("Снять фол", systemImage: "hand.raised.slash") { game.perform(.cancelFoul(seat)) }
        Button("Снять техфол", systemImage: "xmark.octagon") { game.perform(.cancelTechFoul(seat)) }
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

/// Плашки «Ф» и «Т»: нажатие добавляет, долгое нажатие — снять. Точки под ними — до удаления.
struct FoulCounters: View {
    let game: GameController
    let seat: SeatState

    var body: some View {
        let rules = game.state.ruleset.discipline
        HStack(spacing: 10) {
            CounterBox(letter: "Ф", count: seat.fouls, limit: rules.foulsToRemoval ?? 4, tint: .orange,
                       add: { game.perform(.foul(seat.seat)) }, remove: { game.perform(.cancelFoul(seat.seat)) })
            Rectangle().fill(.white.opacity(0.15)).frame(width: 1, height: 34)
            CounterBox(letter: "Т", count: seat.techFouls, limit: rules.techFoulsToRemoval ?? 2, tint: .red,
                       add: { game.perform(.techFoul(seat.seat)) }, remove: { game.perform(.cancelTechFoul(seat.seat)) })
        }
    }
}

private struct CounterBox: View {
    let letter: String
    let count: Int
    let limit: Int
    let tint: Color
    let add: () -> Void
    let remove: () -> Void

    var body: some View {
        VStack(spacing: 5) {
            Button(action: add) {
                VStack(spacing: 0) {
                    Text(letter).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                    Text("\(count)").font(.title3.weight(.bold)).monospacedDigit()
                }
                .frame(width: 44, height: 50)
            }
            .buttonStyle(.plain)
            .glassEffect(count > 0 ? .regular.tint(tint.opacity(0.45)).interactive() : .regular.interactive(), in: .rect(cornerRadius: 14))
            .contextMenu {
                Button("Снять", systemImage: "minus.circle", action: remove).disabled(count == 0)
            }
            HStack(spacing: 3) {
                ForEach(0..<max(limit, 1), id: \.self) { index in
                    Capsule().fill(index < count ? tint : .white.opacity(0.18)).frame(width: 6, height: 3)
                }
            }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: count)
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
        VStack(spacing: 10) {
            ForEach(editable, id: \.self) { candidate in
                Stepper(value: binding(for: candidate), in: 0...max(0, voters - given + votes[candidate, default: 0])) {
                    candidateLabel(candidate, votes: votes[candidate, default: 0])
                }
            }
            if autoLast, let last = candidates.last {
                HStack {
                    candidateLabel(last, votes: voters - given)
                    Spacer()
                }
                Text("Не проголосовавшие уходят последней кандидатуре").font(.footnote).foregroundStyle(.secondary)
            }
            Button {
                var counts = editable.map { CandidateVotes($0, votes: votes[$0, default: 0]) }
                if autoLast, let last = candidates.last {
                    counts.append(CandidateVotes(last, votes: voters - given))
                }
                game.perform(.submitBallot(.handCount(counts)))
            } label: {
                Label("Подсчитать", systemImage: "checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
    }

    private func candidateLabel(_ seat: Seat, votes: Int) -> some View {
        HStack(spacing: 10) {
            PlayerAvatar(name: game.name(of: seat), url: game.profile(at: seat)?.avatarURL, seat: seat.number, size: 34)
            Text(game.name(of: seat)).lineLimit(1)
            Text("\(votes)").font(.title3.bold()).monospacedDigit()
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
        VStack(alignment: .leading, spacing: 10) {
            Text("Поднять всех: " + candidates.map { "№\($0)" }.joined(separator: ", "))
            Stepper("«За»: \(count) из \(game.state.aliveSeats.count)", value: $count, in: 0...game.state.aliveSeats.count)
            Button {
                game.perform(.submitBallot(.liftCount(count)))
            } label: {
                Label("Подсчитать", systemImage: "checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
    }
}

private struct NightPanel: View {
    let game: GameController
    let step: NightStep

    private var performers: String {
        game.state.seats
            .filter { $0.isAlive && step.isPerformed(by: $0.role) }
            .map { "№\($0.seat)" }
            .joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !performers.isEmpty {
                Text("Ходит: \(performers)").foregroundStyle(.secondary)
            }
            Text("Нажмите на игрока ниже").font(.subheadline)
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

// MARK: - Лучший ход

struct BestMoveSheet: View {
    let game: GameController
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<Seat> = []

    private var author: Seat? { game.state.bestMoveAuthor }
    private var limit: Int { game.state.ruleset.bestMove.maxSeats(playerCount: game.state.seats.count) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(game.state.seats.map(\.seat).filter { $0 != author }, id: \.self) { seat in
                        Button {
                            if selected.contains(seat) {
                                selected.remove(seat)
                            } else if selected.count < limit {
                                selected.insert(seat)
                            }
                        } label: {
                            HStack(spacing: 12) {
                                PlayerAvatar(name: game.name(of: seat), url: game.profile(at: seat)?.avatarURL, seat: seat.number, size: 40)
                                Text(game.name(of: seat))
                                Spacer()
                                Image(systemName: selected.contains(seat) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                            }
                            .glassCard(cornerRadius: 20, padding: 12)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .appBackground()
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

// MARK: - Итоги игры

/// Победитель и баллы игроков. Используется и в игре, и в истории.
struct GameResultsList: View {
    let record: GameRecord
    let profile: (Seat) -> PlayerProfile?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(record.outcome.winner.dot).frame(width: 10, height: 10)
                Text(record.outcome.winner.displayName).font(.title3.bold())
            }
            ForEach(GameScorer.score(record)) { score in
                let player = profile(score.seat)
                HStack(spacing: 10) {
                    PlayerAvatar(name: player?.nickname ?? "Игрок \(score.seat)", url: player?.avatarURL, seat: score.seat.number, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(player?.nickname ?? "Игрок \(score.seat)").lineLimit(1)
                        Text(score.role.displayName).font(.caption).foregroundStyle(score.role.team.tint)
                    }
                    Spacer()
                    if score.bonus > .zero { Text("+\(score.bonus.description)").font(.subheadline).foregroundStyle(.green) }
                    if score.penalty > .zero { Text("−\(score.penalty.description)").font(.subheadline).foregroundStyle(.red) }
                    Text(score.total.description).font(.headline).monospacedDigit().frame(minWidth: 36, alignment: .trailing)
                }
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
