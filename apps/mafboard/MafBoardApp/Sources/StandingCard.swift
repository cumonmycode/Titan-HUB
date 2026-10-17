import SwiftUI
import MafBoardCore

// MARK: - Сводка игрока за вечер или период

/// Одна игра игрока в сводке: номер в вечере (или дата), роль, результат и баллы.
struct PlayedGame: Identifiable {
    let id: String
    let title: String
    let score: PlayerGameScore
}

/// Карточка игрока в таблице — стекло. Свёрнута: место, игрок, игры и победы, баллы.
/// Раскрыта: показатели, роли с победами и баллы по каждой игре.
struct StandingCard: View {
    let standing: PlayerStanding
    let player: PlayerProfile?
    let games: [PlayedGame]
    @State private var isExpanded = false

    /// Сколько игр показывать в раскрытой карточке — остальное числом.
    private static let gamesLimit = 12

    private var name: String { player?.nickname ?? "Игрок" }

    private var medal: Color? {
        switch standing.place {
        case 1: .yellow
        case 2: Color(white: 0.72)
        case 3: .orange
        default: nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
                .contentShape(.rect)
                .onTapGesture { withAnimation(.smooth(duration: 0.35)) { isExpanded.toggle() } }
                .accessibilityAddTraits(.isButton)
            if isExpanded {
                details.transition(.blurReplace.combined(with: .opacity))
            }
        }
        .padding(14)
        .glassEffect(.regular, in: .rect(cornerRadius: 26, style: .continuous))
        .sensoryFeedback(.selection, trigger: isExpanded)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("\(standing.place)")
                .font(.subheadline.weight(.heavy))
                .monospacedDigit()
                .frame(width: 32, height: 32)
                .background((medal ?? Color(.tertiarySystemFill)).opacity(medal == nil ? 1 : 0.35), in: .circle)
            PlayerAvatar(name: name, url: player?.avatarURL, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.body.weight(.semibold)).lineLimit(1)
                Text("Игр \(standing.gamesPlayed) · побед \(standing.wins) · \(percent(standing.winRate))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Spacer(minLength: 6)
            Text(standing.points.description)
                .font(.title3.weight(.bold))
                .monospacedDigit()
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.accentColor.opacity(0.16), in: .capsule)
            Image(systemName: "chevron.down")
                .font(.footnote.weight(.bold))
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(isExpanded ? 180 : 0))
        }
    }

    // MARK: Подробности

    private var details: some View {
        VStack(alignment: .leading, spacing: 16) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                StatTile(title: "Баллы", value: standing.points.description, tint: .accentColor)
                StatTile(title: "Средний", value: standing.averagePoints.formatted(.number.precision(.fractionLength(2))), tint: .accentColor)
                StatTile(title: "Побед", value: "\(standing.wins) из \(standing.gamesPlayed)", tint: .green)
                StatTile(title: "Допбаллы", value: standing.bonus.signed, tint: .green)
                StatTile(title: "Штрафы", value: (-standing.penalty).signed, tint: .red)
                StatTile(title: "Доп с учётом штрафов", value: standing.extraPoints.signed, tint: standing.extraPoints < .zero ? .red : .green)
                StatTile(title: "Лучших ходов", value: "\(standing.bestMoves)", tint: .orange)
                StatTile(title: "Убит в 1-ю ночь", value: "\(standing.firstNightDeaths)", tint: .indigo)
                StatTile(title: "Побед доном и шерифом", value: "\(standing.keyRoleWins)", tint: .purple)
            }

            VStack(alignment: .leading, spacing: 8) {
                SectionTitle("Роли")
                FlowRow(spacing: 8) {
                    ForEach(standing.roles, id: \.role) { stat in
                        HStack(spacing: 6) {
                            Text(stat.role.displayName).font(.subheadline.weight(.semibold)).foregroundStyle(stat.role.team.tint)
                            Text("\(stat.games) · \(stat.wins) поб.")
                                .font(.caption.weight(.medium))
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(stat.role.team.tint.opacity(0.12), in: .capsule)
                    }
                }
            }

            if !games.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle("Игры")
                    ForEach(games.suffix(Self.gamesLimit)) { game in
                        GameScoreLine(game: game)
                    }
                    if games.count > Self.gamesLimit {
                        Text("и ещё \(games.count - Self.gamesLimit)").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func percent(_ rate: Double) -> String {
        rate.formatted(.percent.precision(.fractionLength(0)))
    }
}

private struct SectionTitle: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
    }
}

private struct StatTile: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(.headline)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .foregroundStyle(tint)
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading)
        .padding(10)
        .background(tint.opacity(0.1), in: .rect(cornerRadius: 14, style: .continuous))
    }
}

/// Игра в сводке: «Игра 3 · Шериф» с расшифровкой и итогом.
private struct GameScoreLine: View {
    let game: PlayedGame

    private var icon: String {
        switch game.score.result {
        case .win: "checkmark"
        case .loss: "xmark"
        case .draw: "equal"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.caption.weight(.bold))
                .foregroundStyle(game.score.result == .win ? Color.green : Color.secondary)
                .frame(width: 26, height: 26)
                .background(Color.primary.opacity(0.06), in: .circle)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(game.title).font(.subheadline.weight(.medium))
                    Text(game.score.role.displayName).font(.caption.weight(.semibold)).foregroundStyle(game.score.role.team.tint)
                }
                if !game.score.breakdown.isEmpty {
                    Text(game.score.breakdown).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer(minLength: 6)
            Text(game.score.total.description).font(.subheadline.weight(.bold)).monospacedDigit()
        }
    }
}

/// Элементы в строку с переносом.
private struct FlowRow: Layout {
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

// MARK: - Сборка сводки

extension Collection where Element == FinishedGame {
    /// Игры каждого игрока по порядку. `title` — заголовок игры в сводке («Игра 3» или дата).
    func playedGames(title: (Int, FinishedGame) -> String) -> [PlayerID: [PlayedGame]] {
        var result: [PlayerID: [PlayedGame]] = [:]
        for (index, game) in enumerated() {
            for score in GameScorer.score(game.record) {
                result[score.playerID, default: []].append(
                    PlayedGame(id: "\(game.id)-\(score.seat)", title: title(index, game), score: score)
                )
            }
        }
        return result
    }

    /// Профили игроков по всем играм — для имён и аватаров в сводке.
    var playerProfiles: [PlayerID: PlayerProfile] {
        reduce(into: [:]) { result, game in
            for player in game.players { result[player.id] = player }
        }
    }
}
