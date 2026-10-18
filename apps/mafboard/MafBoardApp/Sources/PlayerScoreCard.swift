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
    /// «Вскрылся шерифом» — отметка; баллы за вскрытие судья ставит в Доп+ или Доп−.
    let sheriffClaim: Binding<Bool>
    /// Техфолы игрока по порядку: судья ставит и снимает их и после игры.
    let techFouls: [TechFoulKind]
    let techFoulPenalty: Points
    let bigTechFoulPenalty: Points
    let onTechFoul: (TechFoulKind) -> Void
    let onCancelTechFoul: () -> Void

    /// Положительный допбалл — от +0.2 до +1.0 (ФСМ 8.4.3), отрицательный — от −1.0 до −0.2 (8.4.4). По возрастанию.
    static let bonusScale = [0] + Array(stride(from: 20, through: 100, by: 10))
    static let penaltyScale = bonusScale.reversed().map { -$0 }
}

/// Карточка игрока в итогах — стекло. Свёрнута: номер, имя, роль, значки и итог.
/// Раскрыта: из чего сложился итог, а у ведущего — ещё и правка допбаллов, техфолов, ЛХ и протокола.
struct PlayerScoreCard: View {
    let score: PlayerGameScore
    let player: PlayerProfile?
    /// «ПУ · убит мафией», «удалён за фолы».
    let status: String?
    /// Игрок вскрывался шерифом.
    var isSheriffClaim = false
    var editing: ScoreEditing?
    @State private var isExpanded = false

    private var name: String { player?.nickname ?? "Игрок \(score.seat)" }
    private var teamTint: Color { score.role.team.tint }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
                .contentShape(.rect)
                .onTapGesture { withAnimation(.smooth(duration: 0.35)) { isExpanded.toggle() } }
                .accessibilityAddTraits(.isButton)
                .accessibilityHint(isExpanded ? "Свернуть" : "Подробнее о баллах")
            if isExpanded {
                details.transition(.blurReplace.combined(with: .opacity))
            }
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 26, style: .continuous))
        .sensoryFeedback(.selection, trigger: isExpanded)
    }

    // MARK: Шапка

    private var header: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                PlayerAvatar(name: name, url: player?.avatarURL, size: 44)
                Text("\(score.seat.number)")
                    .font(.caption2.weight(.heavy))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .frame(minWidth: 18, minHeight: 18)
                    .background(teamTint.gradient, in: .circle)
                    .overlay { Circle().stroke(.background, lineWidth: 2) }
                    .offset(x: 4, y: 4)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(name).font(.body.weight(.semibold)).lineLimit(1)
                HStack(spacing: 6) {
                    Text(score.role.displayName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(teamTint)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(teamTint.opacity(0.15), in: .capsule)
                    if isSheriffClaim {
                        Image(systemName: "checkmark.shield.fill").font(.caption2).foregroundStyle(.orange)
                    }
                    ForEach(score.badges, id: \.self) { icon in
                        Image(systemName: icon).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if let status {
                    Text(status).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            Text(score.total.description)
                .font(.title2.weight(.bold))
                .monospacedDigit()
                .contentTransition(.numericText(value: score.total.doubleValue))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(totalTint.opacity(0.18), in: .capsule)
                .foregroundStyle(totalTint == .secondary ? Color.primary : totalTint)
            Image(systemName: "chevron.down")
                .font(.footnote.weight(.bold))
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(isExpanded ? 180 : 0))
        }
    }

    private var totalTint: Color {
        if score.total > .zero { return .green }
        if score.total < .zero { return .red }
        return .secondary
    }

    // MARK: Подробности

    private var details: some View {
        VStack(spacing: 14) {
            VStack(spacing: 10) {
                ForEach(score.lines(includeExtras: editing == nil, editing: editing)) { line in
                    LineRow(line: line)
                }
                if isSheriffClaim, editing == nil {
                    HStack(spacing: 12) {
                        IconBadge(icon: "checkmark.shield.fill", tint: .orange)
                        Text("Вскрылся шерифом").font(.subheadline.weight(.medium))
                        Spacer()
                    }
                }
            }
            if let editing {
                VStack(spacing: 10) {
                    ExtraStepper(title: "Доп +", icon: "plus", tint: .green, scale: ScoreEditing.bonusScale, value: editing.bonus)
                    ExtraStepper(title: "Доп −", icon: "minus", tint: .red, scale: ScoreEditing.penaltyScale, value: editing.penalty)
                    TechFoulStepper(editing: editing)
                }
                .padding(12)
                .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 18, style: .continuous))
                ActionChips(score: score, editing: editing)
            }
            HStack {
                Text("Итог").font(.headline)
                Spacer()
                Text(score.total.description)
                    .font(.title3.weight(.bold))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: score.total.doubleValue))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(totalTint.opacity(0.14), in: .capsule)
        }
    }
}

// MARK: - Строки расшифровки

/// Строка расшифровки: значок, название, пояснение и баллы. С действием — нажатие открывает правку.
struct ScoreLine: Identifiable {
    let id: String
    let icon: String
    let tint: Color
    let title: String
    var detail: String?
    let points: Points
    var action: (() -> Void)?
}

