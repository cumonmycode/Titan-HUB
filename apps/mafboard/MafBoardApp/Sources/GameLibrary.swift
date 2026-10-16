import Foundation
import Observation
import MafBoardCore

// MARK: - Файлы на устройстве

/// Идущая игра: журнал движка + профили игроков (имена, аватары).
struct SavedGame: Codable {
    let session: GameSession
    let players: [PlayerProfile]
}

/// Законченная игра в истории ведущего.
struct FinishedGame: Codable, Identifiable {
    let record: GameRecord
    let players: [PlayerProfile]
    /// Ушла в историю на сервер (личную или клуба).
    var isUploaded: Bool

    var id: GameID { record.id }

    func profile(at seat: Seat) -> PlayerProfile? {
        guard let id = record.seat(seat)?.playerID else { return nil }
        return players.first { $0.id == id }
    }
}

enum GameFiles {
    static var directory: URL { URL.applicationSupportDirectory }
    static var active: URL { directory.appending(path: "current-game.json") }
    static var history: URL { directory.appending(path: "history.json") }
    static var series: URL { directory.appending(path: "series.json") }

    static func write(_ value: some Encodable, to url: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtection])
    }

    /// `nil` — файла нет. Нечитаемый файл откладывается рядом (а не удаляется молча) и даёт ошибку.
    static func read<T: Decodable>(_ type: T.Type, from url: URL) throws -> T? {
        guard FileManager.default.fileExists(atPath: url.path()) else { return nil }
        do {
            return try JSONDecoder().decode(type, from: Data(contentsOf: url))
        } catch {
            let stamp = Int(Date.now.timeIntervalSince1970)
            try? FileManager.default.moveItem(at: url, to: directory.appending(path: "unreadable-\(stamp)-\(url.lastPathComponent)"))
            throw error
        }
    }
}

enum SavedGameStore {
    static func load() throws -> SavedGame? { try GameFiles.read(SavedGame.self, from: GameFiles.active) }
    static func save(_ game: SavedGame) throws { try GameFiles.write(game, to: GameFiles.active) }
    static func clear() { try? FileManager.default.removeItem(at: GameFiles.active) }
}

// MARK: - Серии в истории

/// Серия на главном экране: игры одного режима за один вечер (у рейтинга — одна серия на вечер).
struct HistoryGroup: Identifiable {
    let id: String
    let format: CompetitionFormat
    let number: Int
    let day: Date
    /// По времени: первая игра — первой.
    let games: [FinishedGame]

    var title: String { "\(format.displayName) #\(number) \(day.formatted(.dateTime.day(.twoDigits).month(.twoDigits).year()))" }
    var isClosed: Bool { !Calendar.current.isDateInToday(day) }
}

/// Строка «Итогов» серии: сумма баллов игрока за все её игры.
struct SummaryRow: Identifiable {
    let player: PlayerProfile
    let games: Int
    let wins: Int
    let points: Points

    var id: PlayerID { player.id }
}

// MARK: - Библиотека игр

@Observable @MainActor
final class GameLibrary {
    private(set) var active: SavedGame?
    private(set) var history: [FinishedGame] = []
    /// Открытая на экране игра.
    var presented: GameController?
    /// Игра, созданная в листе «Новая» — откроется, когда лист закроется.
    private var pending: GameController?
    var errorMessage: String?
    /// Выгрузка законченной игры на сервер (задаёт приложение). `true` — принята.
    var uploader: ((GameRecord) async -> Bool)?
    private var seriesByKey: [String: SeriesID] = [:]

    init() {
        reload()
        seriesByKey = (try? GameFiles.read([String: SeriesID].self, from: GameFiles.series)) ?? [:]
    }

    func reload() {
        do {
            active = try SavedGameStore.load()
            history = try GameFiles.read([FinishedGame].self, from: GameFiles.history) ?? []
        } catch {
            errorMessage = "Часть сохранённых игр не удалось прочитать — файл отложен. \(error.localizedDescription)"
        }
    }

    // MARK: Игры

    func start(setup: GameSetup, players: [PlayerProfile]) {
        SavedGameStore.clear()
        active = nil
        pending = makeController(GameSession(setup: setup), players: players)
    }

