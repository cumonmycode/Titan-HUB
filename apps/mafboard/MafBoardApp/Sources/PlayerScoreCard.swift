import SwiftUI
import MafBoardCore

// MARK: - Баллы игрока за игру

/// Что ведущий может поправить в баллах игрока после игры. `nil` в карточке — только просмотр (история).
struct ScoreEditing {
    /// Доп+ и Доп− в сотых: плюс ≥ 0, минус ≤ 0.
    let bonus: Binding<Int>
    let penalty: Binding<Int>
    /// `nil` — протокол игроку не положен.
    let onProtocol: (() -> Void)?
    /// `nil` — права лучшего хода нет.
    let onBestMove: (() -> Void)?
    /// `nil` — игрок не удалён за фолы или дисквалификацию.
    let isCriticalRemoval: Binding<Bool>?

    /// Положительный допбалл — от +0.2 до +1.0 (ФСМ 8.4.3), отрицательный — от −0.2 до −1.0 (8.4.4).
    static let bonusValues = [0] + Array(stride(from: 20, through: 100, by: 10))
    static let penaltyValues = [0] + Array(stride(from: -20, through: -100, by: -10))
}

/// Карточка игрока в итогах: свёрнута — номер, имя, роль и итог; раскрыта — из чего итог сложился.
struct PlayerScoreCard: View {
    let score: PlayerGameScore
    let player: PlayerProfile?
    /// «ПУ · убит мафией», «удалён за фолы».
    let status: String?
    var editing: ScoreEditing?
    @State private var isExpanded = false

    private var name: String { player?.nickname ?? "Игрок \(score.seat)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
                .contentShape(.rect)
                .onTapGesture { withAnimation(.snappy) { isExpanded.toggle() } }
                .accessibilityAddTraits(.isButton)
            if isExpanded {
                breakdown.transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text("\(score.seat.number)")
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .frame(width: 30, height: 30)
                .background(Color(.tertiarySystemFill), in: .circle)
            PlayerAvatar(name: name, url: player?.avatarURL, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) {
                    Text(name).font(.body.weight(.semibold)).lineLimit(1)
                    if score.result == .win {
                        Image(systemName: "checkmark.seal.fill").font(.caption).foregroundStyle(.green)
                    }
                }
                HStack(spacing: 6) {
                    Text(score.role.displayName).font(.caption.weight(.medium)).foregroundStyle(score.role.team.tint)
                    if let status { Text(status).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
            }
            Spacer(minLength: 4)
            Text(score.total.description)
                .font(.title3.weight(.bold))
                .monospacedDigit()
                .contentTransition(.numericText())
            Image(systemName: "chevron.down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(isExpanded ? 180 : 0))
        }
    }

    // MARK: Расшифровка

    @ViewBuilder
    private var breakdown: some View {
        VStack(spacing: 8) {
            ScoreRow(title: score.resultTitle, points: score.resultPoints)
            if let editing {
                PickerRow(title: "Доп +", values: ScoreEditing.bonusValues, selection: editing.bonus)
                PickerRow(title: "Доп −", values: ScoreEditing.penaltyValues, selection: editing.penalty)
            } else {
                if score.extraBonus != .zero { ScoreRow(title: "Доп +", points: score.extraBonus) }
                if score.extraPenalty != .zero { ScoreRow(title: "Доп −", points: score.extraPenalty) }
            }
            protocolRow
            bestMoveRow
            ForEach(Array(score.disciplineLines.enumerated()), id: \.offset) { _, line in
                ScoreRow(title: line.title, points: line.points)
            }
            if let critical = editing?.isCriticalRemoval {
                Toggle("Удаление на критике (−1)", isOn: critical)
                    .font(.subheadline)
            }
            Divider()
            ScoreRow(title: "Итог", points: score.total, isTotal: true)
        }
    }

    @ViewBuilder
    private var protocolRow: some View {
        if let component = score.component(where: \.isProtocol) {
            ScoreRow(title: component.kind == .colorProtocol(firstKilled: true) ? "Протокол ПУ" : "Протокол",
                     points: component.points, action: editing?.onProtocol)
        } else if let onProtocol = editing?.onProtocol {
            AddRow(title: "Протокол", action: onProtocol)
        }
    }

    @ViewBuilder
    private var bestMoveRow: some View {
        if let component = score.component(where: \.isBestMove), case let .bestMove(guessed) = component.kind {
            ScoreRow(title: "Лучший ход", detail: "угадано \(guessed)", points: component.points, action: editing?.onBestMove)
        } else if let onBestMove = editing?.onBestMove {
            AddRow(title: "Лучший ход", action: onBestMove)
        }
    }
}

/// Строка расшифровки: название, пояснение и баллы. Если есть действие — нажатие правит значение.
private struct ScoreRow: View {
    let title: String
    var detail: String?
    let points: Points
    var isTotal = false
    var action: (() -> Void)?

    var body: some View {
        let row = HStack(spacing: 6) {
            Text(title).font(isTotal ? .headline : .subheadline)
            if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
            if action != nil { Image(systemName: "pencil").font(.caption).foregroundStyle(.tint) }
            Spacer()
            Text(isTotal ? points.description : points.signed)
                .font(isTotal ? .headline : .subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(isTotal || points == .zero ? AnyShapeStyle(.primary) : AnyShapeStyle(points > .zero ? Color.green : Color.red))
        }
        if let action {
            Button(action: action) { row.contentShape(.rect) }.buttonStyle(.plain)
        } else {
            row
        }
    }
}

/// Доп+ или Доп− — значение выбирается из шкалы ФСМ.
private struct PickerRow: View {
    let title: String
    let values: [Int]
    let selection: Binding<Int>

    var body: some View {
        HStack {
            Text(title).font(.subheadline)
            Spacer()
            Picker(title, selection: selection) {
                ForEach(values, id: \.self) { Text(Points(hundredths: $0).signed).tag($0) }
            }
            .pickerStyle(.menu)
            .labelsHidden()
        }
    }
}

private struct AddRow: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title).font(.subheadline)
                Spacer()
                Label("Записать", systemImage: "plus.circle").font(.subheadline.weight(.semibold))
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.tint)
    }
}