private struct LineRow: View {
    let line: ScoreLine

    var body: some View {
        let row = HStack(spacing: 12) {
            IconBadge(icon: line.icon, tint: line.tint)
            VStack(alignment: .leading, spacing: 1) {
                Text(line.title).font(.subheadline.weight(.medium))
                if let detail = line.detail {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(line.points.signed)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(line.points == .zero ? AnyShapeStyle(.secondary) : AnyShapeStyle(line.points > .zero ? Color.green : Color.red))
            if line.action != nil {
                Image(systemName: "pencil.circle.fill").font(.title3).foregroundStyle(.tint)
            }
        }
        if let action = line.action {
            Button(action: action) { row.contentShape(.rect) }.buttonStyle(.plain)
        } else {
            row
        }
    }
}

private struct IconBadge: View {
    let icon: String
    let tint: Color

    var body: some View {
        Image(systemName: icon)
            .font(.footnote.weight(.bold))
            .foregroundStyle(tint)
            .frame(width: 30, height: 30)
            .background(tint.opacity(0.16), in: .circle)
    }
}

// MARK: - Правка допбаллов

/// Доп+ или Доп−: «−» и «+» шагают по шкале ФСМ, нажатие на число — сразу нужное значение.
private struct ExtraStepper: View {
    let title: String
    let icon: String
    let tint: Color
    /// По возрастанию.
    let scale: [Int]
    @Binding var value: Int

    /// Позиция текущего значения; значение не со шкалы (старые пресеты) — ближайшая.
    private var index: Int {
        scale.firstIndex(of: value) ?? scale.indices.min { abs(scale[$0] - value) < abs(scale[$1] - value) } ?? 0
    }

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(icon: icon, tint: tint)
            Text(title).font(.subheadline.weight(.semibold))
            Spacer(minLength: 4)
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 6) {
                    Button { step(-1) } label: {
                        Image(systemName: "minus").font(.body.weight(.bold)).frame(width: 26, height: 26)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .disabled(index == 0)
                    .accessibilityLabel("Меньше")

                    Menu {
                        ForEach(scale.reversed(), id: \.self) { option in
                            Button(Points(hundredths: option).signed) { value = option }
                        }
                    } label: {
                        Text(Points(hundredths: value).signed)
                            .font(.headline)
                            .monospacedDigit()
                            .foregroundStyle(value == 0 ? AnyShapeStyle(.secondary) : AnyShapeStyle(tint))
                            .contentTransition(.numericText(value: Double(value)))
                            .frame(minWidth: 54, minHeight: 26)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.capsule)

                    Button { step(1) } label: {
                        Image(systemName: "plus").font(.body.weight(.bold)).frame(width: 26, height: 26)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .disabled(index == scale.count - 1)
                    .accessibilityLabel("Больше")
                }
            }
        }
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
        .accessibilityValue(Points(hundredths: value).signed)
    }

    private func step(_ direction: Int) {
        let next = min(max(index + direction, 0), scale.count - 1)
        withAnimation(.snappy) { value = scale[next] }
    }
}

/// Техфолы после игры: «−» снимает последний, «+» — обычный техфол, удержание «+» — большой.
private struct TechFoulStepper: View {
    let editing: ScoreEditing

    private var kinds: [TechFoulKind] { editing.techFouls }

    private var detail: String? {
        guard !kinds.isEmpty else { return nil }
        let big = kinds.filter { $0 == .big }.count
        return big == 0 ? nil : "из них больших: \(big)"
    }

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(icon: "exclamationmark.triangle.fill", tint: .red)
            VStack(alignment: .leading, spacing: 1) {
                Text("Техфолы").font(.subheadline.weight(.semibold))
                if let detail {
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            GlassEffectContainer(spacing: 6) {
                HStack(spacing: 6) {
                    Button(action: editing.onCancelTechFoul) {
                        Image(systemName: "minus").font(.body.weight(.bold)).frame(width: 26, height: 26)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .disabled(kinds.isEmpty)
                    .accessibilityLabel("Снять техфол")

                    Text("\(kinds.count)")
                        .font(.headline)
                        .monospacedDigit()
                        .foregroundStyle(kinds.isEmpty ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.red))
                        .contentTransition(.numericText(value: Double(kinds.count)))
                        .frame(minWidth: 54, minHeight: 26)

                    Menu {
                        Button("Техфол \((-editing.techFoulPenalty).signed)", systemImage: "exclamationmark.triangle.fill") {
                            editing.onTechFoul(.ordinary)
                        }
                        Button("Большой техфол \((-editing.bigTechFoulPenalty).signed)", systemImage: "exclamationmark.octagon.fill") {
                            editing.onTechFoul(.big)
                        }
                    } label: {
                        Image(systemName: "plus").font(.body.weight(.bold)).frame(width: 26, height: 26)
                    } primaryAction: {
                        editing.onTechFoul(.ordinary)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Поставить техфол")
                    .accessibilityHint("Удержание — большой техфол")
                }
            }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: kinds.count)
        .accessibilityElement(children: .contain)
    }
}

/// Действия в раскрытой карточке: записать ЛХ или протокол, отметить вскрытие шерифом.
private struct ActionChips: View {
    let score: PlayerGameScore
    let editing: ScoreEditing

