import SwiftUI
import MafBoardCore

/// Вкладка «Игры»: папки по типу игры, режиму и дате. Сверху активные (в них идёт игра или вечер продолжается),
/// ниже завершённые — от новых к старым. Идущая игра живёт внутри своей папки.
struct GamesView: View {
    @Environment(GameLibrary.self) private var library
    let onNewGame: (Evening?) -> Void

    var body: some View {
        let running = library.active
        let runningFolder = running?.session.setup.seriesID
        let active = library.evenings
            .filter { $0.isOpen || $0.id == runningFolder }
            .sorted { $0.updatedAt > $1.updatedAt }
        let completed = library.closedEvenings.filter { $0.id != runningFolder }
        // Игра без своей папки (сыграна до папок или папка не найдена) — отдельной карточкой.
        let orphan = running.flatMap { game in active.contains { $0.id == runningFolder } ? nil : game }

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if !active.isEmpty || orphan != nil {
                        FolderSectionTitle("Активные")
                    }
                    if let orphan {
                        RunningGameBlock(game: orphan).folderCard()
                    }
                    ForEach(active) { evening in
                        FolderCard(
                            evening: evening,
                            running: running?.session.setup.seriesID == evening.id ? running : nil,
                            isGameRunning: running != nil
                        ) { onNewGame(evening) }
                    }
                    if active.isEmpty, orphan == nil {
                        StartCard { onNewGame(nil) }
                    }
                    if !completed.isEmpty {
                        FolderSectionTitle("Завершённые").padding(.top, 10)
                        VStack(spacing: 10) {
                            ForEach(completed) { evening in
                                NavigationLink {
                                    EveningDetailView(evening: evening)
                                } label: {
                                    CompletedFolderRow(evening: evening)
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

private struct FolderSectionTitle: View {
    let text: String

    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text).font(.title2.bold()).padding(.horizontal, 4)
    }
}

extension GameVariant {
    /// «Спорт», «Город» — в названиях папок.
    var shortName: String {
        switch self {
        case .sport: "Спорт"
        case .city: "Город"
        }
    }

    var icon: String {
        switch self {
        case .sport: "person.3.sequence.fill"
        case .city: "building.2.fill"
        }
    }
}

extension View {
    /// Карточка папки на главном экране — стекло.
    func folderCard(padding: CGFloat = 16) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: 26, style: .continuous))
    }
}

/// Значок папки: цвет режима, внутри — значок типа игры.
private struct FolderIcon: View {
    let evening: Evening
    var size: CGFloat = 46

    var body: some View {
        ZStack {
            Image(systemName: "folder.fill")
                .font(.system(size: size))
                .foregroundStyle(evening.format.tint.gradient)
            Image(systemName: evening.variant.icon)
                .font(.system(size: size * 0.3, weight: .semibold))
                .foregroundStyle(.white)
                .offset(y: size * 0.06)
        }
        .frame(width: size + 6, height: size)
        .accessibilityHidden(true)
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

/// Идущая игра: шаг, время, места и «Продолжить». Внутри своей папки или отдельно.
private struct RunningGameBlock: View {
    let game: SavedGame
    @Environment(GameLibrary.self) private var library
    @State private var isConfirmingDelete = false

    var body: some View {
        let state = game.session.state
        let setup = game.session.setup
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Идёт игра", systemImage: "circle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tint)
                    .symbolEffect(.pulse, options: .repeating)
                    .textCase(.uppercase)
                Spacer()
                Menu {
                    Button("Удалить игру", systemImage: "trash", role: .destructive) { isConfirmingDelete = true }
                } label: {
                    Image(systemName: "ellipsis").font(.subheadline.weight(.semibold)).frame(width: 28, height: 28)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(state.currentStep.title(in: state)).font(.title3.bold())
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    Text("\(state.moment.displayName) · идёт \(durationText(from: setup.createdAt, to: context.date))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            SeatStrip(state: state)
            Button {
                library.resumeActive()
            } label: {
                Label("Продолжить", systemImage: "play.fill").font(.headline).frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
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
                Text("Создайте первую папку").font(.title2.bold())
                Text("Выберите игру и режим — игры одного типа и дня соберутся в одну папку.")
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
        .folderCard(padding: 20)
    }
}

// MARK: - Активная папка

/// Активная папка: тип, режим и дата, идущая игра, сыгранные игры, «Следующая игра» и «Итоги».
private struct FolderCard: View {
    let evening: Evening
    /// Идущая игра этой папки.
    let running: SavedGame?
    let isGameRunning: Bool
    let onNext: () -> Void
    @Environment(GameLibrary.self) private var library
    @State private var isConfirmingClose = false

    var body: some View {
        let games = library.games(of: evening)
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                FolderIcon(evening: evening)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(evening.variant.shortName) · \(evening.format.displayName)").font(.title3.bold()).lineLimit(1)
                    Text("\(evening.createdAt.formatted(.dateTime.day().month(.wide))) · \(gamesPlayed(games.count))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                Menu {
                    Button("Завершить папку", systemImage: "checkmark.circle") { isConfirmingClose = true }
                } label: {
                    Image(systemName: "ellipsis").font(.subheadline.weight(.semibold)).frame(width: 28, height: 28)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
            }

            if let running {
                RunningGameBlock(game: running)
                    .padding(14)
                    .background(Color.accentColor.opacity(0.08), in: .rect(cornerRadius: 20, style: .continuous))
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
                .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 18, style: .continuous))
            } else if running == nil {
                Text("Игр пока нет — начните первую.").font(.subheadline).foregroundStyle(.secondary)
            }

            if !isGameRunning || !games.isEmpty {
                GlassEffectContainer(spacing: 10) {
                    HStack(spacing: 10) {
                        if !isGameRunning {
                            Button(action: onNext) {
                                Label(games.isEmpty ? "Первая игра" : "Следующая игра", systemImage: "plus")
                                    .font(.headline)
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glassProminent)
                        }
                        if !games.isEmpty {
                            NavigationLink {
                                EveningDetailView(evening: evening)
                            } label: {
                                Label("Итоги", systemImage: "list.number")
                                    .font(.headline)
                                    .frame(maxWidth: isGameRunning ? .infinity : nil)
                            }
                            .buttonStyle(.glass)
                        }
                    }
                    .controlSize(.large)
                }
            }
        }
        .folderCard(padding: 16)
        .confirmationDialog("Завершить папку?", isPresented: $isConfirmingClose, titleVisibility: .visible) {
            Button("Завершить") { withAnimation(.smooth) { library.closeEvening(evening.id) } }
        } message: {
            Text("Папка уйдёт вниз, в завершённые, вместе с играми и итогами. Новая игра этого типа откроет новую папку.")
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

// MARK: - Завершённые папки

/// Завершённая папка: значок, тип и режим, дата, число игр и полоса побед.
private struct CompletedFolderRow: View {
    let evening: Evening
    @Environment(GameLibrary.self) private var library

    var body: some View {
        let games = library.games(of: evening)
        HStack(spacing: 12) {
            FolderIcon(evening: evening, size: 40)
            VStack(alignment: .leading, spacing: 5) {
                Text("\(evening.variant.shortName) · \(evening.format.displayName)").font(.headline).lineLimit(1)
                Text("\(evening.createdAt.formatted(.dateTime.day().month(.wide).year())) · \(gamesPlayed(games.count))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                MiniWinsBar(winners: games.map(\.record.outcome.winner))
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .folderCard(padding: 12)
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
