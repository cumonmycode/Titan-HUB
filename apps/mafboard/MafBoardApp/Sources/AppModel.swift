import Foundation
import Observation
import UIKit
import MafBoardClient
import MafBoardCore

/// Состояние приложения: сессия, вход через Telegram-бота, аккаунт и GoMafia.
@Observable @MainActor
final class AppModel {
    enum Phase: Equatable {
        case loading
        case signedOut
        case signedIn
        /// «Попробовать без входа»: фанки с гостями, игры только на этом телефоне, сервера нет.
        case demo
    }

    static let apiBase = URL(string: "https://mafboard.titanpos.ru/api/mafboard")!
    static let returnHosts: Set<String> = ["mafboard.titanpos.ru"]
    /// Папка игр демо-режима — отдельно от игр вошедших ведущих.
    static let demoUserID = UserID(UUID(uuidString: "00000000-DE30-4000-8000-000000000000")!)
    private static let demoKey = "demoMode"

    /// Чьи игры показывать: вошедшего ведущего или демо-режима.
    var libraryUser: UserID? {
        phase == .demo ? Self.demoUserID : account?.id
    }

    private(set) var phase: Phase = .loading
    private(set) var account: UserAccount?
    private(set) var login = TelegramLoginFlow()
    /// Ссылку на бота открывает экран (у модели нет доступа к openURL).
    var telegramURLToOpen: URL?
    var errorMessage: String?

    private let store = SessionStore()
    private let api: MafBoardAPIClient
    /// Одно обновление токенов на всех: refresh-токен одноразовый, повтор отзывает все сессии.
    private var refreshTask: Task<RefreshOutcome, Never>?
    /// Ссылка возврата пришла раньше, чем приложение прочитало сохранённый вход.
    private var earlyReturnTicketID: String?

    init() {
        api = MafBoardAPIClient(baseURL: Self.apiBase, tokens: store)
    }

    func bootstrap() async {
        // Только при запуске: экран под полноэкранной игрой «появляется» заново, но входить второй раз не нужно.
        guard phase == .loading else { return }
        if Self.isDemoForced {
            phase = .demo
            return
        }
        if let session = await store.load() {
            account = session.account
            phase = .signedIn
            await refreshAccount()
            return
        }
        if UserDefaults.standard.bool(forKey: Self.demoKey) {
            phase = .demo
            return
        }
        if let pending = await store.loadPendingLogin(), pending.ticket.expiresAt > .now {
            dispatch(.resume(pending.ticket, pending.secret))
        }
        phase = .signedOut
        if let ticketID = earlyReturnTicketID {
            earlyReturnTicketID = nil
            returned(with: ticketID)
        }
        await pollLogin()
    }

    // MARK: - Демо-режим

