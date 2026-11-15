import Foundation
import MafBoardCore

// Что передаётся внутри зашифрованных кадров. Имена полей те же, что на ноутбуке:
// образцы лежат в общих векторах и проверяются с обеих сторон.

/// Что можно с телефона. Остановки движка здесь нет и быть не должно.
public enum RemoteCommand: Sendable, Equatable {
    case switchScene(String)
    case setMicMuted(Bool)
    case setLanEnabled(Bool)
    case selectCamera(String)
    case startRecording
    case stopRecording
    /// Снимок идущей игры для инфографики эфира.
    case setGame(GameBroadcast)
    /// Игра удалена: инфографика уходит с экрана.
    case clearGame
    /// Оформление эфира и чат: отвечает студия (`DesktopMessage.answer`).
    case getBroadcast
    case setBroadcast(RemoteBroadcast)
    case searchCategories(platform: String, query: String)
    case youtubeUpcoming
    case chatBacklog
    case sendChat(platform: String, text: String)
}

extension RemoteCommand: Encodable {
    private enum CodingKeys: String, CodingKey {
        case kind, scene, muted, enabled, uid, game, broadcast, platform, query, text
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .switchScene(scene):
            try container.encode("switchScene", forKey: .kind)
            try container.encode(scene, forKey: .scene)
        case let .setMicMuted(muted):
            try container.encode("setMicMuted", forKey: .kind)
            try container.encode(muted, forKey: .muted)
        case let .setLanEnabled(enabled):
            try container.encode("setLanEnabled", forKey: .kind)
            try container.encode(enabled, forKey: .enabled)
        case let .selectCamera(uid):
            try container.encode("selectCamera", forKey: .kind)
            try container.encode(uid, forKey: .uid)
        case .startRecording:
            try container.encode("startRecording", forKey: .kind)
        case .stopRecording:
            try container.encode("stopRecording", forKey: .kind)
        case let .setGame(game):
            try container.encode("setGame", forKey: .kind)
            try container.encode(game, forKey: .game)
        case .clearGame:
            try container.encode("clearGame", forKey: .kind)
        case .getBroadcast:
            try container.encode("getBroadcast", forKey: .kind)
        case let .setBroadcast(broadcast):
            try container.encode("setBroadcast", forKey: .kind)
            try container.encode(broadcast, forKey: .broadcast)
        case let .searchCategories(platform, query):
            try container.encode("searchCategories", forKey: .kind)
            try container.encode(platform, forKey: .platform)
            try container.encode(query, forKey: .query)
        case .youtubeUpcoming:
            try container.encode("youtubeUpcoming", forKey: .kind)
        case .chatBacklog:
            try container.encode("chatBacklog", forKey: .kind)
        case let .sendChat(platform, text):
            try container.encode("sendChat", forKey: .kind)
            try container.encode(platform, forKey: .platform)
            try container.encode(text, forKey: .text)
        }
    }
}

/// Команда в пути. По `id` ноутбук узнаёт повтор, а по `sentAtMs` отбрасывает застрявшую.
public struct RemoteEnvelope: Encodable, Sendable, Equatable {
    public let id: String
    public let sentAtMs: UInt64
    public let command: RemoteCommand

    public init(id: String, sentAtMs: UInt64, command: RemoteCommand) {
        self.id = id
        self.sentAtMs = sentAtMs
        self.command = command
    }
}

public struct RemoteScene: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct RemoteCamera: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct RemoteVideo: Decodable, Sendable, Equatable {
    public let width: Int
    public let height: Int
    public let fps: Int

    public init(width: Int, height: Int, fps: Int) {
        self.width = width
        self.height = height
        self.fps = fps
    }
}

public struct RemoteState: Decodable, Sendable, Equatable {
    public let scenes: [RemoteScene]
    public let activeScene: String
    public let cameras: [RemoteCamera]
    public let cameraUid: String?
    public let micMuted: Bool
    public let recording: Bool
    public let lanEnabled: Bool
    public let lanUrls: [String]
    public let video: RemoteVideo

    public init(
        scenes: [RemoteScene], activeScene: String, cameras: [RemoteCamera], cameraUid: String?,
        micMuted: Bool, recording: Bool, lanEnabled: Bool, lanUrls: [String], video: RemoteVideo
    ) {
        self.scenes = scenes
        self.activeScene = activeScene
        self.cameras = cameras
        self.cameraUid = cameraUid
        self.micMuted = micMuted
        self.recording = recording
        self.lanEnabled = lanEnabled
        self.lanUrls = lanUrls
        self.video = video
    }
}

public struct RemoteStats: Decodable, Sendable, Equatable {
    public let uptimeSeconds: UInt64
    public let recordingSeconds: UInt64?
    public let recordingBytes: UInt64
    public let framesSkipped: UInt32
    public let lanActive: Bool

    public init(uptimeSeconds: UInt64, recordingSeconds: UInt64?, recordingBytes: UInt64, framesSkipped: UInt32, lanActive: Bool) {
        self.uptimeSeconds = uptimeSeconds
        self.recordingSeconds = recordingSeconds
        self.recordingBytes = recordingBytes
        self.framesSkipped = framesSkipped
        self.lanActive = lanActive
    }
}

/// Кадр от ноутбука. Незнакомый вид не ломает разбор: ноутбук может быть новее телефона.
public enum DesktopMessage: Sendable, Equatable {
    case state(RemoteState)
    case stats(RemoteStats)
    /// `nil` — тишина: у ноутбука нет числового значения уровня.
    case level(peakDb: Double?)
    case reply(id: String, error: String?)
    /// Ответ студии на запрос оформления или чата.
    case answer(id: String, error: String?, data: RemoteJSON?)
    /// Новые сообщения чата всех площадок.
    case chat([RemoteChatMessage])
    case engine(online: Bool)
    case alive
    case unknown(String)
}

extension DesktopMessage: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, state, stats, peakDb, id, error, online, data, messages
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "state": self = try .state(container.decode(RemoteState.self, forKey: .state))
        case "stats": self = try .stats(container.decode(RemoteStats.self, forKey: .stats))
        case "level": self = try .level(peakDb: container.decodeIfPresent(Double.self, forKey: .peakDb))
        case "reply": self = try .reply(id: container.decode(String.self, forKey: .id), error: container.decodeIfPresent(String.self, forKey: .error))
        case "answer":
            self = try .answer(
                id: container.decode(String.self, forKey: .id),
                error: container.decodeIfPresent(String.self, forKey: .error),
                data: container.decodeIfPresent(RemoteJSON.self, forKey: .data)
            )
        case "chat":
            // Сообщение, которое телефон не понял, не ломает весь кадр.
            let items = try container.decode([RemoteJSON].self, forKey: .messages)
            self = .chat(items.compactMap { try? $0.decode(as: RemoteChatMessage.self) })
        case "engine": self = try .engine(online: container.decode(Bool.self, forKey: .online))
        case "alive": self = .alive
        default: self = .unknown(type)
        }
    }
}
