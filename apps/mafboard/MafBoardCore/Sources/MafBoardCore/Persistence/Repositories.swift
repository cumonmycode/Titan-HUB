import Foundation

// Контракты хранилищ. Ядро не знает, где лежат данные: в приложении это будет
// SwiftData/SQLite (и синхронизация с сервером клуба), в тестах — память.

public protocol PlayerRepository: Sendable {
    func allPlayers() async throws -> [PlayerProfile]
    func save(_ player: PlayerProfile) async throws
}

public protocol SeriesRepository: Sendable {
    func allSeries() async throws -> [Series]
    func save(_ series: Series) async throws
}

public protocol GameRecordRepository: Sendable {
    func save(_ record: GameRecord) async throws
    func records(matching query: StandingsQuery) async throws -> [GameRecord]
    /// Вся история игрока, включая фанку.
    func records(of player: PlayerID) async throws -> [GameRecord]
}

/// Незавершённая игра: переживает перезапуск приложения.
public protocol ActiveGameRepository: Sendable {
    func load() async throws -> GameSession?
    func save(_ session: GameSession) async throws
    func clear() async throws
}

/// Хранилище в памяти — для тестов, превью и прототипа.
public actor InMemoryStore: PlayerRepository, SeriesRepository, GameRecordRepository, ActiveGameRepository {
    private var players: [PlayerID: PlayerProfile] = [:]
    private var series: [SeriesID: Series] = [:]
    private var games: [GameID: GameRecord] = [:]
    private var activeGame: GameSession?

    public init() {}

    public func allPlayers() -> [PlayerProfile] {
        players.values.sorted { $0.nickname.localizedStandardCompare($1.nickname) == .orderedAscending }
    }

    public func save(_ player: PlayerProfile) {
        players[player.id] = player
    }

    public func allSeries() -> [Series] {
        series.values.sorted { $0.createdAt > $1.createdAt }
    }

    public func save(_ series: Series) {
        self.series[series.id] = series
    }

    public func save(_ record: GameRecord) {
        games[record.id] = record
    }

    public func records(matching query: StandingsQuery) -> [GameRecord] {
        games.values.filter(query.includes).sorted { $0.finishedAt < $1.finishedAt }
    }

    public func records(of player: PlayerID) -> [GameRecord] {
        games.values.filter { $0.seat(of: player) != nil }.sorted { $0.finishedAt < $1.finishedAt }
    }

    public func load() -> GameSession? {
        activeGame
    }

    public func save(_ session: GameSession) {
        activeGame = session
    }

    public func clear() {
        activeGame = nil
    }
}
