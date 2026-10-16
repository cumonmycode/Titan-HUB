import SwiftUI
import MafBoardCore

extension View {
    /// Карточка на экране игры — системный фон сгруппированного списка.
    func gameCard() -> some View {
        padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22, style: .continuous))
    }
}

// MARK: - Шапка фазы

/// Где мы: день или ночь, текущий шаг, кто говорит, кто выставлен.
struct PhaseHeader: View {
    let game: GameController
    let onBestMove: () -> Void

    private var state: GameState { game.state }
    private var isNight: Bool {
        switch state.phase {
        case .night, .nightZero: true
        default: false
        }
    }

    private var subtitle: String {
        if let speaker = state.currentSpeaker { return "Говорит \(game.name(of: speaker)) · в игре \(state.aliveSeats.count) из \(state.seats.count)" }
        if case .finished = state.currentStep { return outcomeReason }
        return "\(state.setup.variant.displayName) · в игре \(state.aliveSeats.count) из \(state.seats.count)"
    }

    private var outcomeReason: String {
        switch state.outcome?.reason {
        case .allBlackEliminated: "Все чёрные выбыли"
        case .blackReachedParity: "Чёрных не меньше, чем красных"
        case .declaredByHost: "Итог объявил ведущий"
        case nil: ""
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(state.moment.displayName, systemImage: isNight ? "moon.stars.fill" : "sun.max.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(isNight ? Color.indigo : Color.orange)
                Spacer()
                FormatTag(format: state.setup.format)
            }
            Text(state.currentStep.title(in: state))
                .font(.title.bold())
                .contentTransition(.opacity)
            Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            if !state.nominations.isEmpty, !state.isFinished {
                Text("Выставлены: " + state.nominations.map { "№\($0.candidate)" }.joined(separator: ", "))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.tint)
            }
            if let author = state.bestMoveAuthor, state.bestMove == nil {
                Button("Лучший ход игрока №\(author)", systemImage: "star.fill", action: onBestMove)
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
        .padding(.horizontal, 4)
    }
}

// MARK: - Игрок

/// Карточка игрока. Свёрнута — номер, имя, фолы. Раскрыта — таймер (если говорит), выставление и фолы.
struct PlayerCard: View {
    let game: GameController
    let seat: SeatState
    let isExpanded: Bool
    let onToggle: () -> Void

    private var state: GameState { game.state }
    private var isSpeaker: Bool { state.currentSpeaker == seat.seat }

    /// Ночью нажатие на игрока — ход текущей роли.
    private var nightAction: GameAction? {
        guard seat.isAlive, case let .night(step) = state.currentStep else { return nil }
        return switch step {
        case .mafiaShot, .maniacShot: .night(.shot(seat.seat))
        case .donCheck, .sheriffCheck: .night(.check(seat.seat))
        case .doctorHeal: .night(.heal(seat.seat))
        }
    }

    private var takesNominations: Bool {
        guard isSpeaker, case .speech = state.currentStep else { return false }
        return state.ruleset.day.candidateSource == .nominations
    }

    private var status: String? {
        if let elimination = seat.elimination { return elimination.cause.label }
        if isSpeaker { return "Говорит" }
        if let nomination = state.nominations.first(where: { $0.candidate == seat.seat }) {
            return "Выставлен игроком №\(nomination.by)"
        }
        if seat.missesNextSpeech { return "Пропускает речь" }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Button {
                if let nightAction { game.perform(nightAction) } else { onToggle() }
            } label: {
                header
            }
            .buttonStyle(.plain)
            .disabled(!seat.isAlive)

            if isExpanded, seat.isAlive, nightAction == nil {
                if isSpeaker, game.countdown != nil {
                    TimerView(game: game)
                }
                if takesNominations {
                    NominationPad(game: game, speaker: seat.seat)
                }
                DisciplinePanel(game: game, seat: seat)
            }
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 22, style: .continuous))
        .overlay {
            if isSpeaker {
                RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.tint, lineWidth: 2)
            }
        }
        .opacity(seat.isAlive ? 1 : 0.5)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("\(seat.seat.number)")
                .font(.headline)
                .monospacedDigit()
                .foregroundStyle(isSpeaker ? .white : .primary)
                .frame(width: 34, height: 34)
                .background(isSpeaker ? AnyShapeStyle(.tint) : AnyShapeStyle(Color(.tertiarySystemFill)), in: .circle)
            PlayerAvatar(name: game.name(of: seat.seat), url: game.profile(at: seat.seat)?.avatarURL, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(game.name(of: seat.seat)).font(.headline).lineLimit(1)
                HStack(spacing: 6) {
                    if game.showsRoles {
                        Text(seat.role.displayName).font(.subheadline.weight(.medium)).foregroundStyle(seat.role.team.tint)
                    }
                    if let status {
                        Text(status).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 4)
            FoulBadges(seat: seat)
            if nightAction != nil {
                Text("Выбрать").font(.subheadline.weight(.semibold)).foregroundStyle(.tint)
            } else if seat.isAlive {
                Image(systemName: "chevron.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
            }
        }
        .contentShape(.rect)
    }
}

