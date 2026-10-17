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
    /// Папка вошедшего ведущего (`users/<id>`). `nil` — никто не вошёл.
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

    enum ReadFailure: Error {
        /// Файл есть, но сейчас не читается (например, телефон ещё не разблокирован) — оставлен на месте.
        case unavailable
        /// Файл повреждён — отложен рядом, чтобы ничего не потерять.
        case corrupted
    }

    /// `nil` — файла нет.
    static func read<T: Decodable>(_ type: T.Type, from url: URL) throws(ReadFailure) -> T? {
        guard FileManager.default.fileExists(atPath: url.path()) else { return nil }
        guard let data = try? Data(contentsOf: url) else { throw .unavailable }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            let stamp = Int(Date.now.timeIntervalSince1970)
            try? FileManager.default.moveItem(at: url, to: directory.appending(path: "unreadable-\(stamp)-\(url.lastPathComponent)"))
            throw .corrupted
        }
    }
}

@MainActor
enum SavedGameStore {
    static func save(_ game: SavedGame) throws { try GameFiles.write(game, to: GameFiles.active) }
    static func clear() { try? FileManager.default.removeItem(at: GameFiles.active) }
}

/// Строка итогов вечера: сумма баллов игрока за все его игры.
// MARK: - Библиотека игр

/// Игры ведущего. Во время работы источник правды — память: файлы читаются один раз при входе
/// ведущего и дальше только записываются (и только после того, как прочитаны), сервер — резервная копия.
@Observable @MainActor
final class GameLibrary {
    private(set) var active: SavedGame?
    private(set) var history: [FinishedGame] = []
    private(set) var evenings: [Evening] = []
    /// Удалённые на телефоне идущие игры, которые ещё надо удалить на сервере.
    private(set) var pendingDeletions: [GameID] = []
    /// Файлы ведущего прочитаны. До этого ничего не записываем — чтобы не затереть историю пустой.
    private(set) var isLoaded = false
    /// Открытая на экране игра.
    var presented: GameController?
    /// Игра, созданная в листе «Новая игра» — откроется, когда лист закроется.
    private var pending: GameController?
    var errorMessage: String?
    /// Выгрузка законченной игры на сервер (задаёт приложение).
    var uploader: (@MainActor (HostedGame) async -> SyncResult)?
    /// Идущая игра изменилась — пора отправить её на сервер.
    var onActiveChanged: (@MainActor () -> Void)?

    private var user: UserID?
    /// Последняя ревизия каждой игры — чтобы после отмены конца игры ревизия не пошла заново.
    private var lastRevision: [GameID: Int] = [:]

    // MARK: Вход ведущего

    /// Вошёл другой ведущий (или вышел): показываем только его игры.
    func switchUser(_ userID: UserID?) {
        guard userID != user || !isLoaded else { return }
        user = userID
        isLoaded = false
        presented = nil
        pending = nil
        active = nil
        history = []
        evenings = []
        pendingDeletions = []
        lastRevision = [:]
        GameFiles.userFolder = userID?.description
        guard userID != nil else { return }
        GameFiles.adoptLegacyFiles()
        load()
    }

    /// Дочитать файлы, если в прошлый раз телефон их не отдал.
    func ensureLoaded() {
        guard user != nil, !isLoaded else { return }
        load()
    }

    /// Каждый файл читается отдельно: сбой одного не мешает остальным.
    private func load() {
        var unavailable = false
        var corrupted = false
        func read<T: Decodable>(_ type: T.Type, _ url: URL) -> T? {
            do throws(GameFiles.ReadFailure) {
                return try GameFiles.read(type, from: url)
            } catch {
                switch error {
                case .unavailable: unavailable = true
                case .corrupted: corrupted = true
                }
                return nil
            }
        }
        active = read(SavedGame.self, GameFiles.active)
        history = read([FinishedGame].self, GameFiles.history) ?? []
        evenings = read([Evening].self, GameFiles.evenings) ?? []
        pendingDeletions = read([GameID].self, GameFiles.pendingDeletions) ?? []
        if let active { lastRevision[active.id] = active.revision }

        if unavailable {
            errorMessage = "Игры на телефоне пока недоступны — разблокируйте телефон, приложение прочитает их снова."
            return
        }
        isLoaded = true
        if corrupted {
            errorMessage = "Часть сохранённых данных повреждена — файл отложен, игры подтянутся с сервера."
        }
        adoptOrphanGames()
    }

