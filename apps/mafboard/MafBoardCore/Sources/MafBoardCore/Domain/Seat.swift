/// Игровой номер за столом (1…N). Порядок номеров задаёт порядок речей.
public struct Seat: Hashable, Comparable, Sendable, ExpressibleByIntegerLiteral, CustomStringConvertible {
    public let number: Int

    public init(_ number: Int) {
        self.number = number
    }

    public init(integerLiteral value: Int) {
        self.init(value)
    }

    public static func < (lhs: Seat, rhs: Seat) -> Bool {
        lhs.number < rhs.number
    }

    public var description: String { String(number) }
}

extension Seat: Codable {
    public init(from decoder: any Decoder) throws {
        number = try decoder.singleValueContainer().decode(Int.self)
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(number)
    }
}