    func presentPending() {
        presented = pending
        pending = nil
    }

    func resumeActive() {
        guard let active else { return }
        presented = makeController(active.session, players: active.players)
    }

    func discardActive() {
        SavedGameStore.clear()
        active = nil
    }

    private func makeController(_ session: GameSession, players: [PlayerProfile]) -> GameController {
        let controller = GameController(session: session, players: players)
        controller.onFinish = { [weak self] record, players in self?.archive(record, players: players) }
        controller.onReopen = { [weak self] id in self?.unarchive(id) }
        return controller
    }

    private func archive(_ record: GameRecord, players: [PlayerProfile]) {
        history.removeAll { $0.id == record.id }
        history.insert(FinishedGame(record: record, players: players, isUploaded: false), at: 0)
        SavedGameStore.clear()
        active = nil
        saveHistory()
        Task { await uploadPending() }
    }

    /// Ведущий отменил последний ход уже законченной игры — она снова идёт.
    private func unarchive(_ id: GameID) {
        history.removeAll { $0.id == id && !$0.isUploaded }
        saveHistory()
    }

    func uploadPending() async {
        guard let uploader else { return }
        for game in history where !game.isUploaded {
            guard await uploader(game.record) else { continue }
            if let index = history.firstIndex(where: { $0.id == game.id }) {
                history[index].isUploaded = true
            }
        }
        saveHistory()
    }

    private func saveHistory() {
        do {
            try GameFiles.write(history, to: GameFiles.history)
        } catch {
            errorMessage = "История игр не сохранилась: \(error.localizedDescription)"
        }
    }

    // MARK: Серии

    /// Серия вечера для режима с таблицей (рейтинг, миникап, турнир). У фанки серии нет.
    func seriesID(format: CompetitionFormat, variant: GameVariant, on day: Date = .now) -> SeriesID? {
        guard format.countsTowardStandings else { return nil }
        let key = "\(day.formatted(.iso8601.year().month().day()))|\(format.rawValue)|\(variant.rawValue)"
        if let id = seriesByKey[key] { return id }
        let id = SeriesID()
        seriesByKey[key] = id
        try? GameFiles.write(seriesByKey, to: GameFiles.series)
        return id
    }

    var groups: [HistoryGroup] {
        let calendar = Calendar.current
        let buckets = Dictionary(grouping: history) { game in
            game.record.seriesID?.description
                ?? "\(calendar.startOfDay(for: game.record.finishedAt).timeIntervalSince1970)|\(game.record.format.rawValue)|\(game.record.variant.rawValue)"
        }
        let unnumbered = buckets.map { key, games in
            (key: key, games: games.sorted { $0.record.finishedAt < $1.record.finishedAt })
        }
        .sorted { ($0.games.first?.record.finishedAt ?? .distantPast) < ($1.games.first?.record.finishedAt ?? .distantPast) }

        var counters: [CompetitionFormat: Int] = [:]
        let numbered = unnumbered.compactMap { bucket -> HistoryGroup? in
            guard let first = bucket.games.first else { return nil }
            let format = first.record.format
            counters[format, default: 0] += 1
            return HistoryGroup(
                id: bucket.key, format: format, number: counters[format] ?? 1,
                day: calendar.startOfDay(for: first.record.finishedAt), games: bucket.games
            )
        }
        return numbered.reversed()
    }

    static func summary(of group: HistoryGroup) -> [SummaryRow] {
        var rows: [PlayerID: (player: PlayerProfile, games: Int, wins: Int, points: Points)] = [:]
        for game in group.games {
            for score in GameScorer.score(game.record) {
                guard let player = game.players.first(where: { $0.id == score.playerID }) else { continue }
                let current = rows[score.playerID] ?? (player, 0, 0, .zero)
                rows[score.playerID] = (player, current.games + 1, current.wins + (score.result == .win ? 1 : 0), current.points + score.total)
            }
        }
        return rows.values
            .map { SummaryRow(player: $0.player, games: $0.games, wins: $0.wins, points: $0.points) }
            .sorted { ($0.points, $0.wins) > ($1.points, $1.wins) }
    }
}
