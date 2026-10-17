import SwiftUI
import MafBoardCore

// MARK: - Итоги игры

/// Итоги на экране игры: победитель, памятка судьи и карточка баллов каждого игрока.
/// Всё, что ведущий правит здесь, сразу пересохраняется в историю и на сервер.
struct ResultsCard: View {
    let game: GameController
    let record: GameRecord
    let onBestMove: (Seat) -> Void
    let onProtocol: (Seat) -> Void
    let onNextGame: (() -> Void)?
    @State private var isShowingMemo = false

    /// Ограничения ФСМ 8.4.1: сумма плюсов за игру и сколько игроков с плюсом.
    private static let bonusLimit: Points = 4
    private static let bonusPlayersLimit = 7

    var body: some View {
        let scores = GameScorer.score(record)
        VStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 10) {
                            Circle().fill(record.outcome.winner.dot).frame(width: 12, height: 12)
                            Text(record.outcome.winner.displayName).font(.title2.bold())
                        }
                        Text(record.outcome.reason.text).font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Памятка", systemImage: "book.pages") { isShowingMemo = true }
                        .buttonStyle(.glass)
                        .controlSize(.small)
                }
                ForEach(game.state.pendingBestMoveAuthors, id: \.self) { author in
                    Button("Лучший ход игрока №\(author)", systemImage: "star.fill") { onBestMove(author) }
                        .buttonStyle(.bordered)
                }
                Text(limitsText(scores)).font(.caption).foregroundStyle(.secondary)
            }
            .gameCard()

            ForEach(scores) { score in
                PlayerScoreCard(
                    score: score,
                    player: game.profile(at: score.seat),
                    status: record.scoreStatus(of: score.seat),
                    editing: editing(for: score.seat)
                )
            }

            Text("Нажмите на игрока — расшифровка баллов. Доп+ и Доп− выставляет судья, правки сохраняются сразу.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)

            if let onNextGame {
                Button(action: onNextGame) {
                    Label("Следующая игра", systemImage: "plus").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
        }
        .sheet(isPresented: $isShowingMemo) { ScoringMemoSheet() }
    }

    private func editing(for seat: Seat) -> ScoreEditing {
        let state = game.state
        let seatState = state.seat(seat)
        let isRemoved = switch seatState?.elimination?.cause {
        case .removed(.fouls), .removed(.disqualified): true
        default: false
        }
        return ScoreEditing(
            bonus: Binding(get: { extras(of: seat).bonus }, set: { setExtras(seat, bonus: $0, penalty: extras(of: seat).penalty) }),
            penalty: Binding(get: { extras(of: seat).penalty }, set: { setExtras(seat, bonus: extras(of: seat).bonus, penalty: $0) }),
            onProtocol: state.mayLeaveProtocol(seat) ? { onProtocol(seat) } : nil,
            onBestMove: state.bestMoveAuthors.contains(seat) ? { onBestMove(seat) } : nil,
            isCriticalRemoval: isRemoved && record.setup.scoring.criticalRemovalPenalty != nil
                ? Binding(get: { game.state.seat(seat)?.isCriticalRemoval ?? false },
                          set: { game.perform(.markCriticalRemoval(seat, $0)) })
                : nil
        )
    }

    /// Сумма плюсов и минусов судьи у игрока, в сотых.
    private func extras(of seat: Seat) -> (bonus: Int, penalty: Int) {
        let points = game.state.scoreAdjustments.filter { $0.seat == seat }.map(\.points.hundredths)
        return (points.filter { $0 > 0 }.reduce(0, +), points.filter { $0 < 0 }.reduce(0, +))
    }

    private func setExtras(_ seat: Seat, bonus: Int, penalty: Int) {
        game.perform(.setScoreAdjustments(seat, [
            ScoreAdjustment(seat: seat, points: Points(hundredths: bonus), note: "Доп. балл"),
            ScoreAdjustment(seat: seat, points: Points(hundredths: penalty), note: "Доп. минус"),
        ]))
    }

    /// «Плюсы: 2.3 из 4 · игроков с плюсом: 5 из 7» — подсказка, не запрет.
    private func limitsText(_ scores: [PlayerGameScore]) -> String {
        let total = scores.map(\.bonus).sum()
        let players = scores.filter { $0.bonus > .zero }.count
        return "Плюсы за игру: \(total.description) из \(Self.bonusLimit.description) · игроков с плюсом: \(players) из \(Self.bonusPlayersLimit)"
    }
}

extension GameRecord {
    /// Подпись в карточке баллов: «ПУ · убит мафией», «заголосован», «удалён за фолы · на критике».
    func scoreStatus(of seat: Seat) -> String? {
        guard let state = self.seat(seat), let elimination = state.elimination else { return nil }
        var parts: [String] = []
        if firstKilled == seat { parts.append("ПУ") }
        parts.append(elimination.cause.label.lowercased())
        if state.isCriticalRemoval { parts.append("на критике") }
        return parts.joined(separator: " · ")
    }
}
