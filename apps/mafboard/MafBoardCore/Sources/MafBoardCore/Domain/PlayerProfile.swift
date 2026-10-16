import Foundation

/// Игрок за столом. Обычно — из GoMafia; гость без GoMafia допустим только в фанке.
public struct PlayerProfile: Identifiable, Codable, Sendable, Equatable {
    public let id: PlayerID
    public var nickname: String
    public var goMafiaID: Int?
    public var avatarURL: URL?

    /// Гость без аккаунта GoMafia.
    public init(nickname: String, id: PlayerID = PlayerID(), avatarURL: URL? = nil) {
        self.id = id
        self.nickname = nickname
        goMafiaID = nil
        self.avatarURL = avatarURL
    }

    /// Игрок GoMafia: идентификатор выводится из номера GoMafia и совпадает на всех устройствах.
    public init(goMafia player: GoMafiaPlayer) {
        id = .goMafia(player.id)
        nickname = player.nickname
        goMafiaID = player.id
        avatarURL = player.avatarURL
    }
}
