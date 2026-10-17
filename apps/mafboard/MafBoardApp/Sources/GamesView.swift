import SwiftUI
import MafBoardCore

/// Вкладка «Игры»: идущая игра, открытые вечера и история.
struct GamesView: View {
    @Environment(GameLibrary.self) private var library
    let onNewGame: (Evening?) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let active = library.active {
                        ActiveGameCard(game: active)
                    }
                    ForEach(library.openEvenings) { evening in
                        EveningCard(evening: evening, isGameRunning: library.active != nil) { onNewGame(evening) }
                    }
                    if library.active == nil, library.openEvenings.isEmpty {
                        StartCard { onNewGame(nil) }
                    }
                    if !library.closedEvenings.isEmpty {
                        Text("История").font(.title2.bold()).padding(.top, 8)
                        VStack(spacing: 10) {
                            ForEach(library.closedEvenings) { evening in
                                NavigationLink {
                                    EveningDetailView(evening: evening)
                                } label: {
                                    HistoryEveningCard(evening: evening)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .tabBarClearance()
            .ambientBackground()
            .navigationTitle("Игры")
            .profileButton()
        }
    }
}

// MARK: - Общее

extension View {
    /// Карточка на матовом стекле — сквозь неё мягко просвечивает живой фон.
    func contentCard(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial, in: .rect(cornerRadius: 24, style: .continuous))
    }
}

/// «47 мин», «1 ч 05 мин».
func durationText(from start: Date, to end: Date) -> String {
    let minutes = max(0, Int(end.timeIntervalSince(start) / 60))
    return minutes < 60 ? "\(minutes) мин" : "\(minutes / 60) ч \(String(format: "%02d", minutes % 60)) мин"
}

/// «1 игра», «3 игры», «5 игр».
func gamesPlayed(_ count: Int) -> String {
    let tail = count % 100
    let last = count % 10
    if (11...14).contains(tail) || last == 0 || (5...9).contains(last) { return "\(count) игр" }
    return last == 1 ? "\(count) игра" : "\(count) игры"
}

/// Полоса побед: красная часть — мирные, синяя — мафия, серая — ничьи.
private struct WinsBar: View {
    let winners: [Winner]

    var body: some View {
        let red = winners.filter { $0 == .red }.count
        let black = winners.filter { $0 == .black }.count
        let draw = winners.count - red - black
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { proxy in
                let total = CGFloat(max(winners.count, 1))
                HStack(spacing: 2) {
                    if red > 0 { Capsule().fill(Winner.red.dot).frame(width: proxy.size.width * CGFloat(red) / total) }
                    if draw > 0 { Capsule().fill(Winner.draw.dot).frame(width: proxy.size.width * CGFloat(draw) / total) }
                    if black > 0 { Capsule().fill(Winner.black.dot) }
                }
            }
            .frame(height: 6)
            HStack(spacing: 12) {
                legend(.red, red)
                legend(.black, black)
                if draw > 0 { legend(.draw, draw) }
            }
            .font(.caption)
        }
    }

    private func legend(_ winner: Winner, _ count: Int) -> some View {
        HStack(spacing: 4) {
            Circle().fill(winner.dot).frame(width: 7, height: 7)
            Text("\(winner.shortName) \(count)").foregroundStyle(.secondary).monospacedDigit()
        }
    }
}

// MARK: - Идущая игра

private struct ActiveGameCard: View {
    let game: SavedGame
    @Environment(GameLibrary.self) private var library
    @State private var isConfirmingDelete = false

