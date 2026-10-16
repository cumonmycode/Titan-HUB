/// Куда попадают игры ведущего.
public enum HistoryDestination: Codable, Sendable, Equatable {
    /// Личная история ведущего (без GoMafia или без клуба).
    case personal
    /// История игр клуба GoMafia, в котором состоит ведущий.
    case club(GoMafiaClub)
}

/// Кто провёл игру и от какого клуба. Сохраняется в `GameSetup` и уходит в историю клуба.
public struct HostContext: Codable, Sendable, Equatable {
    public let userID: UserID
    public let goMafiaPlayerID: Int?
    public let clubID: Int?

    public init(userID: UserID, goMafiaPlayerID: Int? = nil, clubID: Int? = nil) {
        self.userID = userID
        self.goMafiaPlayerID = goMafiaPlayerID
        self.clubID = clubID
    }
}

/// Права ведущего. Без аккаунта GoMafia — только фанки. С аккаунтом и клубом — все режимы,
/// а игры сохраняются в историю клуба.
public struct HostingAccess: Sendable, Equatable {
    public let allowedFormats: [CompetitionFormat]
    public let history: HistoryDestination
    public let host: HostContext
    private let isGoMafiaLinked: Bool

    public init(account: UserAccount) {
        let link = account.goMafia
        isGoMafiaLinked = link != nil
        host = HostContext(userID: account.id, goMafiaPlayerID: link?.player.id, clubID: link?.club?.id)
        if let club = link?.club {
            allowedFormats = CompetitionFormat.allCases
            history = .club(club)
        } else {
            allowedFormats = [.funky]
            history = .personal
        }
    }

    public func allows(_ format: CompetitionFormat) -> Bool {
        allowedFormats.contains(format)
    }

    /// Проверка перед стартом игры: доступен ли режим и все ли игроки из GoMafia, если игра идёт в рейтинг.
    public func authorize(format: CompetitionFormat, players: [PlayerProfile]) throws(GameError) {
        guard allows(format) else {
            throw .accessDenied(isGoMafiaLinked ? .formatRequiresClub(format) : .formatRequiresGoMafia(format))
        }
        guard format.countsTowardStandings else { return }
        let guests = players.filter { $0.goMafiaID == nil }.map(\.nickname)
        guard guests.isEmpty else {
            throw .accessDenied(.goMafiaPlayersRequired(nicknames: guests))
        }
    }
}
