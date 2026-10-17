import Foundation
import Observation
import MafBoardClient
import MafBoardCore

// MARK: - Файлы на устройстве

/// Идущая игра: журнал движка + профили игроков (имена, аватары).
/// `revision` растёт с каждым изменением, `syncedRevision` — что уже на сервере.
struct SavedGame: Codable {
    let session: GameSession
    let players: [PlayerProfile]
    var revision: Int
    var syncedRevision: Int
    var updatedAt: Date

    var id: GameID { session.setup.gameID }
    var needsSync: Bool { revision > syncedRevision }

    init(session: GameSession, players: [PlayerProfile], revision: Int, syncedRevision: Int, updatedAt: Date) {
        self.session = session
        self.players = players
        self.revision = revision
        self.syncedRevision = syncedRevision
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case session, players, revision, syncedRevision, updatedAt
    }

    /// Файлы, сохранённые до синхронизации, без ревизий — считаем их неотправленными.
    init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        session = try container.decode(GameSession.self, forKey: .session)
        players = try container.decode([PlayerProfile].self, forKey: .players)
        revision = try container.decodeIfPresent(Int.self, forKey: .revision) ?? 1
        syncedRevision = try container.decodeIfPresent(Int.self, forKey: .syncedRevision) ?? 0
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
            ?? session.log.last?.date ?? session.setup.createdAt
    }
}

/// Законченная игра в истории ведущего.
struct FinishedGame: Codable, Identifiable {
    let record: GameRecord
    let players: [PlayerProfile]
    /// Ушла в историю на сервер (личную или клуба).
    var isUploaded: Bool
    /// Сервер отказался принять игру (не повторяем отправку).
    var isUploadRejected: Bool?
    /// Вечер для старых игр, сыгранных до появления вечеров (у новых он в `record.seriesID`).
    var legacyEveningID: SeriesID?

    var id: GameID { record.id }
    var eveningID: SeriesID? { record.seriesID ?? legacyEveningID }

    func profile(at seat: Seat) -> PlayerProfile? {
        guard let id = record.seat(seat)?.playerID else { return nil }
        return players.first { $0.id == id }
    }

    /// Игроки в порядке мест — для «Следующей игры» тем же составом.
    var seatedPlayers: [PlayerProfile] {
        record.seats.compactMap { seat in players.first { $0.id == seat.playerID } }
    }
}

/// Вечер: игры одного режима и варианта подряд. Итоги вечера — сумма баллов за его игры.
struct Evening: Codable, Identifiable, Equatable {
    let id: SeriesID
    let format: CompetitionFormat
    let variant: GameVariant
    let createdAt: Date
    var updatedAt: Date
    var closedAt: Date?
    /// Состав последней игры — чтобы следующую начать тем же составом.
    var lastPlayers: [PlayerProfile]

    /// Вечер без игр дольше 12 часов закрывается сам.
    static let idleLimit: TimeInterval = 12 * 3600

    var isOpen: Bool { closedAt == nil && Date.now.timeIntervalSince(updatedAt) < Self.idleLimit }

    var title: String {
        "\(format.displayName) · \(createdAt.formatted(.dateTime.day().month(.wide)))"
    }
}

/// Файлы игр. У каждого ведущего своя папка — игры разных ведущих на одном телефоне не смешиваются.
@MainActor
enum GameFiles {
    /// Папка вошедшего ведущего (`users/<id>`). `nil` — никто не вошёл, файлов нет.
    static var userFolder: String?

    private static let names = ["current-game.json", "history.json", "evenings.json"]

    static var directory: URL {
        let base = URL.applicationSupportDirectory
        return userFolder.map { base.appending(path: "users/\($0)") } ?? base.appending(path: "users/none")
    }
    static var active: URL { directory.appending(path: names[0]) }
    static var history: URL { directory.appending(path: names[1]) }
    static var evenings: URL { directory.appending(path: names[2]) }
    static var pendingDeletions: URL { directory.appending(path: "pending-deletions.json") }

