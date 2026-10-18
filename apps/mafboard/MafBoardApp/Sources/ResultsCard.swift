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
        VStack(spacing: 12) {
            summary(scores)

            ForEach(scores) { score in
                PlayerScoreCard(
                    score: score,
                    player: game.profile(at: score.seat),
                    status: record.scoreStatus(of: score.seat),
                    isSheriffClaim: game.state.seat(score.seat)?.claimedSheriff ?? false,
                    editing: editing(for: score.seat)
                )
            }

            Label("Нажмите на игрока — расшифровка и правка баллов. Всё сохраняется сразу.", systemImage: "hand.tap")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 6)

            if let onNextGame {
                Button(action: onNextGame) {
                    Label("Ещё одна игра", systemImage: "plus").font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.extraLarge)
            }
        }
        .sheet(isPresented: $isShowingMemo) { ScoringMemoSheet() }
    }

    /// Шапка итогов: победитель, причина, памятка и лимиты допбаллов ФСМ.
    private func summary(_ scores: [PlayerGameScore]) -> some View {
        let winner = record.outcome.winner
        let bonusTotal = scores.map(\.bonus).sum()
        let bonusPlayers = scores.filter { $0.bonus > .zero }.count
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: winner == .draw ? "equal" : "trophy.fill")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 52, height: 52)
                    .background(winner.dot.gradient, in: .circle)
                VStack(alignment: .leading, spacing: 3) {
                    Text(winner.displayName).font(.title2.bold())
                    Text(record.outcome.reason.text).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    Button { isShowingMemo = true } label: {
                        Label("Памятка", systemImage: "book.pages.fill").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.glass)
                    ForEach(game.state.pendingBestMoveAuthors, id: \.self) { author in
                        Button { onBestMove(author) } label: {
                            Label("ЛХ №\(author)", systemImage: "star.fill").font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(.glassProminent)
                        .tint(.orange)
                    }
                    Spacer(minLength: 0)
                }
            }
            HStack(spacing: 10) {
                LimitGauge(title: "Плюсы за игру", value: bonusTotal.doubleValue, limit: Self.bonusLimit.doubleValue,
                           text: "\(bonusTotal.description) из \(Self.bonusLimit.description)")
                LimitGauge(title: "Игроков с плюсом", value: Double(bonusPlayers), limit: Double(Self.bonusPlayersLimit),
                           text: "\(bonusPlayers) из \(Self.bonusPlayersLimit)")
            }
        }
        .padding(18)
        .glassEffect(.regular.tint(winner.dot.opacity(0.12)), in: .rect(cornerRadius: 28, style: .continuous))
    }

    private func editing(for seat: Seat) -> ScoreEditing {
        let state = game.state
        let scoring = record.setup.scoring
        return ScoreEditing(
            bonus: Binding(get: { extras(of: seat).bonus }, set: { setExtras(seat, bonus: $0, penalty: extras(of: seat).penalty) }),
            penalty: Binding(get: { extras(of: seat).penalty }, set: { setExtras(seat, bonus: extras(of: seat).bonus, penalty: $0) }),
            onProtocol: state.mayLeaveProtocol(seat) ? { onProtocol(seat) } : nil,
            onBestMove: state.bestMoveAuthors.contains(seat) ? { onBestMove(seat) } : nil,
            sheriffClaim: Binding(get: { game.state.seat(seat)?.claimedSheriff ?? false },
                                  set: { game.perform(.markSheriffClaim(seat, $0)) }),
            techFouls: state.seat(seat)?.techFoulKinds ?? [],
            techFoulPenalty: scoring.techFoulPenalty,
            bigTechFoulPenalty: scoring.bigTechFoulPenalty ?? scoring.techFoulPenalty,
            onTechFoul: { kind in game.perform(kind == .big ? .bigTechFoul(seat) : .techFoul(seat)) },
            onCancelTechFoul: { game.perform(.cancelTechFoul(seat)) }
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

}

/// Правка итогов сыгранной игры из истории — тот же экран итогов, что после игры.
struct ResultsEditorSheet: View {
    let game: GameController
    @Environment(\.dismiss) private var dismiss
    @State private var bestMovePick: SeatPick?
    @State private var protocolPick: SeatPick?

    var body: some View {
        NavigationStack {
            ScrollView {
                if let record = game.record {
                    ResultsCard(
                        game: game, record: record,
                        onBestMove: { bestMovePick = SeatPick(seat: $0) },
                        onProtocol: { protocolPick = SeatPick(seat: $0) },
                        onNextGame: nil
                    )
                    .padding(.horizontal)
                    .padding(.bottom, 24)
                }
            }
            .ambientBackground()
            .navigationTitle("Итоги игры")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово", systemImage: "checkmark") { dismiss() }
                }
            }
            .sheet(item: $bestMovePick) { BestMoveSheet(game: game, author: $0.seat) }
            .sheet(item: $protocolPick) { ProtocolSheet(game: game, author: $0.seat) }
            .alert("Ошибка", isPresented: Binding(get: { game.errorMessage != nil }, set: { if !$0 { game.errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(game.errorMessage ?? "")
            }
        }
    }
}

/// Лимит ФСМ 8.4.1 шкалой: подсказка, не запрет — сверх лимита шкала краснеет.
private struct LimitGauge: View {
    let title: String
    let value: Double
    let limit: Double
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title).font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 4)
                Text(text).font(.caption.weight(.semibold)).monospacedDigit()
            }
            Gauge(value: min(value, limit), in: 0...limit) { EmptyView() }
                .gaugeStyle(.linearCapacity)
                .tint(value > limit ? .red : .green)
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 14, style: .continuous))
    }
}

extension GameRecord {
    /// Подпись в карточке баллов: «ПУ · убит мафией», «заголосован», «удалён за фолы».
    func scoreStatus(of seat: Seat) -> String? {
        guard let elimination = self.seat(seat)?.elimination else { return nil }
        var parts: [String] = []
        if firstKilled == seat { parts.append("ПУ") }
        parts.append(elimination.cause.label.lowercased())
        return parts.joined(separator: " · ")
    }
}
