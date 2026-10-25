import SwiftUI
import MafBoardCore

/// Вкладка «Игры»: серии по типу игры, режиму и дате. Сверху активные (в них идёт игра или серия продолжается),
/// ниже завершённые — от новых к старым. Идущая игра живёт внутри своей серии.
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
        // Игра без своей серии (сыграна до серий или серия не найдена) — отдельной строкой.
        let orphan = running.flatMap { game in active.contains { $0.id == runningFolder } ? nil : game }

        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !active.isEmpty || orphan != nil {
                        FolderSectionTitle("Активные серии")
                    }
                    // На iPad активные серии — в две колонки, на телефоне — одна под другой.
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                        if let orphan {
                            RunningGameRow(game: orphan).folderCard(padding: 12)
                        }
                        ForEach(active) { evening in
                            FolderCard(
                                evening: evening,
                                running: running?.session.setup.seriesID == evening.id ? running : nil,
                                isGameRunning: running != nil
                            ) { onNewGame(evening) }
                        }
                    }
                    if active.isEmpty, orphan == nil {
                        StartCard { onNewGame(nil) }
                    }
                    if !completed.isEmpty {
                        FolderSectionTitle("Завершённые серии").padding(.top, 12)
                        VStack(spacing: 0) {
                            ForEach(Array(completed.enumerated()), id: \.element.id) { index, evening in
                                NavigationLink {
                                    EveningDetailView(evening: evening)
                                } label: {
                                    CompletedFolderRow(evening: evening)
                                }
                                .buttonStyle(.plain)
                                if index < completed.count - 1 { Divider().padding(.leading, 56) }
                            }
                        }
                        .padding(.vertical, 4)
                        .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .tabBarClearance()
            .readableColumn()
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
        Text(text).font(.title3.bold()).padding(.horizontal, 4)
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
    func folderCard(padding: CGFloat = 12) -> some View {
        self.padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
    }
}

/// Значок папки: цвет режима, внутри — значок типа игры.
private struct FolderIcon: View {
    let evening: Evening
    var size: CGFloat = 34

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

/// Идущая игра одной строкой: пульс, шаг и время, «Продолжить».
private struct RunningGameRow: View {
    let game: SavedGame
    @Environment(GameLibrary.self) private var library
    @State private var isConfirmingDelete = false

    var body: some View {
        let state = game.session.state
        let setup = game.session.setup
        HStack(spacing: 10) {
            Circle()
                .fill(.tint)
                .frame(width: 8, height: 8)
                .symbolEffect(.pulse, options: .repeating)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(state.currentStep.title(in: state)).font(.subheadline.weight(.semibold)).lineLimit(1)
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    Text("\(state.moment.displayName) · \(state.aliveSeats.count) в игре · \(durationText(from: setup.createdAt, to: context.date))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Button {
                library.resumeActive()
            } label: {
                Label("Продолжить", systemImage: "play.fill").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.solidProminent)
        }
        .contextMenu {
            Button("Удалить игру", systemImage: "trash", role: .destructive) { isConfirmingDelete = true }
        }
        .confirmationDialog("Удалить игру?", isPresented: $isConfirmingDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { library.discardActive() }
        } message: {
            Text("Игра не попадёт в историю.")
        }
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
                Text("Начните первую серию").font(.title2.bold())
                Text("Выберите игру и режим — игры одного типа и дня соберутся в одну серию.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: action) {
                Label("Новая игра", systemImage: "plus").frame(maxWidth: .infinity)
            }
            .buttonStyle(.solidProminent)
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity)
        .folderCard(padding: 20)
    }
}

// MARK: - Активная серия

/// Активная серия компактно: шапка (нажатие — открыть серию), идущая игра одной строкой
/// или последняя сыгранная игра с итогом, под ней «Ещё одна игра».
private struct FolderCard: View {
    let evening: Evening
    /// Идущая игра этой серии.
    let running: SavedGame?
    let isGameRunning: Bool
    let onNext: () -> Void
    @Environment(GameLibrary.self) private var library
    @State private var isConfirmingClose = false
    @State private var isConfirmingSwitch = false

