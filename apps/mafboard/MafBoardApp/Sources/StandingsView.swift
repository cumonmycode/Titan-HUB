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
        case evening = "Вечер"
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
        let gameCount = query.map { query in records.filter(query.includes).count } ?? 0

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
                        Picker("Вечер", selection: Binding(get: { eveningID ?? evenings.first?.id }, set: { eveningID = $0 })) {
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
                            StandingRow(standing: row, player: players[row.playerID])
                        }
                    } header: {
                        Text("Таблица")
                    } footer: {
                        Text("\(gamesPlayed(gameCount)). При равных баллах выше тот, у кого больше допбаллов с учётом штрафов, затем побед, побед доном или шерифом и смертей в первую ночь.")
                    }
                }
            }
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

private struct StandingRow: View {
    let standing: PlayerStanding
    let player: PlayerProfile?

    var body: some View {
        let name = player?.nickname ?? "Игрок"
        HStack(spacing: 12) {
            Text("\(standing.place)")
                .font(.headline)
                .monospacedDigit()
                .foregroundStyle(standing.place <= 3 ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .frame(width: 26)
            PlayerAvatar(name: name, url: player?.avatarURL, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).lineLimit(1)
                Text("Игр \(standing.gamesPlayed) · побед \(standing.wins) · ср. \(standing.averagePoints.formatted(.number.precision(.fractionLength(2))))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            Spacer()
            Text(standing.points.description).font(.headline).monospacedDigit()
        }
    }
}
