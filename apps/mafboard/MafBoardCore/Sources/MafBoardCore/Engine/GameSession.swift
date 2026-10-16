import Foundation

/// Запись журнала: действие ведущего и время, когда оно сделано.
public struct LogEntry: Codable, Sendable, Equatable {
    public let action: GameAction
    public let date: Date
}

/// Идущая игра: исходные данные + журнал действий. Состояние всегда выводится из журнала,
/// поэтому отмена шага — это просто переигрывание журнала без последней записи,
/// а сохранение/восстановление после падения приложения не может «разъехаться».
public struct GameSession: Sendable, Equatable {
    public let setup: GameSetup
    public private(set) var log: [LogEntry]
    public private(set) var state: GameState

    public init(setup: GameSetup) {
        self.setup = setup
        log = []
        state = GameEngine.start(setup)
    }

    public var canUndo: Bool { !log.isEmpty }

    public mutating func perform(_ action: GameAction, at date: Date = .now) throws(GameError) {
        state = try GameEngine.apply(action, to: state, at: date)
        log.append(LogEntry(action: action, date: date))
    }

    /// Отменяет последнее действие ведущего и возвращает его.
    @discardableResult
    public mutating func undo() throws(GameError) -> GameAction {
        guard let last = log.last else { throw .nothingToUndo }
        let remaining = Array(log.dropLast())
        state = try Self.replay(setup: setup, log: remaining)
        log = remaining
        return last.action
    }

    public static func replay(setup: GameSetup, log: [LogEntry]) throws(GameError) -> GameState {
        var state = GameEngine.start(setup)
        for entry in log {
            state = try GameEngine.apply(entry.action, to: state, at: entry.date)
        }
        return state
    }
}

/// Сохраняются только исходные данные и журнал. Правило совместимости: новая версия движка обязана
/// воспроизводить журналы старых версий; если это невозможно — поднимаем `currentSchemaVersion` и пишем миграцию.
extension GameSession: Codable {
    public static let currentSchemaVersion = 1

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case setup
        case log
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        guard version <= Self.currentSchemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .schemaVersion, in: container,
                debugDescription: "Игра сохранена более новой версией приложения (\(version))"
            )
        }
        setup = try container.decode(GameSetup.self, forKey: .setup)
        log = try container.decode([LogEntry].self, forKey: .log)
        do {
            state = try Self.replay(setup: setup, log: log)
        } catch {
            throw DecodingError.dataCorrupted(DecodingError.Context(
                codingPath: container.codingPath,
                debugDescription: "Журнал игры не воспроизводится: \(error.localizedDescription)"
            ))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.currentSchemaVersion, forKey: .schemaVersion)
        try container.encode(setup, forKey: .setup)
        try container.encode(log, forKey: .log)
    }
}
