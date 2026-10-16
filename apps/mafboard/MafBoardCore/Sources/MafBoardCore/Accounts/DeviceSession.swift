import Foundation

/// Устройство, где выполнен вход в аккаунт (сессия на сервере). Список — блок «Сессии» в профиле.
public struct DeviceSession: Codable, Sendable, Equatable, Identifiable {
    /// id сессии на сервере. Строкой — уходит обратно в запрос отзыва как есть.
    public let id: String
    /// Имя устройства при входе («iPhone»). У сессий, открытых до появления списка, может не быть.
    public var deviceName: String?
    /// `ios` или `android`.
    public var platform: String?
    public let createdAt: Date
    public var lastUsedAt: Date
    /// Сессия устройства, с которого смотрят список.
    public var isCurrent: Bool

    public init(
        id: String,
        deviceName: String? = nil,
        platform: String? = nil,
        createdAt: Date,
        lastUsedAt: Date,
        isCurrent: Bool = false
    ) {
        self.id = id
        self.deviceName = deviceName
        self.platform = platform
        self.createdAt = createdAt
        self.lastUsedAt = lastUsedAt
        self.isCurrent = isCurrent
    }

    /// Название в списке: имя устройства, а без него — платформа.
    public var displayName: String {
        if let deviceName, !deviceName.isEmpty { return deviceName }
        return switch platform {
        case "ios": "iPhone"
        case "android": "Android"
        default: "Устройство"
        }
    }

    /// Последняя активность: «только что», «5 мин назад», «3 ч назад», «2 дн. назад», старше недели — дата.
    public func lastSeen(relativeTo now: Date) -> String {
        let minutes = max(0, Int(now.timeIntervalSince(lastUsedAt) / 60))
        let hour = 60
        let day = 24 * hour
        return switch minutes {
        case ..<1: "только что"
        case ..<hour: "\(minutes) мин назад"
        case ..<day: "\(minutes / hour) ч назад"
        case ..<(7 * day): "\(minutes / day) дн. назад"
        default: lastUsedAt.formatted(.dateTime.day().month(.abbreviated).locale(Locale(identifier: "ru_RU")))
        }
    }
}