    /// Игры, сохранённые до разделения по ведущим (в корне), переезжают к первому вошедшему.
    static func adoptLegacyFiles() {
        let base = URL.applicationSupportDirectory
        let manager = FileManager.default
        let legacy = names.map { base.appending(path: $0) }.filter { manager.fileExists(atPath: $0.path()) }
        guard userFolder != nil, !legacy.isEmpty, !manager.fileExists(atPath: directory.path()) else { return }
        try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
        for url in legacy {
            try? manager.moveItem(at: url, to: directory.appending(path: url.lastPathComponent))
        }
    }

    static func write(_ value: some Encodable, to url: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Доступно после первой разблокировки: приложение, запущенное iOS заранее, игру прочитает.
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// `nil` — файла нет. Повреждённый файл откладывается рядом (а не удаляется молча) и даёт ошибку;
    /// файл, который просто не прочитался (например, телефон ещё не разблокирован), остаётся на месте.
    static func read<T: Decodable>(_ type: T.Type, from url: URL) throws -> T? {
        guard FileManager.default.fileExists(atPath: url.path()) else { return nil }
        let data = try Data(contentsOf: url)
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            let stamp = Int(Date.now.timeIntervalSince1970)
            try? FileManager.default.moveItem(at: url, to: directory.appending(path: "unreadable-\(stamp)-\(url.lastPathComponent)"))
            throw error
        }
    }
}

@MainActor
enum SavedGameStore {
    static func load() throws -> SavedGame? { try GameFiles.read(SavedGame.self, from: GameFiles.active) }
    static func save(_ game: SavedGame) throws { try GameFiles.write(game, to: GameFiles.active) }
    static func clear() { try? FileManager.default.removeItem(at: GameFiles.active) }
}