    // MARK: Идущая игра

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
        active = game
        do {
            try SavedGameStore.save(game)
        } catch {
            errorMessage = "Игра не сохранилась на телефоне: \(error.localizedDescription)"
        }
        onActiveChanged?()
    }

    /// Сервер принял снимок этой ревизии.
    func markSynced(_ id: GameID, revision: Int) {
        guard var game = active, game.id == id, revision > game.syncedRevision else { return }
        game.syncedRevision = revision
        active = game
        try? SavedGameStore.save(game)
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
        guard let id = active?.id else { return }
        if !pendingDeletions.contains(id) {
            pendingDeletions.append(id)
            savePendingDeletions()
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

    // MARK: Законченные игры

    /// Правка итогов сыгранной игры: каждое изменение пересохраняет её в истории и отправляет на сервер.
    func editor(for game: FinishedGame) -> GameController? {
        let session: GameSession
        do throws(GameError) {
            session = try GameSession(record: game.record)
        } catch {
            errorMessage = "Игру не открыть для правки: \(error.message)"
            return nil
        }
        let controller = GameController(session: session, players: game.players)
        controller.onFinish = { [weak self] record, players in self?.archive(record, players: players) }
        return controller
    }

    /// Игра закончилась: в историю (сразу видна в своём вечере) и на сервер.
    /// Правка уже сохранённой игры оставляет её на прежнем месте и не трогает вечер.
    private func archive(_ record: GameRecord, players: [PlayerProfile]) {
        let game = FinishedGame(record: record, players: players, isUploaded: false)
        if let index = history.firstIndex(where: { $0.id == record.id }) {
            history[index] = game
            saveHistory()
            onActiveChanged?()
            return
        }
        history.insert(game, at: 0)
        if let id = record.seriesID {
            ensureEvening(id, for: record)
            if let index = evenings.firstIndex(where: { $0.id == id }) {
                evenings[index].updatedAt = record.finishedAt
                evenings[index].lastPlayers = game.seatedPlayers
            }
        }
        if active?.id == record.id {
            SavedGameStore.clear()
            active = nil
        }
        saveHistory()
        saveEvenings()
        onActiveChanged?()
    }

    /// Ведущий отменил конец игры — она снова идёт; когда закончится, запись на сервере обновится.
    private func unarchive(_ id: GameID) {
        history.removeAll { $0.id == id }
        saveHistory()
    }

    /// Отправить законченные игры. `false` — не было связи, надо повторить позже.
    @discardableResult
    func uploadPending() async -> Bool {
        guard let uploader, isLoaded else { return true }
        var reachedServer = true
        var changed = false
        for game in history where !game.isUploaded && game.isUploadRejected != true {
            let result = await uploader(HostedGame(record: game.record, players: game.players))
            guard let index = history.firstIndex(where: { $0.id == game.id }) else { continue }
            switch result {
            case .done:
                history[index].isUploaded = true
                changed = true
            case .rejected:
                history[index].isUploadRejected = true
                changed = true
            case .offline:
                reachedServer = false
            }
        }
        if changed { saveHistory() }
        return reachedServer
    }

    /// Самая поздняя игра, уже лежащая на сервере: с неё и подтягиваем недостающие.
    var lastUploadedFinish: Date? {
        history.filter(\.isUploaded).map(\.record.finishedAt).max()
    }

    /// Законченные игры с сервера, которых нет на телефоне (переустановка, другое устройство).
    func mergeRemoteHistory(_ games: [HostedGame]) {
        guard isLoaded else { return }
        let known = Set(history.map(\.id))
        let fresh = games.filter { !known.contains($0.record.id) && $0.record.id != active?.id }
        guard !fresh.isEmpty else { return }
        for game in fresh {
            history.append(FinishedGame(record: game.record, players: game.players, isUploaded: true))
            if let id = game.record.seriesID { ensureEvening(id, for: game.record) }
        }
        history.sort { $0.record.finishedAt > $1.record.finishedAt }
        adoptOrphanGames()
        saveHistory()
        saveEvenings()
    }

    /// Идущая игра с сервера — если на телефоне её нет (или там она старее). Брошенные давно не воскрешаем.
    func adoptRemote(_ remotes: [ActiveGameEnvelope]) {
        guard isLoaded, presented == nil, pending == nil else { return }
        let finished = Set(history.map(\.id))
        let candidates = remotes.filter {
            !finished.contains($0.id) && !pendingDeletions.contains($0.id)
                && ($0.id == active?.id || Date.now.timeIntervalSince($0.updatedAt) < Evening.idleLimit)
        }
        guard let newest = candidates.max(by: { $0.updatedAt < $1.updatedAt }) else { return }
        if let active, !(active.id == newest.id && newest.revision > active.revision) { return }

        let game = SavedGame(session: newest.snapshot.session, players: newest.snapshot.players,
                             revision: newest.revision, syncedRevision: newest.revision, updatedAt: newest.updatedAt)
        active = game
        lastRevision[game.id] = newest.revision
        try? SavedGameStore.save(game)
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
        savePendingDeletions()
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

    /// Вечер игры есть всегда: если на телефоне его нет (игра с сервера), создаём по самой игре.
    private func ensureEvening(_ id: SeriesID, for record: GameRecord) {
        guard !evenings.contains(where: { $0.id == id }) else { return }
        evenings.append(Evening(id: id, format: record.format, variant: record.variant, createdAt: record.startedAt,
                                updatedAt: record.finishedAt, closedAt: nil, lastPlayers: []))
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

    // MARK: Сохранение (только после чтения — иначе можно затереть историю пустой)

    private func saveHistory() {
        guard isLoaded else { return }
        do {
            try GameFiles.write(history, to: GameFiles.history)
        } catch {
            errorMessage = "История игр не сохранилась: \(error.localizedDescription)"
        }
    }

    private func saveEvenings() {
        guard isLoaded else { return }
        do {
            try GameFiles.write(evenings, to: GameFiles.evenings)
        } catch {
            errorMessage = "Вечера не сохранились: \(error.localizedDescription)"
        }
    }

    private func savePendingDeletions() {
        guard isLoaded else { return }
        try? GameFiles.write(pendingDeletions, to: GameFiles.pendingDeletions)
    }
}

extension Identifier where Entity == GameRecord {
    /// Номер игры для людей: первые 6 знаков её UUID. Сам UUID уникален навсегда —
    /// поэтому игры разных ведущих не смешиваются ни на телефоне, ни на сервере.
    var shortCode: String { "#" + rawValue.uuidString.prefix(6) }
}
