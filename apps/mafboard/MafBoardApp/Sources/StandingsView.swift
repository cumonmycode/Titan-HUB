import SwiftUI
import MafBoardCore

/// Вкладка «Рейтинг»: таблица режима за вечер, месяц, год или всё время. Фанки сюда не попадают.
struct StandingsView: View {
    @Environment(GameLibrary.self) private var library
    @State private var format: CompetitionFormat = .rating
    @State private var period: Period = .month
    @State private var eveningID: SeriesID?
    @State private var variant: GameVariant?

    enum Period: String, CaseIterable, Identifiable {
        case evening = "Серия"
        case month = "Месяц"
        case year = "Год"
        case all = "Всё время"

        var id: Self { self }
    }

    private static let formats: [CompetitionFormat] = [.rating, .miniCup, .tournament]

    private var evenings: [Evening] {
        library.evenings
            .filter { $0.format == format && !library.games(of: $0).isEmpty }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    private var scope: StandingsQuery.Scope? {
        let calendar = Calendar.current
        switch period {
        case .evening:
            return (eveningID ?? evenings.first?.id).map(StandingsQuery.Scope.series)
        case .month:
            return calendar.dateInterval(of: .month, for: .now).map(StandingsQuery.Scope.period)
        case .year:
            return calendar.dateInterval(of: .year, for: .now).map(StandingsQuery.Scope.period)
        case .all:
            return .allTime
        }
    }

    private var players: [PlayerID: PlayerProfile] {
        library.history.reduce(into: [:]) { result, game in
            for player in game.players { result[player.id] = player }
        }
    }

    var body: some View {
        let query = scope.map { StandingsQuery(format: format, scope: $0, variant: variant) }
        let records = library.history.map(\.record)
        let standings = query.map { StandingsCalculator.standings($0, from: records) } ?? []
        let included = query.map { query in
            library.history.filter { query.includes($0.record) }.sorted { $0.record.finishedAt < $1.record.finishedAt }
        } ?? []
        let gameCount = included.count
        let played = included.playedGames { _, game in game.record.finishedAt.formatted(.dateTime.day().month(.abbreviated)) }

        NavigationStack {
            List {
                Section {
                    Picker("Режим", selection: $format) {
                        ForEach(Self.formats, id: \.self) { Text($0.displayName).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    Picker("Период", selection: $period) {
                        ForEach(Period.allCases) { Text($0.rawValue).tag($0) }
                    }
                    if period == .evening {
                        Picker("Серия", selection: Binding(get: { eveningID ?? evenings.first?.id }, set: { eveningID = $0 })) {
                            ForEach(evenings) { Text($0.title).tag(Optional($0.id)) }
                        }
                    }
                    Picker("Игра", selection: $variant) {
                        Text("Все").tag(GameVariant?.none)
                        ForEach(GameVariant.allCases, id: \.self) { Text($0.displayName).tag(Optional($0)) }
                    }
                }
                if !standings.isEmpty {
                    Section {
                        ForEach(standings) { row in
                            StandingCard(standing: row, player: players[row.playerID], games: played[row.playerID] ?? [])
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: 5, leading: 16, bottom: 5, trailing: 16))
                        }
                    } header: {
                        Text("Таблица")
                    } footer: {
                        Text("\(gamesPlayed(gameCount)). При равных баллах выше тот, у кого больше допбаллов с учётом штрафов, затем побед, побед доном или шерифом и смертей в первую ночь.")
                    }
                }
            }
            .tabBarClearance()
            .readableColumn()
            .ambientBackground()
            .overlay {
                if standings.isEmpty {
                    ContentUnavailableView(
                        "Пока пусто",
                        systemImage: "trophy",
                        description: Text("Здесь появится таблица, когда будут сыграны игры в режиме «\(format.displayName)». Фанки в рейтинг не идут.")
                    )
                }
            }
            .navigationTitle("Рейтинг")
            .profileButton()
            .onChange(of: format) { eveningID = nil }
        }
    }
}
