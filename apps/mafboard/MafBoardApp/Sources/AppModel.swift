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
    }

    static let apiBase = URL(string: "https://mafboard.titanpos.ru/api/mafboard")!
    static let returnHosts: Set<String> = ["mafboard.titanpos.ru"]

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
        if let session = await store.load() {
            account = session.account
            phase = .signedIn
            await refreshAccount()
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
        case .signedIn: break
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
    func uploadGame(_ record: GameRecord) async -> Bool {
        guard phase == .signedIn, record.host != nil else { return false }
        do throws(APIError) {
            try await withAuth { () async throws(APIError) in try await api.uploadGame(record) }
            return true
        } catch {
            if case .conflict = error { return true }
            return false
        }
    }

    // MARK: - Сессии устройств

    /// Устройства, где выполнен вход (блок «Сессии» в профиле). `nil` — список не загружен.
    private(set) var sessions: [DeviceSession]?

    /// Без всплывающих ошибок: список второстепенный, а ошибки сети уже показывает обновление аккаунта.
    func refreshSessions() async {
        do throws(APIError) {
            sessions = try await withAuth { () async throws(APIError) in try await api.sessions() }
        } catch {
            // Сервер без списка сессий (ещё не обновлён) — просто не показываем блок.
            if case .notFound = error { sessions = nil }
        }
    }

    /// Выйти на другом устройстве. Список перечитываем в любом случае: сессия могла завершиться сама.
    func revokeSession(_ session: DeviceSession) async {
        do throws(APIError) {
            try await withAuth { () async throws(APIError) in try await api.revokeSession(id: session.id) }
            sessions = sessions?.filter { $0.id != session.id }
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

    private func endSession() async {
        refreshTask = nil
        await store.clear()
        account = nil
        sessions = nil
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