    private var needsBestMove: Bool { editing.onBestMove != nil && score.component(where: \.isBestMove) == nil }
    private var needsProtocol: Bool { editing.onProtocol != nil && score.component(where: \.isProtocol) == nil }

    var body: some View {
        GlassEffectContainer(spacing: 8) {
            ChipFlow(spacing: 8) {
                if needsBestMove, let onBestMove = editing.onBestMove {
                    Button(action: onBestMove) {
                        Label("Лучший ход", systemImage: "star.fill").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.orange)
                }
                if needsProtocol, let onProtocol = editing.onProtocol {
                    Button(action: onProtocol) {
                        Label("Протокол", systemImage: "list.clipboard.fill").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.glass)
                }
                ToggleChip(title: "Вскрылся шерифом", icon: "checkmark.shield.fill", tint: .orange, isOn: editing.sheriffClaim)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Переключатель-чип: выключен — прозрачное стекло, включён — цветное с галочкой.
private struct ToggleChip: View {
    let title: String
    let icon: String
    let tint: Color
    @Binding var isOn: Bool

    var body: some View {
        let label = Label(title, systemImage: isOn ? "checkmark.circle.fill" : icon)
            .font(.subheadline.weight(.semibold))
        Group {
            if isOn {
                Button { isOn = false } label: { label }.buttonStyle(.glassProminent).tint(tint)
            } else {
                Button { isOn = true } label: { label }.buttonStyle(.glass)
            }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: isOn)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// Чипы в строку с переносом — как теги.
private struct ChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(widest, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
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

    /// Значки в свёрнутой карточке: что есть в баллах игрока.
    var badges: [String] {
        components.compactMap { component in
            switch component.kind {
            case .bestMove: "star.fill"
            case .colorProtocol: "list.clipboard.fill"
            case .techFouls: "exclamationmark.triangle.fill"
            case .removal, .criticalRemoval: "person.fill.xmark"
            case .forfeit: "exclamationmark.octagon.fill"
            case .result, .adjustment, .doubleSplit: nil
            }
        }
    }

    /// Строки расшифровки в порядке: результат, допбаллы, протокол, ЛХ, штрафы.
    /// - Parameter includeExtras: показывать Доп+ и Доп− строками (в истории); у ведущего они в правке.
    func lines(includeExtras: Bool, editing: ScoreEditing?) -> [ScoreLine] {
        var lines = [ScoreLine(
            id: "result", icon: result == .win ? "trophy.fill" : (result == .draw ? "equal" : "xmark"),
            tint: result == .win ? .yellow : .gray, title: resultTitle, points: resultPoints
        )]
        if includeExtras {
            if extraBonus != .zero { lines.append(ScoreLine(id: "bonus", icon: "plus", tint: .green, title: "Доп +", points: extraBonus)) }
            if extraPenalty != .zero { lines.append(ScoreLine(id: "penalty", icon: "minus", tint: .red, title: "Доп −", points: extraPenalty)) }
        }
        for component in components {
            switch component.kind {
            case let .colorProtocol(firstKilled):
                lines.append(ScoreLine(id: "protocol", icon: "list.clipboard.fill", tint: .blue,
                                       title: firstKilled ? "Протокол ПУ" : "Протокол", points: component.points,
                                       action: editing?.onProtocol))
            case let .bestMove(guessed):
                lines.append(ScoreLine(id: "bestMove", icon: "star.fill", tint: .orange, title: "Лучший ход",
                                       detail: "угадано чёрных: \(guessed)", points: component.points,
                                       action: editing?.onBestMove))
            case let .techFouls(count):
                lines.append(ScoreLine(id: "techFouls", icon: "exclamationmark.triangle.fill", tint: .red,
                                       title: count == 1 ? "Техфол" : "Техфолы ×\(count)", points: component.points))
            case .removal:
                lines.append(ScoreLine(id: "removal", icon: "person.fill.xmark", tint: .red, title: "Удаление", points: component.points))
            case .criticalRemoval:
                lines.append(ScoreLine(id: "removal", icon: "person.fill.xmark", tint: .red, title: "Удаление",
                                       detail: "отдало победу соперникам", points: component.points))
            case .forfeit:
                lines.append(ScoreLine(id: "forfeit", icon: "exclamationmark.octagon.fill", tint: .red, title: "ППК", points: component.points))
            case .doubleSplit:
                lines.append(ScoreLine(id: "doubleSplit", icon: "equal.circle.fill", tint: .orange, title: "Двойное деление", points: component.points))
            case .result, .adjustment:
                break
            }
        }
        return lines
    }

    func component(where matches: (ScoreComponent.Kind) -> Bool) -> ScoreComponent? {
        components.first { matches($0.kind) }
    }
}