/// Строка итогов вечера: сумма баллов игрока за все его игры.
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
    private(set) var evenings: [Evening] = []
    /// Открытая на экране игра.
    var presented: GameController?
    /// Игра, созданная в листе «Новая игра» — откроется, когда лист закроется.
    private var pending: GameController?
    var errorMessage: String?
    /// Выгрузка законченной игры на сервер (задаёт приложение).
    var uploader: (@MainActor (GameRecord) async -> SyncResult)?
    /// Идущая игра изменилась — пора отправить её на сервер.
    var onActiveChanged: (@MainActor () -> Void)?
    /// Удалённые на телефоне идущие игры, которые ещё надо удалить на сервере.
    private(set) var pendingDeletions: [GameID] = []
    /// Последняя ревизия каждой игры — чтобы после отмены конца игры ревизия не пошла заново.
    private var lastRevision: [GameID: Int] = [:]

    /// Вошёл другой ведущий (или вышел): показываем только его игры.
    func switchUser(_ userID: UserID?) {
        let folder = userID?.description
        guard folder != GameFiles.userFolder || (history.isEmpty && evenings.isEmpty && active == nil) else { return }
        GameFiles.userFolder = folder
        presented = nil
        pending = nil
        active = nil
        history = []
        evenings = []
        pendingDeletions = []
        lastRevision = [:]
        guard folder != nil else { return }
        GameFiles.adoptLegacyFiles()
        reload()
    }

    func reload() {
        guard GameFiles.userFolder != nil else { return }
        do {
            active = try SavedGameStore.load()
            history = try GameFiles.read([FinishedGame].self, from: GameFiles.history) ?? []
            evenings = try GameFiles.read([Evening].self, from: GameFiles.evenings) ?? []
            pendingDeletions = try GameFiles.read([GameID].self, from: GameFiles.pendingDeletions) ?? []
        } catch {
            errorMessage = "Часть сохранённых игр не удалось прочитать — файл отложен. \(error.localizedDescription)"
        }
        adoptOrphanGames()
    }

    // MARK: Игры

    func start(setup: GameSetup, players: [PlayerProfile]) {
        let session = GameSession(setup: setup)
        // Сразу на диск и на сервер: перезапуск приложения до первого хода игру не теряет.
        saveActive(session, players: players)
        pending = makeController(session, players: players)
    }

    /// Сохранить идущую игру на телефоне и отметить, что её надо отправить на сервер.
    func saveActive(_ session: GameSession, players: [PlayerProfile]) {
        let id = session.setup.gameID
        let previous = active?.id == id ? active : nil
        let revision = max(previous?.revision ?? 0, lastRevision[id] ?? 0) + 1
        lastRevision[id] = revision
        let game = SavedGame(session: session, players: players, revision: revision,
                             syncedRevision: previous?.syncedRevision ?? 0, updatedAt: .now)
        do {
            try SavedGameStore.save(game)
        } catch {
            errorMessage = "Игра не сохранилась на устройстве: \(error.localizedDescription)"
        }
        active = game
        onActiveChanged?()
    }

    /// Сервер принял снимок этой ревизии.
    func markSynced(_ id: GameID, revision: Int) {
        guard var game = active, game.id == id, revision > game.syncedRevision else { return }
        game.syncedRevision = revision
        try? SavedGameStore.save(game)
        active = game
    }

    /// Игра с сервера: продолжаем её, если на телефоне нет идущей игры или там она старее.
    func adoptRemote(_ remotes: [ActiveGameEnvelope]) {
        guard presented == nil, pending == nil else { return }
        let finished = Set(history.map(\.id))
        let candidates = remotes.filter { !finished.contains($0.id) && !pendingDeletions.contains($0.id) }
        guard let newest = candidates.max(by: { $0.updatedAt < $1.updatedAt }) else { return }
        if let active, !(active.id == newest.id && newest.revision > active.revision) { return }

        let game = SavedGame(session: newest.snapshot.session, players: newest.snapshot.players,
                             revision: newest.revision, syncedRevision: newest.revision, updatedAt: newest.updatedAt)
        try? SavedGameStore.save(game)
        active = game
        lastRevision[game.id] = newest.revision
        let setup = game.session.setup
        if let id = setup.seriesID, !evenings.contains(where: { $0.id == id }) {
            evenings.append(Evening(id: id, format: setup.format, variant: setup.variant, createdAt: setup.createdAt,
                                    updatedAt: .now, closedAt: nil, lastPlayers: []))
            saveEvenings()
        }
    }

    /// Удалённая на сервере идущая игра больше не ждёт отправки.
    func deletionSynced(_ id: GameID) {
        pendingDeletions.removeAll { $0 == id }
        try? GameFiles.write(pendingDeletions, to: GameFiles.pendingDeletions)
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
        if let id = active?.id, !pendingDeletions.contains(id) {
            pendingDeletions.append(id)
            try? GameFiles.write(pendingDeletions, to: GameFiles.pendingDeletions)
        }
        SavedGameStore.clear()
        active = nil
        onActiveChanged?()
    }

    private func makeController(_ session: GameSession, players: [PlayerProfile]) -> GameController {
        let controller = GameController(session: session, players: players)
        controller.onSave = { [weak self] session, players in self?.saveActive(session, players: players) }
        controller.onFinish = { [weak self] record, players in self?.archive(record, players: players) }
        controller.onReopen = { [weak self] id in self?.unarchive(id) }
        return controller
    }

    private func archive(_ record: GameRecord, players: [PlayerProfile]) {
        let game = FinishedGame(record: record, players: players, isUploaded: false)
        history.removeAll { $0.id == record.id }
        history.insert(game, at: 0)
        if let id = record.seriesID, let index = evenings.firstIndex(where: { $0.id == id }) {
            evenings[index].updatedAt = record.finishedAt
            evenings[index].lastPlayers = game.seatedPlayers
            saveEvenings()
        }
        SavedGameStore.clear()
        active = nil
        saveHistory()
        // Законченная игра уходит в историю на сервере, а её черновик там удаляется.
        onActiveChanged?()
    }

    /// Ведущий отменил последний ход уже законченной игры — она снова идёт.
    private func unarchive(_ id: GameID) {
        history.removeAll { $0.id == id && !$0.isUploaded }
        saveHistory()
    }

    /// Отправить законченные игры. `false` — не было связи, надо повторить позже.
    @discardableResult
    func uploadPending() async -> Bool {
        guard let uploader else { return true }
        var reachedServer = true
        for game in history where !game.isUploaded && game.isUploadRejected != true {
            let result = await uploader(game.record)
            guard let index = history.firstIndex(where: { $0.id == game.id }) else { continue }
            switch result {
            case .done: history[index].isUploaded = true
            case .rejected: history[index].isUploadRejected = true
            case .offline: reachedServer = false
            }
        }
        saveHistory()
        return reachedServer
    }

    // MARK: Вечера

    var openEvenings: [Evening] { evenings.filter(\.isOpen).sorted { $0.updatedAt > $1.updatedAt } }
    var closedEvenings: [Evening] {
        evenings.filter { !$0.isOpen && !games(of: $0).isEmpty }.sorted { $0.updatedAt > $1.updatedAt }
    }

    /// Открытый вечер того же режима и варианта — его можно продолжить.
    func openEvening(format: CompetitionFormat, variant: GameVariant) -> Evening? {
        openEvenings.first { $0.format == format && $0.variant == variant }
    }

    /// Новый вечер. `id` задаётся заранее, чтобы создать вечер только после проверки первой игры.
    @discardableResult
    func startEvening(id: SeriesID = SeriesID(), format: CompetitionFormat, variant: GameVariant) -> Evening {
        let evening = Evening(id: id, format: format, variant: variant, createdAt: .now, updatedAt: .now, closedAt: nil, lastPlayers: [])
        evenings.append(evening)
        saveEvenings()
        return evening
    }

    func closeEvening(_ id: SeriesID) {
        guard let index = evenings.firstIndex(where: { $0.id == id }) else { return }
        evenings[index].closedAt = .now
        saveEvenings()
    }

    /// Игры вечера по порядку.
    func games(of evening: Evening) -> [FinishedGame] {
        history.filter { $0.eveningID == evening.id }.sorted { $0.record.finishedAt < $1.record.finishedAt }
    }

    func summary(of evening: Evening) -> [SummaryRow] {
        var rows: [PlayerID: SummaryRow] = [:]
        for game in games(of: evening) {
            for score in GameScorer.score(game.record) {
                guard let player = game.players.first(where: { $0.id == score.playerID }) else { continue }
                let current = rows[score.playerID]
                rows[score.playerID] = SummaryRow(
                    player: player,
                    games: (current?.games ?? 0) + 1,
                    wins: (current?.wins ?? 0) + (score.result == .win ? 1 : 0),
                    points: (current?.points ?? .zero) + score.total
                )
            }
        }
        return rows.values.sorted { ($0.points, $0.wins) > ($1.points, $1.wins) }
    }

    /// Игры, сыгранные до появления вечеров: собираем их в закрытые вечера по дню, режиму и варианту.
    private func adoptOrphanGames() {
        var created: [String: SeriesID] = [:]
        var changed = false
        for index in history.indices {
            let record = history[index].record
            if let id = history[index].eveningID {
                guard !evenings.contains(where: { $0.id == id }) else { continue }
                evenings.append(Self.closedEvening(id: id, for: record))
                changed = true
                continue
            }
            let day = Calendar.current.startOfDay(for: record.finishedAt).timeIntervalSince1970
            let key = "\(day)|\(record.format.rawValue)|\(record.variant.rawValue)"
            let id = created[key] ?? SeriesID()
            if created[key] == nil {
                created[key] = id
                evenings.append(Self.closedEvening(id: id, for: record))
            }
            history[index].legacyEveningID = id
            changed = true
        }
        guard changed else { return }
        saveEvenings()
        saveHistory()
    }

    private static func closedEvening(id: SeriesID, for record: GameRecord) -> Evening {
        Evening(id: id, format: record.format, variant: record.variant, createdAt: record.startedAt,
                updatedAt: record.finishedAt, closedAt: record.finishedAt, lastPlayers: [])
    }

    // MARK: Сохранение

    private func saveHistory() {
        do {
            try GameFiles.write(history, to: GameFiles.history)
        } catch {
            errorMessage = "История игр не сохранилась: \(error.localizedDescription)"
        }
    }

    private func saveEvenings() {
        do {
            try GameFiles.write(evenings, to: GameFiles.evenings)
        } catch {
            errorMessage = "Вечера не сохранились: \(error.localizedDescription)"
        }
    }
}

extension Identifier where Entity == GameRecord {
    /// Номер игры для людей: первые 6 знаков её UUID. Сам UUID уникален навсегда —
    /// поэтому игры разных ведущих не смешиваются ни на телефоне, ни на сервере.
    var shortCode: String { "#" + rawValue.uuidString.prefix(6) }
}
