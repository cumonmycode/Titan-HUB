import Foundation

/// Типобезопасный идентификатор сущности: `PlayerID` нельзя случайно передать вместо `GameID`.
public struct Identifier<Entity>: Hashable, Sendable, CustomStringConvertible {
    public let rawValue: UUID

    public init(_ rawValue: UUID = UUID()) {
        self.rawValue = rawValue
    }

    public var description: String { rawValue.uuidString }
}

extension Identifier: Codable {
    public init(from decoder: any Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(UUID.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public typealias PlayerID = Identifier<PlayerProfile>
public typealias GameID = Identifier<GameRecord>
public typealias SeriesID = Identifier<Series>