    var body: some View {
        let games = library.games(of: evening)
        VStack(alignment: .leading, spacing: 10) {
            NavigationLink {
                EveningDetailView(evening: evening)
            } label: {
                FolderHeader(evening: evening, games: games)
            }
            .buttonStyle(.plain)

            if let running {
                RunningGameRow(game: running)
                    .padding(10)
                    .background(Color.accentColor.opacity(0.08), in: .rect(cornerRadius: 16, style: .continuous))
            } else if let last = games.last {
                // Сыгранная игра серии — с итогом; под ней «Ещё одна игра».
                NavigationLink {
                    FinishedGameView(game: last, number: games.count)
                } label: {
                    GameLine(game: last, number: games.count)
                }
                .buttonStyle(.plain)
                .background(Color.primary.opacity(0.05), in: .rect(cornerRadius: 16, style: .continuous))
            }
            if running == nil {
                HStack(spacing: 8) {
                    Button {
                        // Ведётся одна игра за раз: если идёт игра другой серии — спросим, что с ней делать.
                        if isGameRunning { isConfirmingSwitch = true } else { onNext() }
                    } label: {
                        Label(games.isEmpty ? "Первая игра" : "Ещё одна игра", systemImage: "plus")
                            .font(.subheadline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.solidProminent)
                    Menu {
                        Button("Завершить серию", systemImage: "checkmark.circle") { isConfirmingClose = true }
                    } label: {
                        Image(systemName: "ellipsis").font(.subheadline.weight(.semibold)).frame(width: 22, height: 22)
                    }
                    .buttonStyle(.solid(.circle))
                    .accessibilityLabel("Ещё")
                }
            }
        }
        .folderCard(padding: 12)
        .confirmationDialog("Идёт другая игра", isPresented: $isConfirmingSwitch, titleVisibility: .visible) {
            Button("Продолжить идущую игру") { library.resumeActive() }
            Button("Удалить её и начать новую", role: .destructive) {
                library.discardActive()
                onNext()
            }
        } message: {
            Text("Одновременно ведётся одна игра. Идущая игра другой серии не попадёт в историю, если её удалить.")
        }
        .confirmationDialog("Завершить серию?", isPresented: $isConfirmingClose, titleVisibility: .visible) {
            Button("Завершить") { withAnimation(.smooth) { library.closeEvening(evening.id) } }
        } message: {
            Text("Серия уйдёт вниз, в завершённые, вместе с играми и итогами. Новая игра этого типа начнёт новую серию.")
        }
    }
}

/// Шапка серии: значок, тип и режим, дата и число игр, полоса побед.
private struct FolderHeader: View {
    let evening: Evening
    let games: [FinishedGame]
    var showsYear = false

    var body: some View {
        HStack(spacing: 10) {
            FolderIcon(evening: evening)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(evening.variant.shortName) · \(evening.format.displayName)")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text("\(evening.createdAt.formatted(showsYear ? .dateTime.day().month(.abbreviated).year() : .dateTime.day().month(.abbreviated))) · \(gamesPlayed(games.count))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    MiniWinsBar(winners: games.map(\.record.outcome.winner))
                }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .contentShape(.rect)
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

// MARK: - Завершённые серии

/// Завершённая серия — строка общего списка.
private struct CompletedFolderRow: View {
    let evening: Evening
    @Environment(GameLibrary.self) private var library

    var body: some View {
        FolderHeader(evening: evening, games: library.games(of: evening), showsYear: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
    }
}

private struct MiniWinsBar: View {
    let winners: [Winner]

    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(winners.enumerated()), id: \.offset) { _, winner in
                Capsule().fill(winner.dot).frame(width: 10, height: 4)
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
                         ? "Сумма баллов за серию. Нажмите на игрока — подробности по баллам, ролям и играм."
                         : "Фанка в рейтинги не идёт — это сумма баллов за серию. Нажмите на игрока — подробности.")
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
        .readableColumn()
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
                        .readableColumn()
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
        .readableColumn()
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
