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
    let onBestMove: (Seat) -> Void

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
        state.outcome?.reason.text ?? ""
    }

    /// Право лучшего хода у того, кто сейчас не говорит (у говорящего кнопка в карточке).
    private var otherBestMoveAuthor: Seat? {
        state.pendingBestMoveAuthors.first { $0 != state.currentSpeaker }
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
            if let author = otherBestMoveAuthor {
                Button("Лучший ход игрока №\(author)", systemImage: "star.fill") { onBestMove(author) }
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
/// выставление и нарушения (фол, МТФ, БТФ), а на заключительной речи — лучший ход и протокол. Свайпы — быстрые фол и МТФ.
struct PlayerCard: View {
    let game: GameController
    let seat: SeatState
    let isExpanded: Bool
    let onToggle: () -> Void
    let onBestMove: () -> Void
    let onProtocol: () -> Void
    @State private var isConfirmingRemoval = false

    private var state: GameState { game.state }
    private var isSpeaker: Bool { state.currentSpeaker == seat.seat }
    /// Игрок на заключительной минуте: лучший ход, речь или протокол. Он ещё за столом, пока не оставит протокол.
    private var isFarewell: Bool { state.currentStep.farewellSeat == seat.seat }
    private var nomination: Nomination? { state.nominations.first { $0.candidate == seat.seat } }

    /// Ночью нажатие на игрока — ход текущей роли. Проверить можно и выбывшего, выстрелить и лечить — только живого.
    private var nightAction: GameAction? {
        guard case let .night(step) = state.currentStep else { return nil }
        switch step {
        case .mafiaShot, .maniacShot: return seat.isAlive ? .night(.shot(seat.seat)) : nil
        case .donCheck, .sheriffCheck: return .night(.check(seat.seat))
        case .doctorHeal: return seat.isAlive ? .night(.heal(seat.seat)) : nil
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
        switch state.currentStep {
        case .farewellBestMove where isFarewell: return "Лучший ход"
        case .farewellProtocol where isFarewell: return "Протокол"
        case .farewell where isFarewell:
            return state.halvedSpeaker == seat.seat ? "Заключительная речь · 3 фола, 30 секунд" : "Заключительная речь"
        default: break
        }
        if let elimination = seat.elimination { return elimination.cause.label }
        if isSpeaker { return state.halvedSpeaker == seat.seat ? "Говорит · 3 фола, полминуты" : "Говорит" }
        if let nomination { return "Выставлен игроком №\(nomination.by)" }
        if seat.missesNextSpeech { return "Пропускает речь" }
        if seat.halvesNextSpeech { return "Ближайшая речь — полминуты" }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Касание, а не кнопка: отпускание пальца после свайпа не раскрывает и не сворачивает карточку.
            header
                .onTapGesture {
                    if let nightAction {
                        game.perform(nightAction)
                    } else if seat.isAlive || isFarewell {
                        onToggle()
                    }
                }
                .accessibilityAddTraits(.isButton)

            if isExpanded, seat.isAlive || isFarewell, nightAction == nil {
                if isSpeaker, game.countdown != nil {
                    TimerView(game: game)
                }
                if isFarewell {
                    FarewellActions(game: game, seat: seat.seat, onBestMove: onBestMove, onProtocol: onProtocol)
                }
                if takesNominations {
                    NominationPad(game: game, speaker: seat.seat)
                }
                if seat.isAlive {
                    DisciplinePanel(game: game, seat: seat) { isConfirmingRemoval = true }
                }
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
        // Штраф не показываем: он зависит от команды игрока, а экран ведущего видят за столом.
        .confirmationDialog(
            "Удалить №\(seat.seat) \(game.name(of: seat.seat))?",
            isPresented: $isConfirmingRemoval,
            titleVisibility: .visible
        ) {
            Button("Дисквалифицировать", role: .destructive) {
                game.perform(.disqualify(seat.seat, note: nil))
            }
            Button("Выбыл по решению ведущего") { game.perform(.eliminateByHost(seat.seat, note: nil)) }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            identity.opacity(seat.isAlive || isFarewell ? 1 : 0.5)
            Spacer(minLength: 4)
            PenaltyMarks(fouls: seat.fouls, techFouls: seat.techFoulKinds)
            if nightAction != nil {
                Text("Выбрать").font(.subheadline.weight(.semibold)).foregroundStyle(.tint)
            } else if isRemoved {
                Button("Вернуть", systemImage: "arrow.uturn.backward") { game.reinstate(seat.seat) }
                    .font(.subheadline.weight(.semibold))
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.small)
            } else if seat.isAlive || isFarewell {
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
            }
        }
        .contentShape(.rect)
    }

    /// Фото и номер — одним значком: номер в углу фото. Говорящий — акцент, выставленный — оранжевый.
    private var identity: some View {
        HStack(spacing: 12) {
            PlayerAvatar(
                name: game.name(of: seat.seat), url: game.profile(at: seat.seat)?.avatarURL,
                seat: seat.seat.number, size: 44, seatTint: seatTint
            )
            .overlay {
                if nomination != nil, !isSpeaker { Circle().stroke(.orange, lineWidth: 2) }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(game.name(of: seat.seat)).font(.body.weight(.semibold)).lineLimit(1)
                if game.showsRoles || status != nil {
                    HStack(spacing: 6) {
                        if game.showsRoles {
                            Text(seat.role.displayName).font(.caption.weight(.medium)).foregroundStyle(seat.role.team.tint)
                        }
                        if let status {
                            Text(status)
                                .font(.caption.weight(nomination != nil && seat.isAlive ? .semibold : .regular))
                                .foregroundStyle(nomination != nil && seat.isAlive ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                                .lineLimit(1)
                        }
                    }
                }
            }
        }
    }
}

private extension PlayerCard {
    var seatTint: Color {
        if isSpeaker { return .accentColor }
        if nomination != nil { return .orange }
        return Color(.systemGray)
    }
}

/// Фолы точками и техфолы метками в свёрнутой строке — только если они есть. МТФ — контур, БТФ — заливка.
private struct PenaltyMarks: View {
    let fouls: Int
    let techFouls: [TechFoulKind]

    var body: some View {
        HStack(spacing: 6) {
            if fouls > 0 {
                HStack(spacing: 2) {
                    ForEach(0..<fouls, id: \.self) { _ in Circle().fill(.orange).frame(width: 7, height: 7) }
                }
            }
            ForEach(Array(techFouls.enumerated()), id: \.offset) { _, kind in TechFoulChip(kind: kind) }
        }
        .accessibilityElement()
        .accessibilityLabel("Фолов \(fouls)" + (techFouls.isEmpty ? "" : ", техфолы: " + techFouls.map(\.shortName).joined(separator: ", ")))
    }
}

// MARK: - Свайпы

/// Свайпы по карточке ступенями, как в «Почте»: вправо — фол, дальше — МТФ;
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
        case (.add, _): ("МТФ", "exclamationmark.triangle.fill", Color(red: 0.85, green: 0.25, blue: 0.2))
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

// MARK: - Выставление

/// Выставление кандидатуры говорящим — номера сеткой 5×2. Синий — выставил говорящий (нажатие снимает),
/// оранжевый с номером — уже выставлен другим, зачёркнут — выбыл. Пока говорящий кого-то выставил, остальные приглушены.
private struct NominationPad: View {
    let game: GameController
    let speaker: Seat

    private var state: GameState { game.state }
    private var ownNomination: Nomination? { state.nominations.first { $0.by == speaker } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Выставить").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                Spacer()
                if let ownNomination {
                    Text("Выставлен №\(ownNomination.candidate.number) · нажмите, чтобы снять")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.tint)
                }
            }
            Keypad(count: state.seats.count, layout: .grid(columns: 5), spacing: 6) { number in
                let seat = Seat(number)
                let nomination = state.nominations.first { $0.candidate == seat }
                let (style, caption): (KeypadKey.Style, String?) = if !state.isAlive(seat) {
                    (.disabled, "выбыл")
                } else if nomination?.by == speaker {
                    (.selected, "выставил")
                } else if let nomination {
                    (.taken, "от №\(nomination.by)")
                } else if ownNomination != nil {
                    (.dimmed, nil)
                } else {
                    (.normal, nil)
                }
                KeypadKey(number: number, caption: caption, style: style, isCompact: true) {
                    guard style != .taken else { return }
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

/// Нарушения двумя строками со своими «−» и «+»: фолы (точки до удаления) и техфолы (полученные МТФ/БТФ,
/// «−» снимает последний). Если нарушение удалит игрока, «+» краснеет, строка показывает итог, а нажатие просит подтверждения.
private struct DisciplinePanel: View {
    let game: GameController
    let seat: SeatState
    let onRemove: () -> Void
    @State private var pending: Penalty?

    private enum Penalty: Hashable {
        case foul
        case techFoul(TechFoulKind)
    }

    private var rules: DisciplinePolicy { game.state.ruleset.discipline }
    private var scoring: ScoringPolicy { game.state.setup.scoring }
    private var foulLimit: Int { rules.foulsToRemoval ?? 4 }
    private var nextFoulRemoves: Bool { rules.foulsToRemoval.map { seat.fouls + 1 >= $0 } ?? false }
    private var nextTechFoulRemoves: Bool { rules.techFoulsToRemoval.map { seat.techFouls + 1 >= $0 } ?? false }

    /// Штраф за все техфолы игрока вместе с этим удаляющим: он вдвое (МТФ + БТФ = −1.5).
    private func techFoulTotal(adding kind: TechFoulKind) -> Points {
        let earlier = seat.techFoulKinds.map { scoring.techFoulPenalty($0, removes: false) }.sum()
        let removal = scoring.penalizesTechFoulRemoval ? scoring.removalPenalty : .zero
        return earlier + scoring.techFoulPenalty(kind, removes: true) + removal
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Нарушения").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                Spacer()
                Button("Удалить игрока…", systemImage: "person.fill.xmark", role: .destructive, action: onRemove)
                    .font(.caption.weight(.semibold))
                    .buttonStyle(.borderless)
                    .tint(.red)
            }
            VStack(spacing: 12) {
                foulRow
                Divider()
                techFoulRow
            }
            .padding(12)
            .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 16, style: .continuous))
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: seat.fouls)
        .sensoryFeedback(.impact(weight: .heavy), trigger: seat.techFouls)
        .confirmationDialog(
            "Удалить №\(seat.seat.number) \(game.name(of: seat.seat))?",
            isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }),
            titleVisibility: .visible,
            presenting: pending
        ) { penalty in
            Button(confirmButton(penalty), role: .destructive) { perform(penalty) }
        } message: { penalty in
            Text(confirmMessage(penalty))
        }
    }

    // MARK: Фолы

    private var foulRow: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Фолы").font(.subheadline.weight(.semibold))
                HStack(spacing: 4) {
                    ForEach(0..<foulLimit, id: \.self) { index in
                        Circle()
                            .fill(index < seat.fouls ? Color.orange : Color(.tertiaryLabel).opacity(0.5))
                            .frame(width: 8, height: 8)
                    }
                    if nextFoulRemoves {
                        Text("\(foulLimit)-й удалит").font(.caption2.weight(.bold)).foregroundStyle(.red).padding(.leading, 4)
                    }
                }
            }
            Spacer(minLength: 4)
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 8) {
                    StepButton(icon: "minus", label: "Снять фол") { game.perform(.cancelFoul(seat.seat)) }
                        .disabled(seat.fouls == 0)
                    Text("\(seat.fouls)")
                        .font(.title3.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(seat.fouls == 0 ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.orange))
                        .contentTransition(.numericText(value: Double(seat.fouls)))
                        .frame(minWidth: 22)
                    StepButton(icon: "plus", label: "Фол", tint: nextFoulRemoves ? .red : nil) { add(.foul) }
                }
            }
        }
    }

    // MARK: Техфолы

    private var techFoulRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            techFoulControls
            if nextTechFoulRemoves {
                Text("Второй техфол удалит: +МТФ \((-techFoulTotal(adding: .ordinary)).signed) · +БТФ \((-techFoulTotal(adding: .big)).signed)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.red)
            }
        }
    }

    private var techFoulControls: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Техфолы").font(.subheadline.weight(.semibold))
                if seat.techFoulKinds.isEmpty {
                    Text("нет").font(.caption).foregroundStyle(.secondary)
                } else {
                    HStack(spacing: 4) {
                        ForEach(Array(seat.techFoulKinds.enumerated()), id: \.offset) { _, kind in TechFoulChip(kind: kind) }
                    }
                }
            }
            Spacer(minLength: 4)
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 6) {
                    StepButton(icon: "minus", label: "Снять последний техфол") { game.perform(.cancelTechFoul(seat.seat)) }
                        .disabled(seat.techFouls == 0)
                    ForEach([TechFoulKind.ordinary, .big], id: \.self) { kind in
                        Button { add(.techFoul(kind)) } label: {
                            Text("+" + kind.shortName)
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(nextTechFoulRemoves ? Color.red : Color.primary)
                                .frame(minHeight: 30)
                        }
                        .buttonStyle(.glass)
                        .buttonBorderShape(.capsule)
                        .accessibilityLabel("\(kind.fullName) \((-scoring.techFoulPenalty(kind, removes: false)).signed)")
                    }
                }
            }
        }
    }

    /// Удаляющее нарушение — с подтверждением.
    private func add(_ penalty: Penalty) {
        let removes = switch penalty {
        case .foul: nextFoulRemoves
        case .techFoul: nextTechFoulRemoves
        }
        if removes { pending = penalty } else { perform(penalty) }
    }

    private func perform(_ penalty: Penalty) {
        switch penalty {
        case .foul: game.perform(.foul(seat.seat))
        case .techFoul(.ordinary): game.perform(.techFoul(seat.seat))
        case .techFoul(.big): game.perform(.bigTechFoul(seat.seat))
        }
    }

    private func confirmButton(_ penalty: Penalty) -> String {
        switch penalty {
        case .foul: "\(foulLimit)-й фол — удалить"
        case let .techFoul(kind): "\(kind.shortName) — удалить"
        }
    }

    private func confirmMessage(_ penalty: Penalty) -> String {
        switch penalty {
        case .foul:
            return "\(foulLimit)-й фол удаляет игрока из игры."
        case let .techFoul(kind):
            let chain = (seat.techFoulKinds + [kind]).map(\.shortName).joined(separator: " + ")
            return "Второй техфол удаляет игрока и считается вдвое: \(chain) = \((-techFoulTotal(adding: kind)).signed)."
        }
    }
}

/// Круглая кнопка «−» или «+» в строке нарушений.
private struct StepButton: View {
    let icon: String
    let label: String
    var tint: Color?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.body.weight(.bold))
                .foregroundStyle(tint.map(AnyShapeStyle.init) ?? AnyShapeStyle(.primary))
                .frame(width: 30, height: 30)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel(label)
    }
}

/// Метка техфола: МТФ — красный контур, БТФ — красная заливка.
struct TechFoulChip: View {
    let kind: TechFoulKind

    var body: some View {
        Text(kind.shortName)
            .font(.caption2.weight(.heavy))
            .foregroundStyle(kind == .big ? Color.white : Color.red)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background {
                if kind == .big {
                    Capsule().fill(Color.red)
                } else {
                    Capsule().stroke(Color.red, lineWidth: 1.2)
                }
            }
    }
}