/// Значки нарушений в свёрнутой карточке — только если они есть.
private struct FoulBadges: View {
    let seat: SeatState

    var body: some View {
        HStack(spacing: 4) {
            if seat.fouls > 0 { badge("Ф\(seat.fouls)", .orange) }
            if seat.techFouls > 0 { badge("Т\(seat.techFouls)", .red) }
            if seat.warnings > 0 { badge("!\(seat.warnings)", .yellow) }
        }
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.caption.weight(.bold))
            .monospacedDigit()
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(0.15), in: .capsule)
    }
}

// MARK: - Таймер

/// Таймер речи в стиле «Часов»: нажатие на цифры — старт/пауза, удержание — сброс.
struct TimerView: View {
    let game: GameController

    var body: some View {
        if let timer = game.countdown {
            VStack(spacing: 16) {
                TimelineView(.periodic(from: .now, by: 0.25)) { context in
                    let remaining = timer.remaining(at: context.date)
                    VStack(spacing: 10) {
                        Text(Duration.seconds(remaining.rounded(.up)).formatted(.time(pattern: .minuteSecond)))
                            .font(.system(size: 72, weight: .light))
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

                GlassEffectContainer(spacing: 20) {
                    HStack {
                        circleButton("Сброс", size: 62) { game.restartTimer() }
                            .buttonStyle(.glass)
                        Spacer()
                        circleButton(timer.isRunning ? "Пауза" : "Старт", size: 76) { game.toggleTimer() }
                            .buttonStyle(.glassProminent)
                            .tint(timer.isRunning ? .orange : .green)
                        Spacer()
                        circleButton("+30 с", size: 62) { game.extendTimer() }
                            .buttonStyle(.glass)
                    }
                }
                .sensoryFeedback(.impact, trigger: timer.isRunning)
            }
        }
    }

    private func circleButton(_ title: String, size: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .frame(width: size, height: size)
        }
        .buttonBorderShape(.circle)
    }
}

// MARK: - Выставление

/// Выставление кандидатуры говорящим — номера раскладкой телефонной клавиатуры.
private struct NominationPad: View {
    let game: GameController
    let speaker: Seat

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Выставить на голосование").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            Keypad(count: game.state.seats.count) { number in
                let seat = Seat(number)
                let nomination = game.state.nominations.first { $0.candidate == seat }
                let style: KeypadKey.Style = if !game.state.isAlive(seat) {
                    .disabled
                } else if nomination?.by == speaker {
                    .selected
                } else if nomination != nil {
                    .marked
                } else {
                    .normal
                }
                KeypadKey(number: number, caption: nomination.map { "от \($0.by)" }, style: style) {
                    if nomination?.by == speaker {
                        game.perform(.withdrawNomination(by: speaker))
                    } else {
                        game.perform(.nominate(candidate: seat, by: speaker))
                    }
                }
            }
        }
    }
}

// MARK: - Нарушения

/// Фолы, техфолы, предупреждение и удаление — в раскрытой карточке игрока.
private struct DisciplinePanel: View {
    let game: GameController
    let seat: SeatState

