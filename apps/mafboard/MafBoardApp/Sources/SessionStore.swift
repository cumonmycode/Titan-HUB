import Foundation
import Security
import MafBoardClient
import MafBoardCore

enum KeychainError: Error, LocalizedError {
    case status(OSStatus)

    var errorDescription: String? {
        switch self {
        case let .status(code): "Не удалось сохранить данные входа (Keychain \(code))"
        }
    }
}

/// Незавершённый вход через бота: переживает перезапуск приложения, пока пользователь в Telegram.
struct PendingLogin: Codable {
    let ticket: LoginTicket
    let secret: DeviceSecret
}

/// Сессия (токены + аккаунт) в Keychain: переживает перезапуск, не уходит в бэкапы
/// на другие устройства. Отдаёт access-токен клиенту API.
actor SessionStore: AccessTokenProvider {
    private let service = "ru.titan.mafboard.session"
    private let sessionKey = "default"
    private let pendingLoginKey = "pending-login"
    private var cached: AuthSession?
    private var isLoaded = false

    func load() -> AuthSession? {
        if isLoaded { return cached }
        switch read(sessionKey) {
        case let .success(data):
            isLoaded = true
            cached = data.flatMap { try? JSONDecoder().decode(AuthSession.self, from: $0) }
        case .failure:
            // Keychain временно недоступен (например, до первой разблокировки) — попробуем позже.
            return nil
        }
        return cached
    }

    func save(_ session: AuthSession) throws(KeychainError) {
        cached = session
        isLoaded = true
        guard let data = try? JSONEncoder().encode(session) else { return }
        try write(data, for: sessionKey)
    }

    func updateTokens(_ tokens: AuthTokens) throws(KeychainError) {
        guard let current = load() else { return }
        try save(AuthSession(tokens: tokens, account: current.account))
    }

    func updateAccount(_ account: UserAccount) throws(KeychainError) {
        guard let current = load() else { return }
        try save(AuthSession(tokens: current.tokens, account: account))
    }

    func clear() {
        cached = nil
        isLoaded = true
        delete(sessionKey)
    }

    func accessToken() async -> String? {
        load()?.tokens.accessToken
    }

    // MARK: Незавершённый вход

    func loadPendingLogin() -> PendingLogin? {
        guard case let .success(data?) = read(pendingLoginKey) else { return nil }
        return try? JSONDecoder().decode(PendingLogin.self, from: data)
    }

    func savePendingLogin(_ pending: PendingLogin?) {
        guard let pending, let data = try? JSONEncoder().encode(pending) else {
            delete(pendingLoginKey)
            return
        }
        try? write(data, for: pendingLoginKey)
    }

    // MARK: Keychain

    private func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    /// `nil` внутри `success` — записи нет.
    private func read(_ key: String) -> Result<Data?, KeychainError> {
        var request = query(key)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        switch status {
        case errSecSuccess: return .success(item as? Data)
        case errSecItemNotFound: return .success(nil)
        default: return .failure(.status(status))
        }
    }

    /// Обновление на месте, без окна «старое удалено — новое не записано»: refresh-токен одноразовый.
    private func write(_ data: Data, for key: String) throws(KeychainError) {
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query(key) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query(key).merging(attributes) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw .status(status) }
    }

    private func delete(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
