/// Игровые баллы с точностью до сотых. Хранятся целым числом сотых, поэтому 0.1 + 0.2 == 0.3
/// и суммы за вечер/сезон не накапливают ошибку округления.
public struct Points: Hashable, Comparable, Sendable, AdditiveArithmetic,
    ExpressibleByFloatLiteral, ExpressibleByIntegerLiteral, CustomStringConvertible {
    public let hundredths: Int

    public init(hundredths: Int) {
        self.hundredths = hundredths
    }

    /// Из произвольного числа (ввод ведущего, JSON). `nil` для NaN, бесконечности и слишком больших чисел.
    /// Округление до сотых — половина от нуля: 0.125 → 0.13.
    public init?(_ value: Double) {
        guard value.isFinite, let hundredths = Int(exactly: (value * 100).rounded()) else { return nil }
        self.init(hundredths: hundredths)
    }

    /// Литералы в коде заведомо корректны (`let bonus: Points = 0.3`).
    public init(floatLiteral value: Double) {
        self.init(hundredths: Int((value * 100).rounded()))
    }

    public init(integerLiteral value: Int) {
        self.init(hundredths: value * 100)
    }

    public static let zero = Points(hundredths: 0)

    public static func + (lhs: Points, rhs: Points) -> Points {
        Points(hundredths: lhs.hundredths + rhs.hundredths)
    }

    public static func - (lhs: Points, rhs: Points) -> Points {
        Points(hundredths: lhs.hundredths - rhs.hundredths)
    }

    public static prefix func - (value: Points) -> Points {
        Points(hundredths: -value.hundredths)
    }

    public static func * (lhs: Points, rhs: Int) -> Points {
        Points(hundredths: lhs.hundredths * rhs)
    }

    public static func < (lhs: Points, rhs: Points) -> Bool {
        lhs.hundredths < rhs.hundredths
    }

    public var doubleValue: Double { Double(hundredths) / 100 }

    /// «1», «0.3», «-0.25» — без лишних нулей и без зависимости от локали.
    public var description: String {
        let sign = hundredths < 0 ? "-" : ""
        let absolute = abs(hundredths)
        let whole = absolute / 100
        let fraction = absolute % 100
        if fraction == 0 { return "\(sign)\(whole)" }
        if fraction.isMultiple(of: 10) { return "\(sign)\(whole).\(fraction / 10)" }
        let padded = fraction < 10 ? "0\(fraction)" : "\(fraction)"
        return "\(sign)\(whole).\(padded)"
    }
}

extension Points: Codable {
    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        guard let points = Points(try container.decode(Double.self)) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Некорректное количество баллов")
        }
        self = points
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(doubleValue)
    }
}

extension Sequence where Element == Points {
    public func sum() -> Points {
        reduce(.zero, +)
    }
}