    /// Только в отладочной сборке: аргумент запуска `-demoMode` открывает демо-режим, не трогая
    /// сохранённый вход, — для скриншотов App Store на телефоне, где ведущий уже вошёл.
    private static var isDemoForced: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("-demoMode")
        #else
        false
        #endif
    }

    func startDemo() {
        dispatch(.reset)
        Task { await persistPendingLogin() }
        UserDefaults.standard.set(true, forKey: Self.demoKey)
        phase = .demo
    }

    /// Из демо-режима — на экран входа. Игры демо-режима остаются на телефоне до следующего раза.
    func leaveDemo() {
        UserDefaults.standard.removeObject(forKey: Self.demoKey)
        phase = .signedOut
    }

    // MARK: - Вход проверяющего App Store

    /// Логин и пароль из заметок для App Review: у проверяющего нет нашего Telegram-бота.
    /// `nil` — вошли, иначе текст ошибки для формы входа.
    func reviewLogin(login: String, password: String) async -> String? {
        do throws(APIError) {
            let session = try await api.reviewLogin(login: login, password: password, deviceName: UIDevice.current.name, platform: "ios")
            do { try await store.save(session) } catch { report(error) }
            UserDefaults.standard.removeObject(forKey: Self.demoKey)
            dispatch(.reset)
            await persistPendingLogin()
            account = session.account
            phase = .signedIn
            return nil
        } catch {
            return error.message
        }
    }

    // MARK: - Вход через Telegram

    func startLogin() {
        dispatch(.start(DeviceSecret.generate()))
    }

    func cancelLogin() {
        dispatch(.reset)
        Task { await persistPendingLogin() }
    }

    /// Ссылка возврата из бота (Universal Link или mafboard://).
    func handle(url: URL) {
        guard let ticketID = LoginReturnLink.ticketID(from: url, allowedHosts: Self.returnHosts) else { return }
        switch phase {
        case .loading: earlyReturnTicketID = ticketID
        case .signedOut: returned(with: ticketID)
        case .signedIn, .demo: break
        }
    }

    private func returned(with ticketID: String) {
        guard login.pendingTicket?.0.id == ticketID else {
            errorMessage = "Вход прервался. Нажмите «Войти через Telegram» ещё раз."
            return
        }
        dispatch(.returnedFromTelegram(ticketID: ticketID))
    }

    /// Опрос статуса билета: при возврате в приложение и периодически, пока ждём бота.
    func pollLogin() async {
        dispatch(.clockTick(.now))
        guard let ticketID = login.pollingTicketID else {
            await persistPendingLogin()
            return
        }
        guard let status = try? await api.telegramLoginStatus(ticketID: ticketID) else { return }
        guard login.pollingTicketID == ticketID else { return }
        dispatch(.statusReceived(status))
        await persistPendingLogin()
    }

    private func dispatch(_ event: TelegramLoginEvent) {
        for command in login.handle(event) {
            Task { await run(command) }
        }
    }

    private func run(_ command: TelegramLoginCommand) async {
        switch command {
        case let .requestTicket(secret):
            do throws(APIError) {
                let ticket = try await api.startTelegramLogin(deviceName: UIDevice.current.name, platform: "ios", secret: secret)
                dispatch(.ticketIssued(ticket))
            } catch {
                dispatch(.requestFailed(error.message))
            }
        case let .openTelegram(url):
            telegramURLToOpen = url
        case let .completeLogin(ticketID, secret):
            do throws(APIError) {
                let session = try await api.completeTelegramLogin(ticketID: ticketID, secret: secret)
                do { try await store.save(session) } catch { report(error) }
                account = session.account
                dispatch(.sessionReceived(session))
                phase = .signedIn
            } catch {
                switch error {
                case .transport, .server, .rateLimited: dispatch(.completionInterrupted)
                default: dispatch(.requestFailed(error.message))
                }
            }
        }
        await persistPendingLogin()
    }

    private func persistPendingLogin() async {
        await store.savePendingLogin(login.pendingTicket.map { PendingLogin(ticket: $0.0, secret: $0.1) })
    }

    // MARK: - Аккаунт и GoMafia

    func refreshAccount() async {
        do throws(APIError) {
            let fresh = try await withAuth { () async throws(APIError) in try await api.currentAccount() }
            await apply(fresh)
        } catch {
            report(error)
        }
    }

    func linkGoMafia(login: String, password: String) async -> Bool {
        do throws(APIError) {
            let fresh = try await withAuth { () async throws(APIError) in
                try await api.linkGoMafia(login: login, password: password)
            }
            await apply(fresh)
            return true
        } catch {
            report(error)
            return false
        }
    }

    func unlinkGoMafia() async {
        do throws(APIError) {
            let fresh = try await withAuth { () async throws(APIError) in try await api.unlinkGoMafia() }
            await apply(fresh)
        } catch {
            report(error)
        }
    }

    /// `nil` — поиск не удался или отменён (пользователь продолжил печатать).
    func searchPlayers(_ query: String) async -> [GoMafiaPlayer]? {
        do throws(APIError) {
            return try await withAuth { () async throws(APIError) in try await api.searchGoMafiaPlayers(query) }
        } catch {
            report(error)
            return nil
        }
    }

    /// Состав клуба GoMafia целиком (постранично). `nil` — не удалось загрузить.
    func clubRoster(clubID: Int) async -> [GoMafiaPlayer]? {
        var players: [GoMafiaPlayer] = []
        var seen = Set<Int>()
        do throws(APIError) {
            for page in 1...Self.maxRosterPages {
                let batch = try await withAuth { () async throws(APIError) in try await api.clubRoster(clubID: clubID, page: page) }
                let fresh = batch.filter { seen.insert($0.id).inserted }
                if fresh.isEmpty { break }
                players += fresh
            }
            return players
        } catch {
            report(error)
            return players.isEmpty ? nil : players
        }
    }

    private static let maxRosterPages = 12

    /// Законченная игра — в историю на сервере (личную или клуба). `true` — сервер её принял (или уже имел).
    func uploadGame(_ game: HostedGame) async -> SyncResult {
        guard phase == .signedIn else { return .offline }
        guard game.record.host != nil else { return .rejected }
        do throws(APIError) {
            try await withAuth { () async throws(APIError) in try await api.uploadGame(game) }
            return .done
        } catch {
            return SyncResult(error)
        }
    }

    // MARK: - Идущие игры на сервере

    func saveActiveGame(_ game: ActiveGameEnvelope) async -> SyncResult {
        guard phase == .signedIn else { return .offline }
        do throws(APIError) {
            _ = try await withAuth { () async throws(APIError) in try await api.saveActiveGame(game) }
            return .done
        } catch {
            return SyncResult(error)
        }
    }

    func deleteActiveGame(_ id: GameID) async -> SyncResult {
        guard phase == .signedIn else { return .offline }
        do throws(APIError) {
            try await withAuth { () async throws(APIError) in try await api.deleteActiveGame(id: id) }
            return .done
        } catch {
            return SyncResult(error)
        }
    }

    /// Законченные игры ведущего на сервере после `since` (все страницы). `nil` — сервер недоступен.
    func myGames(since: Date?) async -> [HostedGame]? {
        guard phase == .signedIn else { return nil }
        var games: [HostedGame] = []
        var cursor = since
        for _ in 0..<Self.maxHistoryPages {
            guard let page = try? await withAuth({ () async throws(APIError) in try await api.myGames(since: cursor) }) else {
                return nil
            }
            games += page
            guard page.count >= Self.historyPageSize, let last = page.last?.record.finishedAt else { break }
            cursor = last
        }
        return games
    }

    private static let historyPageSize = 50
    private static let maxHistoryPages = 20

    /// Идущие игры ведущего на сервере. `nil` — сервер недоступен.
    func activeGames() async -> [ActiveGameEnvelope]? {
        guard phase == .signedIn else { return nil }
        return try? await withAuth { () async throws(APIError) in try await api.activeGames() }
    }

    // MARK: - Сессии устройств

    /// Список устройств, где выполнен вход (секция «Сессии» в профиле).
    enum SessionList: Equatable {
        case loading
        case loaded([DeviceSession])
        /// Не загрузился (нет сети) — можно повторить.
        case failed
        /// Сервер ещё без списка сессий — секцию не показываем.
        case unsupported
    }

    private(set) var sessionList = SessionList.loading

    /// Без всплывающих ошибок: список второстепенный. Уже загруженный список при сбое остаётся.
    func refreshSessions() async {
        do throws(APIError) {
            let sessions = try await withAuth { () async throws(APIError) in try await api.sessions() }
            sessionList = .loaded(sessions)
        } catch {
            switch error {
            case .notFound: sessionList = .unsupported
            default: if case .loaded = sessionList {} else { sessionList = .failed }
            }
        }
    }

    /// Выйти на другом устройстве. Список перечитываем в любом случае: сессия могла завершиться сама.
    func revokeSession(_ session: DeviceSession) async {
        do throws(APIError) {
            try await withAuth { () async throws(APIError) in try await api.revokeSession(id: session.id) }
            if case let .loaded(sessions) = sessionList {
                sessionList = .loaded(sessions.filter { $0.id != session.id })
            }
        } catch {
            if case .notFound = error {} else { report(error) }
        }
        await refreshSessions()
    }

    private func apply(_ fresh: UserAccount) async {
        account = fresh
        do { try await store.updateAccount(fresh) } catch { report(error) }
    }

    /// Выход по кнопке: отзываем refresh-токен на сервере (без ожидания) и забываем сессию.
    func signOut() async {
        if let refreshToken = await store.load()?.tokens.refreshToken {
            let api = api
            Task { try? await api.logout(refreshToken: refreshToken) }
        }
        await endSession()
    }

    /// Удалить аккаунт на сервере, затем забыть вход и игры этого ведущего на телефоне.
    func deleteAccount() async -> Bool {
        guard let userID = account?.id else { return false }
        do throws(APIError) {
            try await withAuth { () async throws(APIError) in try await api.deleteAccount() }
        } catch {
            report(error)
            return false
        }
        await endSession()
        GameFiles.removeGames(of: userID)
        return true
    }

    private func endSession() async {
        refreshTask = nil
        await store.clear()
        account = nil
        sessionList = .loading
        login = TelegramLoginFlow()
        phase = .signedOut
    }

    // MARK: - Токены

    private enum RefreshOutcome {
        case refreshed
        /// Сервер отозвал сессию — нужно войти заново.
        case rejected
        /// Временный сбой (сеть, сервер) — сессия цела, просто повторим позже.
        case failed(APIError)
    }

    /// Запрос от имени пользователя: при истёкшем access-токене один раз обновляем пару и повторяем.
    private func withAuth<T>(_ call: () async throws(APIError) -> T) async throws(APIError) -> T {
        // В демо-режиме сервера нет: запрос не уходит, а сессия не «истекает» и не выкидывает на вход.
        guard phase != .demo else { throw .unauthorized }
        let usedToken = await store.accessToken()
        do {
            return try await call()
        } catch .unauthorized {
            switch await refreshTokens(after: usedToken) {
            case .refreshed:
                return try await call()
            case .rejected:
                await endSession()
                throw .unauthorized
            case let .failed(error):
                throw error
            }
        }
    }

    private func refreshTokens(after usedToken: String?) async -> RefreshOutcome {
        // Пока ждали ответа, токены уже обновил другой запрос.
        if let current = await store.accessToken(), current != usedToken { return .refreshed }
        if let running = refreshTask { return await running.value }

        // Отдельная задача: отмена вызвавшего экрана не должна оборвать обмен одноразового токена.
        let task = Task { () -> RefreshOutcome in
            guard let session = await store.load() else { return .rejected }
            do throws(APIError) {
                let tokens = try await api.refreshTokens(session.tokens.refreshToken)
                do { try await store.updateTokens(tokens) } catch { report(error) }
                return .refreshed
            } catch {
                switch error {
                case .unauthorized, .forbidden, .validation: return .rejected
                default: return .failed(error)
                }
            }
        }
        refreshTask = task
        let outcome = await task.value
        if refreshTask == task { refreshTask = nil }
        return outcome
    }

    private func report(_ error: any Error) {
        if Task.isCancelled { return }
        if case APIError.unauthorized = error { return }
        errorMessage = error.localizedDescription
    }
}

extension TelegramLoginFailure {
    var message: String {
        switch self {
        case let .rejected(note): note ?? "Вход отклонён"
        case .expired: "Время на вход истекло — попробуйте ещё раз"
        case let .network(text): text
        }
    }
}

/// Итог фоновой отправки на сервер.
enum SyncResult {
    /// Сервер принял.
    case done
    /// Сервер отказал по существу (данные, права) — повторять бессмысленно.
    case rejected
    /// Нет связи или сбой сервера — повторим позже.
    case offline

    init(_ error: APIError) {
        switch error {
        case .transport, .rateLimited, .unauthorized: self = .offline
        case let .server(status, _): self = status >= 500 ? .offline : .rejected
        case .conflict, .forbidden, .notFound, .validation, .decoding: self = .rejected
        }
    }
}
