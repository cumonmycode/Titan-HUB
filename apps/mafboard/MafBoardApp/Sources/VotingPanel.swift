import SwiftUI
import MafBoardCore

// MARK: - Клавиатура номеров

/// Раскладка номеров: телефонная (1–9 тройками, 10 под 8) или ровная сетка по N в ряд.
enum KeypadLayout {
    case phone
    case grid(columns: Int)

    var columns: Int {
        switch self {
        case .phone: 3
        case let .grid(columns): columns
        }
    }
}

func keypadRows(count: Int, layout: KeypadLayout = .phone) -> [[Int?]] {
    let width = layout.columns
    func chunked(_ numbers: [Int]) -> [[Int?]] {
        stride(from: 0, to: numbers.count, by: width).map { start in
            (0..<width).map { offset in start + offset < numbers.count ? numbers[start + offset] : nil }
        }
    }
    guard count > 0 else { return [] }
    guard case .phone = layout else { return chunked(Array(1...count)) }
    var rows = chunked(Array(1...min(count, 9)))
    if count >= 10 { rows.append([nil, 10, nil]) }
    if count > 10 { rows += chunked(Array(11...count)) }
    return rows
}

/// Номера игроков: телефонная раскладка или сетка.
struct Keypad<Key: View>: View {
    let count: Int
    var layout: KeypadLayout = .phone
    var spacing: CGFloat = 10
    @ViewBuilder let key: (Int) -> Key

