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

    /// Итог прошедшей ночи — в начале дня ведущий объявляет его столу.
    private var morning: String? {
        guard case .day = state.phase, let report = state.nights.last, report.number == state.dayNumber - 1 else { return nil }
        if report.victims.isEmpty { return "Ночь прошла без жертв" }
        return "Ночью убит " + report.victims.map { "№\($0.seat) \(game.name(of: $0.seat))" }.joined(separator: ", ")
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
            if let morning {
                Label(morning, systemImage: "sunrise.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.orange.opacity(0.14), in: .capsule)
            }
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

/// Карточка игрока. Свёрнута — номер, имя, фолы точками. Раскрыта — таймер (если говорит),
/// выставление и фолы. Свайпы по карточке — быстрые фолы, техфолы и удаление.
struct PlayerCard: View {
    let game: GameController
    let seat: SeatState
    let isExpanded: Bool
    let onToggle: () -> Void
    @State private var isConfirmingRemoval = false

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

    /// Удалён ведущим или за фолы — такого можно вернуть. Убитого и заголосованного — нет (это ход игры).
    private var isRemoved: Bool {
        switch seat.elimination?.cause {
        case .removed, .hostDecision: true
        default: false
        }
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
        VStack(alignment: .leading, spacing: 12) {
            // Касание, а не кнопка: отпускание пальца после свайпа не раскрывает и не сворачивает карточку.
            header
                .onTapGesture {
                    guard seat.isAlive else { return }
                    if let nightAction { game.perform(nightAction) } else { onToggle() }
                }
                .accessibilityAddTraits(.isButton)

            if isExpanded, seat.isAlive, nightAction == nil {
                if isSpeaker, game.countdown != nil {
                    TimerView(game: game)
                }
                if takesNominations {
                    NominationPad(game: game, speaker: seat.seat)
                }
                PenaltyRow(game: game, seat: seat) { isConfirmingRemoval = true }
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .overlay {
            if isSpeaker {
                RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(.tint, lineWidth: 1.5)
            }
        }
        .modifier(PenaltySwipe(game: game, seat: seat, isEnabled: seat.isAlive && !isSpeaker))
        .confirmationDialog(
            "Удалить №\(seat.seat) \(game.name(of: seat.seat))?",
            isPresented: $isConfirmingRemoval,
            titleVisibility: .visible
        ) {
            Button("Дисквалифицировать (со штрафом)", role: .destructive) { game.perform(.disqualify(seat.seat, note: nil)) }
            Button("Выбыл по решению ведущего") { game.perform(.eliminateByHost(seat.seat, note: nil)) }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            identity.opacity(seat.isAlive ? 1 : 0.5)
            Spacer(minLength: 4)
            PenaltyDots(fouls: seat.fouls, techFouls: seat.techFouls)
            if isRemoved {
                Button("Вернуть", systemImage: "arrow.uturn.backward") { game.reinstate(seat.seat) }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
            } else if nightAction != nil {
                Text("Выбрать").font(.subheadline.weight(.semibold)).foregroundStyle(.tint)
            } else if seat.isAlive {
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
            }
        }
        .contentShape(.rect)
    }

    private var identity: some View {
        HStack(spacing: 10) {
            Text("\(seat.seat.number)")
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(isSpeaker ? .white : .primary)
                .frame(width: 30, height: 30)
                .background(isSpeaker ? AnyShapeStyle(.tint) : AnyShapeStyle(Color(.tertiarySystemFill)), in: .circle)
            PlayerAvatar(name: game.name(of: seat.seat), url: game.profile(at: seat.seat)?.avatarURL, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(game.name(of: seat.seat)).font(.body.weight(.semibold)).lineLimit(1)
                if game.showsRoles || status != nil {
                    HStack(spacing: 6) {
                        if game.showsRoles {
                            Text(seat.role.displayName).font(.caption.weight(.medium)).foregroundStyle(seat.role.team.tint)
                        }
                        if let status {
                            Text(status).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
        }
    }
}

/// Фолы и техфолы точками в свёрнутой строке — только если они есть.
private struct PenaltyDots: View {
    let fouls: Int
    let techFouls: Int

    var body: some View {
        HStack(spacing: 6) {
            if fouls > 0 { dots(fouls, color: .orange, shape: Circle()) }
            if techFouls > 0 { dots(techFouls, color: .red, shape: RoundedRectangle(cornerRadius: 1.5)) }
        }
        .accessibilityElement()
        .accessibilityLabel("Фолов \(fouls), техфолов \(techFouls)")
    }

    private func dots(_ count: Int, color: Color, shape: some Shape) -> some View {
        HStack(spacing: 2) {
            ForEach(0..<count, id: \.self) { _ in shape.fill(color).frame(width: 7, height: 7) }
        }
    }
}

// MARK: - Свайпы

/// Свайпы по карточке ступенями, как в «Почте»: вправо — фол, дальше — техфол;
/// влево — снять фол, дальше — снять техфол. Удаление свайпом нет — только кнопкой.
/// У говорящего свайп отключён — его карточка раскрыта и управляется кнопками.
private struct PenaltySwipe: ViewModifier {
    let game: GameController
    let seat: SeatState
    let isEnabled: Bool
    @State private var offset: CGFloat = 0
    @State private var axis: Axis?
    @State private var tier = 0

    /// Короткий и длинный свайп.
    private static let thresholds: [CGFloat] = [60, 140]

    private enum Direction {
        case add
        case cancel
    }

    private var direction: Direction { offset > 0 ? .add : .cancel }

    func body(content: Content) -> some View {
        content
            .offset(x: offset)
            .background { backdrop }
            .simultaneousGesture(drag, including: isEnabled ? .all : .subviews)
            .sensoryFeedback(.selection, trigger: tier)
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 16)
            .onChanged { value in
                if axis == nil {
                    axis = abs(value.translation.width) > abs(value.translation.height) ? .horizontal : .vertical
                }
                guard axis == .horizontal else { return }
                let width = value.translation.width
                let limit = Self.thresholds[1] + 40
                offset = abs(width) > limit ? (width > 0 ? 1 : -1) * (limit + (abs(width) - limit) * 0.2) : width
                tier = Self.tier(for: offset)
            }
            .onEnded { _ in
                if axis == .horizontal { perform(direction, tier: Self.tier(for: offset)) }
                axis = nil
                tier = 0
                withAnimation(.snappy) { offset = 0 }
            }
    }

    private static func tier(for offset: CGFloat) -> Int {
        thresholds.lastIndex { abs(offset) >= $0 }.map { $0 + 1 } ?? 0
    }

    private func perform(_ direction: Direction, tier: Int) {
        switch (direction, tier) {
        case (.add, 1): game.perform(.foul(seat.seat))
        case (.add, 2): game.perform(.techFoul(seat.seat))
        case (.cancel, 1) where seat.fouls > 0: game.perform(.cancelFoul(seat.seat))
        case (.cancel, 2) where seat.techFouls > 0: game.perform(.cancelTechFoul(seat.seat))
        default: break
        }
    }

    /// Что произойдёт, если отпустить сейчас.
    private var action: (title: String, icon: String, color: Color) {
        let shown = max(tier, 1)
        return switch (direction, shown) {
        case (.add, 1): ("Фол", "hand.raised.fill", .orange)
        case (.add, _): ("Техфол", "exclamationmark.triangle.fill", Color(red: 0.85, green: 0.25, blue: 0.2))
        case (.cancel, 1): ("Снять фол", "arrow.uturn.backward", .teal)
        case (.cancel, _): ("Снять техфол", "arrow.uturn.backward", .blue)
        }
    }

    @ViewBuilder
    private var backdrop: some View {
        if offset != 0 {
            let current = action
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(tier == 0 ? Color(.systemGray4) : current.color)
                .overlay(alignment: direction == .add ? .leading : .trailing) {
                    Label(current.title, systemImage: current.icon)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .opacity(tier == 0 ? 0.6 : 1)
                        .padding(.horizontal, 20)
                        .contentTransition(.opacity)
                }
                .animation(.snappy, value: tier)
        }
    }
}

// MARK: - Таймер

/// Таймер речи одной строкой: цифры (нажатие — старт/пауза, удержание — сброс) и кнопки справа.
struct TimerView: View {
    let game: GameController

    var body: some View {
        if let timer = game.countdown {
            TimelineView(.periodic(from: .now, by: 0.25)) { context in
                let remaining = timer.remaining(at: context.date)
                VStack(spacing: 8) {
                    HStack(spacing: 8) {
                        // Вибро за 10 секунд до конца и на нуле — только у идущего таймера.
                        let stage = !timer.isRunning ? 0 : (remaining <= 0 ? 2 : (remaining <= 10 ? 1 : 0))
                        Text(Duration.seconds(remaining.rounded(.up)).formatted(.time(pattern: .minuteSecond)))
                            .sensoryFeedback(trigger: stage) { _, new in
                                switch new {
                                case 1: .warning
                                case 2: .error
                                default: nil
                                }
                            }
                            .font(.system(size: 44, weight: .light))
                            .monospacedDigit()
                            .foregroundStyle(remaining <= 10 ? AnyShapeStyle(.red) : AnyShapeStyle(.primary))
                            .contentTransition(.numericText(countsDown: true))
                            .contentShape(.rect)
                            .onTapGesture { game.toggleTimer() }
                            .onLongPressGesture { game.restartTimer() }
                            .accessibilityAddTraits(.isButton)
                            .accessibilityHint("Нажатие — старт или пауза, удержание — сброс")
                        Spacer(minLength: 0)
                        GlassEffectContainer(spacing: 8) {
                            HStack(spacing: 8) {
                                Button("Сброс", systemImage: "arrow.counterclockwise") { game.restartTimer() }
                                    .labelStyle(.iconOnly)
                                    .buttonStyle(.glass)
                                    .buttonBorderShape(.circle)
                                Button { game.extendTimer() } label: {
                                    Text("+30").font(.footnote.weight(.semibold)).monospacedDigit()
                                }
                                .buttonStyle(.glass)
                                .buttonBorderShape(.circle)
                                Button(timer.isRunning ? "Пауза" : "Старт", systemImage: timer.isRunning ? "pause.fill" : "play.fill") {
                                    game.toggleTimer()
                                }
                                .labelStyle(.iconOnly)
                                .buttonStyle(.glassProminent)
                                .buttonBorderShape(.circle)
                                .tint(timer.isRunning ? .orange : .green)
                                .controlSize(.large)
                            }
                        }
                    }
                    ProgressView(value: timer.duration > 0 ? remaining / timer.duration : 0)
                        .tint(remaining <= 10 ? .red : .accentColor)
                }
            }
            .sensoryFeedback(.impact, trigger: timer.isRunning)
        }
    }
}

// MARK: - Выставление

/// Выставление кандидатуры говорящим — номера сеткой 5×2.
private struct NominationPad: View {
    let game: GameController
    let speaker: Seat

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Выставить").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            Keypad(count: game.state.seats.count, layout: .grid(columns: 5), spacing: 6) { number in
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
                KeypadKey(number: number, style: style, isCompact: true) {
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

// MARK: - Фолы

/// Фол и техфол — капсулы с точками до удаления: нажатие добавляет, долгое нажатие — снять.
private struct PenaltyRow: View {
    let game: GameController
    let seat: SeatState
    let onRemove: () -> Void

    var body: some View {
        let rules = game.state.ruleset.discipline
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                PenaltyPill(title: "Фол", count: seat.fouls, limit: rules.foulsToRemoval ?? 4, tint: .orange,
                            add: { game.perform(.foul(seat.seat)) }, remove: { game.perform(.cancelFoul(seat.seat)) })
                PenaltyPill(title: "Техфол", count: seat.techFouls, limit: rules.techFoulsToRemoval ?? 2, tint: .red,
                            add: { game.perform(.techFoul(seat.seat)) }, remove: { game.perform(.cancelTechFoul(seat.seat)) })
                Spacer(minLength: 0)
                Button("Удалить", systemImage: "person.fill.xmark", role: .destructive, action: onRemove)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.circle)
                    .tint(.red)
            }
            Text("Свайп вправо — фол, дальше — техфол. Влево — снять.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
}

private struct PenaltyPill: View {
    let title: String
    let count: Int
    let limit: Int
    let tint: Color
    let add: () -> Void
    let remove: () -> Void

    var body: some View {
        Button(action: add) {
            HStack(spacing: 6) {
                Text(title).font(.subheadline.weight(.semibold))
                HStack(spacing: 3) {
                    ForEach(0..<max(limit, 1), id: \.self) { index in
                        Circle()
                            .fill(index < count ? tint : Color(.tertiaryLabel).opacity(0.5))
                            .frame(width: 6, height: 6)
                    }
                }
            }
            .padding(.horizontal, 2)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(count > 0 ? tint : .secondary)
        .contextMenu {
            Button("Снять \(title.lowercased())", systemImage: "arrow.uturn.backward", action: remove)
                .disabled(count == 0)
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: count)
        .accessibilityLabel(title)
        .accessibilityValue("\(count) из \(limit)")
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

    /// Прошлые проверки этой роли — ведущему, если проверяющий спросит.
    private var pastChecks: [NightCheck] {
        guard step == .donCheck || step == .sheriffCheck else { return [] }
        let checker: Role = step == .donCheck ? .don : .sheriff
        var checks = game.state.nights.flatMap(\.actions.checks)
        if case let .night(progress) = game.state.phase { checks += progress.actions.checks }
        return checks.filter { $0.checker == checker }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !performers.isEmpty {
                Label("Ходит: \(performers)", systemImage: "moon.fill")
                    .font(.headline)
                    .foregroundStyle(.indigo)
            }
            if !pastChecks.isEmpty {
                Text("Уже проверял: " + pastChecks.map { "№\($0.target) — \($0.verdictText)" }.joined(separator: ", "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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

/// Итоги на экране игры: победитель, баллы с доп. баллами ведущего, лучший ход и «Следующая игра».
struct ResultsCard: View {
    let game: GameController
    let record: GameRecord
    let onBestMove: () -> Void
    let onNextGame: (() -> Void)?

    /// Доп. баллы и штрафы ведущего, в сотых.
    private static let bonuses = [10, 20, 30, 40, 50]
    private static let penalties = [-25, -50]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Circle().fill(record.outcome.winner.dot).frame(width: 12, height: 12)
                Text(record.outcome.winner.displayName).font(.title2.bold())
            }
            if let author = game.state.bestMoveAuthor, game.state.bestMove == nil {
                Button("Лучший ход игрока №\(author)", systemImage: "star.fill", action: onBestMove)
                    .buttonStyle(.bordered)
            }
            Divider()
            ForEach(GameScorer.score(record)) { score in
                HStack(spacing: 10) {
                    ResultRow(score: score, player: game.profile(at: score.seat))
                    Menu {
                        Section("Доп. баллы") {
                            ForEach(Self.bonuses, id: \.self) { value in
                                Button("+\(Points(hundredths: value).description)") { adjust(score.seat, value) }
                            }
                        }
                        Section("Штраф") {
                            ForEach(Self.penalties, id: \.self) { value in
                                Button(Points(hundredths: value).description, role: .destructive) { adjust(score.seat, value) }
                            }
                        }
                    } label: {
                        Image(systemName: "plusminus.circle").font(.title3).foregroundStyle(.tint)
                    }
                    .accessibilityLabel("Доп. баллы")
                }
            }
            Text("± — доп. баллы или штраф ведущего. Отменить — кнопкой «Назад».")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let onNextGame {
                Button(action: onNextGame) {
                    Label("Следующая игра", systemImage: "plus").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
        }
        .gameCard()
    }

    private func adjust(_ seat: Seat, _ hundredths: Int) {
        let points = Points(hundredths: hundredths)
        game.perform(.adjustScore(ScoreAdjustment(seat: seat, points: points, note: hundredths > 0 ? "Доп. балл" : "Штраф ведущего")))
    }
}

private struct ResultRow: View {
    let score: PlayerGameScore
    let player: PlayerProfile?

    var body: some View {
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
            .background { AmbientBackground() }
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