// MARK: - Разбор баллов по строкам

extension ScoreComponent.Kind {
    var isProtocol: Bool {
        if case .colorProtocol = self { true } else { false }
    }

    var isBestMove: Bool {
        if case .bestMove = self { true } else { false }
    }
}

extension PlayerGameScore {
    var resultTitle: String {
        switch result {
        case .win: "Победа"
        case .loss: "Поражение"
        case .draw: "Ничья"
        }
    }

    var resultPoints: Points {
        component { if case .result = $0 { true } else { false } }?.points ?? .zero
    }

    /// Допбаллы судьи (корректировки), отдельно плюсы и минусы.
    var extraBonus: Points { adjustments.filter { $0 > .zero }.sum() }
    var extraPenalty: Points { adjustments.filter { $0 < .zero }.sum() }

    private var adjustments: [Points] {
        components.compactMap { component in
            if case .adjustment = component.kind { component.points } else { nil }
        }
    }

    /// Техфолы, удаление, ППК, двойное деление — то, что считается по ходу игры.
    var disciplineLines: [(title: String, points: Points)] {
        components.compactMap { component in
            switch component.kind {
            case let .techFouls(count): (count == 1 ? "Техфол" : "Техфолы ×\(count)", component.points)
            case .removal: ("Удаление", component.points)
            case .criticalRemoval: ("Удаление на критике", component.points)
            case .forfeit: ("ППК", component.points)
            case .doubleSplit: ("Двойное деление", component.points)
            case .result, .bestMove, .adjustment, .colorProtocol: nil
            }
        }
    }

    func component(where matches: (ScoreComponent.Kind) -> Bool) -> ScoreComponent? {
        components.first { matches($0.kind) }
    }
}