    var body: some View {
        let state = game.session.state
        let setup = game.session.setup
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Идёт игра", systemImage: "circle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tint)
                    .symbolEffect(.pulse, options: .repeating)
                    .textCase(.uppercase)
                Spacer()
                FormatTag(format: setup.format)
                Menu {
                    Button("Удалить игру", systemImage: "trash", role: .destructive) { isConfirmingDelete = true }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(state.currentStep.title(in: state)).font(.title2.bold())
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    Text("\(setup.variant.displayName) · \(state.moment.displayName) · идёт \(durationText(from: setup.createdAt, to: context.date))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            SeatStrip(state: state)
            Button {
                library.resumeActive()
            } label: {
                Label("Продолжить", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
        .contentCard(padding: 18)
        .confirmationDialog("Удалить игру?", isPresented: $isConfirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { library.discardActive() }
        } message: {
            Text("Игра не попадёт в историю.")
        }
    }
}

/// Места за столом одной строкой: в игре — закрашены, выбывшие — пустые, говорящий — в акценте.
private struct SeatStrip: View {
    let state: GameState

    var body: some View {
        HStack(spacing: 4) {
            ForEach(state.seats) { seat in
                let isSpeaker = state.currentSpeaker == seat.seat
                Text("\(seat.seat.number)")
                    .font(.caption2.weight(.bold))
                    .monospacedDigit()
                    .foregroundStyle(seat.isAlive ? (isSpeaker ? Color.white : Color.primary) : Color.secondary)
                    .frame(maxWidth: .infinity, minHeight: 24)
                    .background {
                        if isSpeaker {
                            Circle().fill(.tint)
                        } else if seat.isAlive {
                            Circle().fill(Color.primary.opacity(0.1))
                        } else {
                            Circle().strokeBorder(Color.secondary.opacity(0.4), lineWidth: 1)
                        }
                    }
                    .overlay {
                        if !seat.isAlive {
                            Rectangle().fill(Color.secondary.opacity(0.6)).frame(height: 1).rotationEffect(.degrees(-45))
                        }
                    }
            }
        }
        .accessibilityElement()
        .accessibilityLabel("В игре \(state.aliveSeats.count) из \(state.seats.count)")
    }
}

// MARK: - Начало

private struct StartCard: View {
    let action: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "theatermasks.fill")
                .font(.system(size: 48))
                .foregroundStyle(.tint)
                .padding(.top, 8)
            VStack(spacing: 6) {
                Text("Начните вечер").font(.title2.bold())
                Text("Выберите игру и режим, посадите игроков — приложение раздаст роли и проведёт игру.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: action) {
                Label("Новая игра", systemImage: "plus").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity)
        .contentCard(padding: 20)
    }
}

// MARK: - Вечер

/// Открытый вечер: побед по командам, игры, «Следующая игра» и итоги.
private struct EveningCard: View {
    let evening: Evening
    let isGameRunning: Bool
    let onNext: () -> Void
    @Environment(GameLibrary.self) private var library
    @State private var isConfirmingClose = false

    var body: some View {
        let games = library.games(of: evening)
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(evening.title).font(.title3.bold())
                    Text("\(evening.variant.displayName) · \(gamesPlayed(games.count))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                FormatTag(format: evening.format)
                Menu {
                    Button("Завершить вечер", systemImage: "checkmark.circle") { isConfirmingClose = true }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(.secondary)
                }
            }

            if !games.isEmpty {
                WinsBar(winners: games.map(\.record.outcome.winner))
                VStack(spacing: 0) {
                    ForEach(Array(games.enumerated()), id: \.element.id) { index, game in
                        NavigationLink {
                            FinishedGameView(game: game, number: index + 1)
                        } label: {
                            GameLine(game: game, number: index + 1)
                        }
                        .buttonStyle(.plain)
                        if index < games.count - 1 { Divider().padding(.leading, 16) }
                    }
                }
                .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 16, style: .continuous))
            } else {
                Text("Игр пока нет — начните первую.").font(.subheadline).foregroundStyle(.secondary)
            }

            HStack(spacing: 10) {
                if !isGameRunning {
                    Button(action: onNext) {
                        Label(games.isEmpty ? "Первая игра" : "Следующая игра", systemImage: "plus")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                }
                if !games.isEmpty {
                    NavigationLink {
                        EveningDetailView(evening: evening)
                    } label: {
                        Label("Итоги", systemImage: "list.number").frame(maxWidth: isGameRunning ? .infinity : nil)
                    }
                    .buttonStyle(.glass)
                }
            }
            .controlSize(.large)
        }
        .contentCard(padding: 18)
        .confirmationDialog("Завершить вечер?", isPresented: $isConfirmingClose, titleVisibility: .visible) {
            Button("Завершить") { library.closeEvening(evening.id) }
        } message: {
            Text("Вечер уйдёт в историю вместе с итогами.")
        }
    }
}

/// Строка игры: цветная метка победителя, номер, итог, время и длительность.
private struct GameLine: View {
    let game: FinishedGame
    let number: Int

    var body: some View {
        let record = game.record
        HStack(spacing: 12) {
            Capsule().fill(record.outcome.winner.dot).frame(width: 4, height: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text("Игра \(number)").font(.subheadline.weight(.semibold))
                Text(record.outcome.winner.displayName).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(record.finishedAt.formatted(date: .omitted, time: .shortened)).font(.subheadline).monospacedDigit()
                Text(durationText(from: record.startedAt, to: record.finishedAt)).font(.caption).foregroundStyle(.secondary)
            }
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(.rect)
    }
}

// MARK: - История

/// Прошлый вечер: листок календаря, режим, число игр и полоса побед.
private struct HistoryEveningCard: View {
    let evening: Evening
    @Environment(GameLibrary.self) private var library

    var body: some View {
        let games = library.games(of: evening)
        HStack(spacing: 14) {
            VStack(spacing: 0) {
                Text(evening.createdAt.formatted(.dateTime.month(.abbreviated)))
                    .font(.caption2.weight(.bold))
                    .textCase(.uppercase)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 2)
                    .background(evening.format.tint)
                Text(evening.createdAt.formatted(.dateTime.day()))
                    .font(.title2.bold())
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(width: 52, height: 56)
            .background(Color.primary.opacity(0.06))
            .clipShape(.rect(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(evening.format.displayName).font(.headline)
                    Text(evening.variant.displayName).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(gamesPlayed(games.count))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                MiniWinsBar(winners: games.map(\.record.outcome.winner))
            }
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentCard(padding: 12)
        .contentShape(.rect)
    }
}

private struct MiniWinsBar: View {
    let winners: [Winner]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(winners.enumerated()), id: \.offset) { _, winner in
                Capsule().fill(winner.dot).frame(width: 14, height: 4)
            }
        }
    }
}