    var body: some View {
        let rules = game.state.ruleset.discipline
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                CounterControl(title: "Фолы", count: seat.fouls, limit: rules.foulsToRemoval ?? 4, tint: .orange,
                               add: { game.perform(.foul(seat.seat)) }, remove: { game.perform(.cancelFoul(seat.seat)) })
                CounterControl(title: "Техфолы", count: seat.techFouls, limit: rules.techFoulsToRemoval ?? 2, tint: .red,
                               add: { game.perform(.techFoul(seat.seat)) }, remove: { game.perform(.cancelTechFoul(seat.seat)) })
            }
            HStack(spacing: 10) {
                Button {
                    game.perform(.warning(seat.seat))
                } label: {
                    Label(seat.warnings > 0 ? "Предупр. (\(seat.warnings))" : "Предупреждение", systemImage: "exclamationmark.bubble")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.yellow)
                Menu {
                    Button("Выбыл по решению ведущего", systemImage: "person.fill.xmark") {
                        game.perform(.eliminateByHost(seat.seat, note: nil))
                    }
                    Button("Дисквалифицировать (штраф)", systemImage: "nosign", role: .destructive) {
                        game.perform(.disqualify(seat.seat, note: nil))
                    }
                } label: {
                    Label("Удалить", systemImage: "person.fill.xmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }
        }
    }
}

/// «−  2 Фолы  +» с точками до удаления.
private struct CounterControl: View {
    let title: String
    let count: Int
    let limit: Int
    let tint: Color
    let add: () -> Void
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: remove) {
                Image(systemName: "minus").font(.headline).frame(width: 44, height: 44)
            }
            .disabled(count == 0)
            VStack(spacing: 2) {
                Text("\(count)")
                    .font(.title2.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(count > 0 ? tint : .primary)
                    .contentTransition(.numericText())
                Text(title).font(.caption2.weight(.medium)).foregroundStyle(.secondary)
                HStack(spacing: 3) {
                    ForEach(0..<max(limit, 1), id: \.self) { index in
                        Capsule().fill(index < count ? tint : Color(.quaternaryLabel)).frame(width: 8, height: 3)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            Button(action: add) {
                Image(systemName: "plus").font(.headline).frame(width: 44, height: 44)
            }
        }
        .buttonStyle(.borderless)
        .padding(4)
        .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 16, style: .continuous))
        .sensoryFeedback(.impact(weight: .medium), trigger: count)
        .accessibilityElement(children: .combine)
        .accessibilityValue("\(count)")
    }
}

// MARK: - Ночь

struct NightPanel: View {
    let game: GameController
    let step: NightStep

    private var performers: String {
        game.state.seats
            .filter { $0.isAlive && step.isPerformed(by: $0.role) }
            .map { "№\($0.seat)" }
            .joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !performers.isEmpty {
                Label("Ходит: \(performers)", systemImage: "moon.fill")
                    .font(.headline)
                    .foregroundStyle(.indigo)
            }
            Text("Нажмите на игрока ниже — это его цель.").foregroundStyle(.secondary)
            HStack(spacing: 10) {
                if step.killer != nil {
                    Button { game.perform(.night(.shot(nil))) } label: {
                        Label("Промах", systemImage: "scope").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                Button { game.perform(.night(.skip)) } label: {
                    Label("Пропустить", systemImage: "forward").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.large)
        }
        .gameCard()
    }
}

// MARK: - Итоги

struct ResultsCard: View {
    let record: GameRecord
    let profile: (Seat) -> PlayerProfile?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Circle().fill(record.outcome.winner.dot).frame(width: 12, height: 12)
                Text(record.outcome.winner.displayName).font(.title2.bold())
            }
            Divider()
            GameResultsList(record: record, profile: profile)
        }
        .gameCard()
    }
}

/// Баллы игроков. Используется и в игре, и в истории.
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

// MARK: - Лучший ход

struct BestMoveSheet: View {
    let game: GameController
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<Seat> = []

    private var author: Seat? { game.state.bestMoveAuthor }
    private var limit: Int { game.state.ruleset.bestMove.maxSeats(playerCount: game.state.seats.count) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Игрок №\(author.map { "\($0)" } ?? "—") называет до \(limit) номеров, которых считает мафией.")
                    .foregroundStyle(.secondary)
                Keypad(count: game.state.seats.count) { number in
                    let seat = Seat(number)
                    let style: KeypadKey.Style = seat == author ? .disabled : (selected.contains(seat) ? .selected : .normal)
                    KeypadKey(number: number, style: style) {
                        if selected.contains(seat) {
                            selected.remove(seat)
                        } else if selected.count < limit {
                            selected.insert(seat)
                        }
                    }
                }
                Spacer()
            }
            .padding()
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