    var body: some View {
        GlassEffectContainer(spacing: spacing) {
            Grid(horizontalSpacing: spacing, verticalSpacing: spacing) {
                ForEach(Array(keypadRows(count: count, layout: layout).enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(0..<layout.columns, id: \.self) { column in
                            if let number = row[column] {
                                key(number)
                            } else {
                                Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Клавиша номера: обычная, выбранная, занятая другим (с подписью) или недоступная.
struct KeypadKey: View {
    enum Style: Equatable {
        case normal
        case selected
        case marked
        /// Уже занят другим (выставлен другим игроком): цветная, но не нажимается.
        case taken
        /// Сейчас недоступна, но игрок за столом (говорящий уже выставил кандидатуру).
        case dimmed
        /// Игрок выбыл или номер нельзя выбрать: номер зачёркнут.
        case disabled
    }

    let number: Int
    var caption: String?
    var style: Style = .normal
    /// Компактная клавиша — для выставления в карточке игрока.
    var isCompact = false
    /// Цвет выбранной клавиши (например, чёрный или красный в протоколе).
    var tint: Color?
    let action: () -> Void

    var body: some View {
        let label = VStack(spacing: 0) {
            Text("\(number)")
                .font(isCompact ? .headline : .title2.weight(.semibold))
                .monospacedDigit()
                .strikethrough(style == .disabled)
            if !isCompact || caption != nil {
                Text(caption ?? " ").font(.caption2.weight(.medium)).opacity(caption == nil ? 0 : 1)
            }
        }
        .frame(maxWidth: .infinity, minHeight: isCompact ? 36 : 56)

        Group {
            switch style {
            case .selected:
                Button(action: action) { label }.buttonStyle(.glassProminent).tint(tint)
            case .marked:
                Button(action: action) { label.foregroundStyle(.secondary) }.buttonStyle(.glass)
            case .taken:
                Button(action: action) { label }.buttonStyle(.glassProminent).tint(.orange).allowsHitTesting(false)
            case .normal:
                Button(action: action) { label }.buttonStyle(.glass)
            case .dimmed:
                Button(action: action) { label }.buttonStyle(.glass).disabled(true).opacity(0.45)
            case .disabled:
                Button(action: action) { label }.buttonStyle(.glass).disabled(true).opacity(0.3)
            }
        }
        .buttonBorderShape(.roundedRectangle(radius: isCompact ? 12 : 16))
        .sensoryFeedback(.selection, trigger: style)
        .accessibilityLabel("Игрок \(number)")
    }
}

// MARK: - Голосование

/// Голосование: выбираете кандидата и отмечаете на клавиатуре, кто за него голосует.
struct VotingPanel: View {
    let game: GameController
    let candidates: [Seat]
    let kind: VotingRoundKind
    @State private var current: Seat?
    /// Голосующий → за кого.
    @State private var choices: [Seat: Seat] = [:]

    private var state: GameState { game.state }
    private var voters: [Seat] { state.aliveSeats }
    private var autoLast: Bool { state.ruleset.voting.abstainersVoteForLastCandidate }
    private var selected: Seat { current ?? candidates.first ?? Seat(1) }
    private var abstainers: [Seat] { voters.filter { choices[$0] == nil } }
    private var nextCandidate: Seat? {
        guard let index = candidates.firstIndex(of: selected), index + 1 < candidates.count else { return nil }
        return candidates[index + 1]
    }

    private func votes(for candidate: Seat) -> Int {
        let explicit = choices.values.filter { $0 == candidate }.count
        return explicit + (autoLast && candidate == candidates.last ? abstainers.count : 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(candidates, id: \.self) { candidate in
                        Button {
                            withAnimation(.snappy) { current = candidate }
                        } label: {
                            CandidateChip(
                                seat: candidate,
                                name: game.name(of: candidate),
                                votes: votes(for: candidate),
                                isSelected: candidate == selected
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)

            Text("Кто голосует за №\(selected) \(game.name(of: selected))?")
                .font(.headline)

            Keypad(count: state.seats.count) { number in
                let seat = Seat(number)
                let choice = choices[seat]
                let style: KeypadKey.Style = if !state.isAlive(seat) {
                    .disabled
                } else if choice == selected {
                    .selected
                } else if choice != nil {
                    .marked
                } else {
                    .normal
                }
                KeypadKey(number: number, caption: choice.flatMap { $0 == selected ? nil : "за \($0)" }, style: style) {
                    choices[seat] = choices[seat] == selected ? nil : selected
                }
            }

            Text(abstainersNote).font(.footnote).foregroundStyle(.secondary)

            HStack(spacing: 10) {
                if let next = nextCandidate {
                    Button {
                        withAnimation(.snappy) { current = next }
                    } label: {
                        Text("К №\(next)").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                Button {
                    game.perform(.submitBallot(.perVoter(choices.map { Vote($0.key, for: $0.value) })))
                } label: {
                    Label("Подсчитать", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
            }
            .controlSize(.large)
        }
        .gameCard()
    }

    private var abstainersNote: String {
        guard !abstainers.isEmpty else { return "Все проголосовали." }
        let list = abstainers.map { "№\($0)" }.joined(separator: ", ")
        if autoLast, let last = candidates.last {
            return "Не голосовали: \(list) — их голоса уйдут за №\(last)."
        }
        return "Не голосовали: \(list)."
    }
}

private struct CandidateChip: View {
    let seat: Seat
    let name: String
    let votes: Int
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 2) {
            Text("№\(seat)").font(.headline).monospacedDigit()
            Text(name).font(.caption).lineLimit(1)
            Text("\(votes)").font(.title3.bold()).monospacedDigit().contentTransition(.numericText())
        }
        .frame(minWidth: 76)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
        .background(isSelected ? AnyShapeStyle(.tint) : AnyShapeStyle(Color(.tertiarySystemFill)), in: .rect(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Простой режим: число голосов

/// Простой режим голосования: за каждого кандидата — одно нажатие на число голосов.
/// В спортивной мафии последний выставленный получает остаток: не проголосовавшие голосуют за него (ФСМ 4.5.8).
struct CountVotingPanel: View {
    let game: GameController
    let candidates: [Seat]
    let kind: VotingRoundKind
    @State private var counts: [Seat: Int] = [:]
    @State private var current: Seat?

    private var state: GameState { game.state }
    private var voters: Int { state.aliveSeats.count }
    private var autoLast: Bool { state.ruleset.voting.abstainersVoteForLastCandidate && candidates.count > 1 }
    /// Кандидаты, за которых голоса вводит ведущий (последнему при `autoLast` достаётся остаток).
    private var entered: [Seat] { autoLast ? Array(candidates.dropLast()) : candidates }
    private var given: Int { entered.reduce(0) { $0 + (counts[$1] ?? 0) } }
    private var remainder: Int { max(0, voters - given) }
    private var selected: Seat? {
        current ?? entered.first { counts[$0] == nil } ?? entered.last
    }

    private func votes(for candidate: Seat) -> Int? {
        if autoLast, candidate == candidates.last { return remainder }
        return counts[candidate]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(candidates, id: \.self) { candidate in
                        let isAuto = autoLast && candidate == candidates.last
                        Button {
                            withAnimation(.snappy) { current = candidate }
                        } label: {
                            CountChip(
                                seat: candidate, name: game.name(of: candidate), votes: votes(for: candidate),
                                caption: isAuto ? "остаток" : nil, isSelected: candidate == selected
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(isAuto)
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)

            if let selected {
                Text("Сколько голосов за №\(selected) \(game.name(of: selected))?").font(.headline)
                CountPad(maximum: autoLast ? remainder + (counts[selected] ?? 0) : voters, selected: counts[selected]) { number in
                    counts[selected] = number
                    advance(from: selected)
                }
            }

            if autoLast, let last = candidates.last {
                Text("За №\(last) — остальные \(remainder): не проголосовавшие отдают голос последней кандидатуре.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Button {
                var ballot = entered.map { CandidateVotes($0, votes: counts[$0] ?? 0) }
                if autoLast, let last = candidates.last { ballot.append(CandidateVotes(last, votes: remainder)) }
                game.perform(.submitBallot(.handCount(ballot)))
            } label: {
                Label("Подсчитать", systemImage: "checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
        .gameCard()
    }

    /// После ввода — к следующему кандидату без голосов.
    private func advance(from seat: Seat) {
        guard let index = entered.firstIndex(of: seat) else { return }
        let next = entered[(index + 1)...].first { counts[$0] == nil }
        withAnimation(.snappy) { current = next ?? seat }
    }
}

/// Числа голосов крупными клавишами: 0–5 и 6–10 — одно нажатие.
struct CountPad: View {
    let maximum: Int
    let selected: Int?
    let onPick: (Int) -> Void

    private static let columns = 6

    var body: some View {
        let numbers = Array(0...max(0, maximum))
        GlassEffectContainer(spacing: 8) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: Self.columns), spacing: 8) {
                ForEach(numbers, id: \.self) { number in
                    KeypadKey(number: number, style: number == selected ? .selected : .normal) { onPick(number) }
                }
            }
        }
    }
}

private struct CountChip: View {
    let seat: Seat
    let name: String
    let votes: Int?
    let caption: String?
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 2) {
            Text("№\(seat)").font(.headline).monospacedDigit()
            Text(caption ?? name).font(.caption).lineLimit(1)
            Text(votes.map(String.init) ?? "—").font(.title3.bold()).monospacedDigit().contentTransition(.numericText())
        }
        .frame(minWidth: 76)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
        .background(isSelected ? AnyShapeStyle(.tint) : AnyShapeStyle(Color(.tertiarySystemFill)), in: .rect(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - «Поднять всех»

/// Голосование «поднять всех»: отмечаете голосующих «за»; больше половины живых — выбывают все кандидаты.
struct LiftPanel: View {
    let game: GameController
    let candidates: [Seat]
    @State private var voters: Set<Seat> = []
    /// Простой режим: только число «за».
    @State private var count: Int?

    private var state: GameState { game.state }
    private var alive: Int { state.aliveSeats.count }
    private var isSimple: Bool { state.ruleset.voting.ballotStyle == .handCount }
    private var liftVotes: Int { isSimple ? count ?? 0 : voters.count }
    private var passes: Bool { liftVotes * 2 > alive }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Выбывают все: " + candidates.map { "№\($0)" }.joined(separator: ", "))
                .font(.headline)
            Text("Кто за? Нужно больше половины живых — \(alive / 2 + 1) из \(alive).")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if isSimple {
                CountPad(maximum: alive, selected: count) { count = $0 }
            } else {
                Keypad(count: state.seats.count) { number in
                    let seat = Seat(number)
                    let style: KeypadKey.Style = !state.isAlive(seat) ? .disabled : (voters.contains(seat) ? .selected : .normal)
                    KeypadKey(number: number, style: style) {
                        if voters.contains(seat) { voters.remove(seat) } else { voters.insert(seat) }
                    }
                }
            }
            HStack {
                Text("За: \(liftVotes) из \(alive)").font(.headline).monospacedDigit()
                Spacer()
                Text(passes ? "Выбывают" : "Остаются")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(passes ? .red : .green)
            }
            Button {
                game.perform(.submitBallot(isSimple ? .liftCount(liftVotes) : .lift(voters: voters.sorted())))
            } label: {
                Label("Подсчитать", systemImage: "checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
        .gameCard()
    }
}