// MARK: - Подробности

/// Вечер: подиум итогов и все его игры.
struct EveningDetailView: View {
    let evening: Evening
    @Environment(GameLibrary.self) private var library

    var body: some View {
        let games = library.games(of: evening)
        let standings = StandingsCalculator.standings(of: games.map(\.record))
        let played = games.playedGames { index, _ in "Игра \(index + 1)" }
        let profiles = games.playerProfiles
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("Итоги").font(.title3.bold())
                        Spacer()
                        FormatTag(format: evening.format)
                    }
                    if !games.isEmpty { WinsBar(winners: games.map(\.record.outcome.winner)) }
                    Text(evening.format.countsTowardStandings
                         ? "Сумма баллов за вечер. Нажмите на игрока — подробности по баллам, ролям и играм."
                         : "Фанка в рейтинги не идёт — это сумма баллов за вечер. Нажмите на игрока — подробности.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .contentCard(padding: 18)

                VStack(spacing: 10) {
                    ForEach(standings) { standing in
                        StandingCard(standing: standing, player: profiles[standing.playerID], games: played[standing.playerID] ?? [])
                    }
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Игры").font(.title3.bold())
                    VStack(spacing: 0) {
                        ForEach(Array(games.enumerated()), id: \.element.id) { index, game in
                            NavigationLink {
                                FinishedGameView(game: game, number: index + 1)
                            } label: {
                                GameLine(game: game, number: index + 1)
                            }
                            .buttonStyle(.plain)
                            if index < games.count - 1 { Divider().padding(.leading, 16) }
                        }
                    }
                }
                .contentCard(padding: 18)
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .tabBarClearance()
        .ambientBackground()
        .navigationTitle(evening.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Законченная игра: крупный итог, подробности и игроки с ролями и баллами.
struct FinishedGameView: View {
    let initial: FinishedGame
    let number: Int
    @Environment(GameLibrary.self) private var library
    @State private var editor: GameController?

    init(game: FinishedGame, number: Int) {
        initial = game
        self.number = number
    }

    /// Свежая версия из истории: после правки итогов экран сразу показывает новые баллы.
    private var game: FinishedGame { library.history.first { $0.id == initial.id } ?? initial }
    private var record: GameRecord { game.record }

    private var reason: String { record.outcome.reason.text }

    var body: some View {
        let winner = record.outcome.winner
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        FormatTag(format: record.format)
                        Spacer()
                        Text(record.id.shortCode).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                    Text(winner.displayName)
                        .font(.largeTitle.bold())
                        .foregroundStyle(winner.dot)
                    Text(reason).font(.subheadline).foregroundStyle(.secondary)
                    HStack(spacing: 16) {
                        Label(record.finishedAt.formatted(date: .abbreviated, time: .shortened), systemImage: "calendar")
                        Label(durationText(from: record.startedAt, to: record.finishedAt), systemImage: "clock")
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    if game.isUploaded {
                        Label("Сохранена на сервере", systemImage: "checkmark.icloud").font(.footnote).foregroundStyle(.green)
                    }
                }
                .contentCard(padding: 18)

                ForEach(record.bestMoves, id: \.author) { bestMove in
                    let guessed = bestMove.seats.filter { record.seat($0)?.team == .black }.count
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Лучший ход игрока №\(bestMove.author)", systemImage: "star.fill").font(.headline)
                        Text("Назвал \(bestMove.seats.map { "№\($0)" }.joined(separator: ", ")) — угадано чёрных: \(guessed)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .contentCard()
                }
                if !record.protocols.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Протоколы", systemImage: "list.clipboard.fill").font(.headline)
                        ForEach(record.protocols, id: \.author) { proto in
                            Text("№\(proto.author): " + proto.summary.lowercased())
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .contentCard()
                }

                NavigationLink {
                    GameLogView(events: record.events) { game.profile(at: $0)?.nickname ?? "Игрок \($0)" }
                        .tabBarClearance()
                } label: {
                    HStack {
                        Label("Ход игры", systemImage: "list.bullet.rectangle.portrait").font(.headline)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }
                    .contentCard()
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Игроки и баллы").font(.title3.bold()).padding(.horizontal, 4)
                    ForEach(GameScorer.score(record)) { score in
                        PlayerScoreCard(
                            score: score, player: game.profile(at: score.seat), status: record.scoreStatus(of: score.seat),
                            isSheriffClaim: record.seat(score.seat)?.claimedSheriff ?? false
                        )
                    }
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .tabBarClearance()
        .ambientBackground()
        .navigationTitle("Игра \(number)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Изменить итоги", systemImage: "square.and.pencil") { editor = library.editor(for: game) }
            }
        }
        .sheet(item: $editor) { ResultsEditorSheet(game: $0) }
    }
}
