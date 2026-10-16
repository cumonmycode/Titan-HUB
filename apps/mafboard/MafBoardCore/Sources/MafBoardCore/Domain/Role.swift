/// Команда игрока.
public enum Team: String, Codable, Sendable, CaseIterable {
    /// Мирные жители, шериф и остальные «красные» роли.
    case red
    /// Дон, мафия и остальные «чёрные» роли.
    case black

    public var displayName: String {
        switch self {
        case .red: "Красные"
        case .black: "Чёрные"
        }
    }
}

/// Игровая роль. Базовые роли используются в обоих вариантах, остальные — только в городской мафии.
public enum Role: String, Codable, Sendable, CaseIterable {
    // Базовые
    case civilian, sheriff, don, mafia
    // Городская: красные
    case doctor, detective, jailer, prostitute, bodyguard, sleepwalker
    case journalist, priest, judge, kamikaze, immortal, beauty
    // Городская: чёрные
    case maniac, oyabun, yakuza, ripper, swindler, thief, snitch, fangirl, lawyer
}

extension Role {
    public var team: Team {
        switch self {
        case .don, .mafia, .maniac, .oyabun, .yakuza, .ripper, .swindler, .thief, .snitch, .fangirl, .lawyer:
            .black
        case .civilian, .sheriff, .doctor, .detective, .jailer, .prostitute, .bodyguard, .sleepwalker,
             .journalist, .priest, .judge, .kamikaze, .immortal, .beauty:
            .red
        }
    }

    /// Роль может достаться только одному игроку за столом.
    public var isUnique: Bool {
        self != .civilian && self != .mafia
    }

    /// Просыпается вместе с мафией и участвует в общем ночном выстреле.
    public var joinsMafiaShot: Bool {
        team == .black && self != .maniac
    }

    /// Способность роли полностью ведёт движок. Последствия остальных ролей
    /// ведущий пока отмечает вручную (`GameAction.eliminateByHost` и т.п.).
    public var isAutomated: Bool {
        switch self {
        case .civilian, .sheriff, .don, .mafia, .doctor, .maniac, .immortal: true
        default: false
        }
    }

    public var displayName: String {
        switch self {
        case .civilian: "Мирный"
        case .sheriff: "Шериф"
        case .don: "Дон"
        case .mafia: "Мафия"
        case .doctor: "Доктор"
        case .detective: "Детектив"
        case .jailer: "Тюремщик"
        case .prostitute: "Проститутка"
        case .bodyguard: "Телохранитель"
        case .sleepwalker: "Лунатик"
        case .journalist: "Журналист"
        case .priest: "Священник"
        case .judge: "Судья"
        case .kamikaze: "Камикадзе"
        case .immortal: "Бессмертный"
        case .beauty: "Красотка"
        case .maniac: "Маньяк"
        case .oyabun: "Оябун"
        case .yakuza: "Якудза"
        case .ripper: "Потрошитель"
        case .swindler: "Аферист"
        case .thief: "Вор"
        case .snitch: "Стукач"
        case .fangirl: "Поклонница"
        case .lawyer: "Адвокат"
        }
    }
}
