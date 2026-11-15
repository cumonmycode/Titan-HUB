import Foundation

// Оформление эфира и чат через пульт: тот же JSON, что у MafBoard Studio
// (`mbs_core::broadcast::Broadcast`, `mbs_chat::ChatMessage`). Токены площадок остаются на ноутбуке.

/// Любое значение JSON: ответ студии разбирается уже там, где известен его вид.
public indirect enum RemoteJSON: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([RemoteJSON])
    case object([String: RemoteJSON])

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([RemoteJSON].self) {
            self = .array(value)
        } else {
            self = try .object(container.decode([String: RemoteJSON].self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case let .bool(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        }
    }

    public func decode<Value: Decodable>(as type: Value.Type) throws -> Value {
        try JSONDecoder().decode(type, from: JSONEncoder().encode(self))
    }

    public init<Value: Encodable>(encoding value: Value) throws {
        self = try JSONDecoder().decode(RemoteJSON.self, from: JSONEncoder().encode(value))
    }
}

/// Оформление эфира: общее для всех площадок и своё у каждой.
public struct RemoteBroadcast: Codable, Sendable, Equatable {
    public struct Cover: Codable, Sendable, Equatable {
        public var kind = "auto"
        public var path: String?
    }

    public struct Category: Codable, Sendable, Equatable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var art: String?

        public init(id: String, name: String, art: String? = nil) {
            self.id = id
            self.name = name
            self.art = art
        }
    }

    public struct Target: Codable, Sendable, Equatable {
        /// `new`, `nextScheduled`, `scheduled`.
        public var kind = "new"
        public var id: String?
        public var title: String?

        public init(kind: String = "new", id: String? = nil, title: String? = nil) {
            self.kind = kind
            self.id = id
            self.title = title
        }
    }

    public struct Look: Codable, Sendable, Equatable {
        public var title: String?
        public var description: String?
        public var tags: [String]?
        public var category: Category?
        public var target = Target()
        public var privacy = "public"
        public var latency = "low"
        public var madeForKids = false
        public var dvr = true
        public var language: String?
        public var labels: [String] = []
        public var branded = false

        public init() {}

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            title = try c.decodeIfPresent(String.self, forKey: .title)
            description = try c.decodeIfPresent(String.self, forKey: .description)
            tags = try c.decodeIfPresent([String].self, forKey: .tags)
            category = try c.decodeIfPresent(Category.self, forKey: .category)
            target = try c.decodeIfPresent(Target.self, forKey: .target) ?? Target()
            privacy = try c.decodeIfPresent(String.self, forKey: .privacy) ?? "public"
            latency = try c.decodeIfPresent(String.self, forKey: .latency) ?? "low"
            madeForKids = try c.decodeIfPresent(Bool.self, forKey: .madeForKids) ?? false
            dvr = try c.decodeIfPresent(Bool.self, forKey: .dvr) ?? true
            language = try c.decodeIfPresent(String.self, forKey: .language)
            labels = try c.decodeIfPresent([String].self, forKey: .labels) ?? []
            branded = try c.decodeIfPresent(Bool.self, forKey: .branded) ?? false
        }
    }

    public var title = ""
    public var description = ""
    public var tags: [String] = []
    public var cover = Cover()
    public var platforms: [String: Look] = [:]

    public init() {}

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        tags = try c.decodeIfPresent([String].self, forKey: .tags) ?? []
        cover = try c.decodeIfPresent(Cover.self, forKey: .cover) ?? Cover()
        platforms = try c.decodeIfPresent([String: Look].self, forKey: .platforms) ?? [:]
    }

    public func look(_ platform: String) -> Look { platforms[platform] ?? Look() }

    /// Категория для мафии, пока ведущий не выбрал свою (как `default_category` в студии).
    public static func defaultCategory(_ platform: String) -> Category? {
        switch platform {
        case "youtube": Category(id: "20", name: "Игры")
        case "twitch": Category(id: "365898311", name: "Mafia Online")
        case "vk": Category(id: "36299e08-f322-4931-89eb-f7f9c409d9eb", name: "Спортивная мафия")
        default: nil
        }
    }

    public func category(_ platform: String) -> Category? { look(platform).category ?? Self.defaultCategory(platform) }

    /// Теги так, как их примет Twitch: без пробелов и знаков, до 25 символов, не больше 10.
    public static func twitchTags(_ tags: [String]) -> [String] {
        var out: [String] = []
        for tag in tags {
            let clean = String(tag.filter { $0.isLetter || $0.isNumber }.prefix(25))
            if !clean.isEmpty, !out.contains(where: { $0.lowercased() == clean.lowercased() }) { out.append(clean) }
        }
        return Array(out.prefix(10))
    }

    /// Площадки, у которых оформление уходит через API.
    public static let lookPlatforms = ["youtube", "twitch", "vk"]
}

/// Что студия отдаёт экрану оформления: профиль, ведущий, входы в площадки и само оформление.
public struct RemoteBroadcastView: Decodable, Sendable, Equatable {
    public struct Platform: Decodable, Sendable, Equatable, Identifiable {
        public let id: String
        public let name: String
        /// Канал, в который выполнен вход. Нет — ключ введён вручную или его нет.
        public let account: String?
        public let hasKey: Bool
    }

    public let profile: String
    public let host: String
    public let enabled: [String]
    public var broadcast: RemoteBroadcast
    public let platforms: [Platform]
}

public struct RemoteUpcoming: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    /// RFC 3339.
    public let starts: String?
}

/// Сообщение чата любой площадки.
public struct RemoteChatMessage: Decodable, Sendable, Equatable, Identifiable {
    public struct Emote: Decodable, Sendable, Equatable {
        public let code: String
        public let url: String
    }

    public let seq: UInt64
    public let platform: String
    public let messageID: String
    public let author: String
    public let color: String?
    public let text: String
    public let atMs: Int64
    /// `owner`, `moderator`, `vip`, `subscriber`, `verified`.
    public let badges: [String]
    public let emotes: [Emote]
    /// Донат, суперчат или биты: «500 ₽», «100 bits».
    public let amount: String?

    public var id: String { "\(platform):\(messageID)" }
    public var date: Date { Date(timeIntervalSince1970: Double(atMs) / 1000) }

    private enum CodingKeys: String, CodingKey {
        case seq, platform, author, color, text, atMs, badges, emotes, amount
        case messageID = "id"
    }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seq = try c.decodeIfPresent(UInt64.self, forKey: .seq) ?? 0
        platform = try c.decode(String.self, forKey: .platform)
        messageID = try c.decode(String.self, forKey: .messageID)
        author = try c.decode(String.self, forKey: .author)
        color = try c.decodeIfPresent(String.self, forKey: .color)
        text = try c.decode(String.self, forKey: .text)
        atMs = try c.decode(Int64.self, forKey: .atMs)
        badges = try c.decodeIfPresent([String].self, forKey: .badges) ?? []
        emotes = try c.decodeIfPresent([Emote].self, forKey: .emotes) ?? []
        amount = try c.decodeIfPresent(String.self, forKey: .amount)
    }
}
