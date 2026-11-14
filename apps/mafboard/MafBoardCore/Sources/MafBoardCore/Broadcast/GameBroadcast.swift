import Foundation

/// Снимок идущей игры для инфографики эфира MafBoard Studio (контракт `GameBroadcast` версии 1).
///
/// Это не состояние движка, а уже посчитанная для зрителей проекция: MBS правила не повторяет,
/// только рисует. Поля и их имена один в один с `crates/mbs-protocol/src/game.rs` в MafBoard Studio.
/// Места — номера с единицы, перечисления — строками (`alive`, `votedOut`, `nightZero`, …).
public struct GameBroadcast: Codable, Sendable, Equatable {
    /// Версия контракта. Ноутбук отклоняет снимок другой версии.
    public static let currentVersion = 1

    public var version: Int
    public var gameId: String
    /// Растёт с каждым снимком. Старый снимок той же игры, пришедший позже нового, ноутбук отбрасывает.
    public var revision: UInt64
    public var title: String?
    public var gameNumber: Int?
    public var gamesTotal: Int?
    public var phase: Phase
    public var players: [Player]
    public var speech: Speech?
    public var nominations: [Nomination]
    public var voting: Voting?
    public var nights: [Night]
    public var days: [Day]
    public var bestMove: BestMove?
    public var outcome: Outcome?
    public var nextLineup: [LineupEntry]

    public init(
        gameId: String, revision: UInt64, title: String? = nil, gameNumber: Int? = nil, gamesTotal: Int? = nil,
        phase: Phase, players: [Player], speech: Speech? = nil, nominations: [Nomination] = [], voting: Voting? = nil,
        nights: [Night] = [], days: [Day] = [], bestMove: BestMove? = nil, outcome: Outcome? = nil,
        nextLineup: [LineupEntry] = []
    ) {
        version = Self.currentVersion
        self.gameId = gameId
        self.revision = revision
        self.title = title
        self.gameNumber = gameNumber
        self.gamesTotal = gamesTotal
        self.phase = phase
        self.players = players
        self.speech = speech
        self.nominations = nominations
        self.voting = voting
        self.nights = nights
        self.days = days
        self.bestMove = bestMove
        self.outcome = outcome
        self.nextLineup = nextLineup
    }
}

extension GameBroadcast {
    public enum PlayerStatus: String, Codable, Sendable {
        case alive
        /// Убит ночью.
        case killed
        /// Ушёл голосованием.
        case votedOut
        /// Удалён за фолы, дисквалифицирован или выведен ведущим.
        case removed
    }

    public struct Player: Codable, Sendable, Equatable {
        public var seat: Int
        public var nickname: String
        /// Только https: ноутбук отклоняет другие ссылки.
        public var avatarUrl: String?
        /// Код роли MafBoard (`Role.rawValue`).
        public var role: String?
        /// Название роли — для ролей, которых MBS не знает.
        public var roleName: String?
        public var team: Team?
        public var status: PlayerStatus
        public var fouls: Int
        public var techFouls: Int
        /// Пропустит ближайшую речь из-за фолов.
        public var silenced: Bool

        public init(
            seat: Int, nickname: String, avatarUrl: String? = nil, role: String? = nil, roleName: String? = nil,
            team: Team? = nil, status: PlayerStatus = .alive, fouls: Int = 0, techFouls: Int = 0, silenced: Bool = false
        ) {
            self.seat = seat
            self.nickname = nickname
            self.avatarUrl = avatarUrl
            self.role = role
            self.roleName = roleName
            self.team = team
            self.status = status
            self.fouls = fouls
            self.techFouls = techFouls
            self.silenced = silenced
        }
    }

    public enum PhaseKind: String, Codable, Sendable {
        case lobby, nightZero, day, voting, night, finished
    }

    public struct Phase: Codable, Sendable, Equatable {
        public var kind: PhaseKind
        /// Номер дня или ночи. Для нулевой ночи — 0.
        public var number: Int

        public init(kind: PhaseKind, number: Int) {
            self.kind = kind
            self.number = number
        }
    }

    public enum SpeechKind: String, Codable, Sendable {
        case speech
        case farewell
        /// Оправдательная речь в попиле.
        case defense
        /// Договорка, общая минута и другие шаги с таймером без одного говорящего.
        case common
    }

    /// Таймер речи. Ноутбук ведёт его сам от момента получения, поэтому снимок нужен только при старте,
    /// паузе и сбросе, а не каждую секунду.
    public struct Timer: Codable, Sendable, Equatable {
        public var totalSeconds: Int
        /// Сколько осталось на момент отправки, в миллисекундах.
        public var remainingMs: Int
        public var running: Bool

        public init(totalSeconds: Int, remainingMs: Int, running: Bool) {
            self.totalSeconds = totalSeconds
            self.remainingMs = remainingMs
            self.running = running
        }
    }

    public struct Speech: Codable, Sendable, Equatable {
        public var seat: Int?
        public var kind: SpeechKind
        public var timer: Timer?

        public init(seat: Int?, kind: SpeechKind, timer: Timer?) {
            self.seat = seat
            self.kind = kind
            self.timer = timer
        }
    }

    public struct Nomination: Codable, Sendable, Equatable {
        public var candidate: Int
        public var by: Int

        public init(candidate: Int, by: Int) {
            self.candidate = candidate
            self.by = by
        }
    }

    public struct VoteTally: Codable, Sendable, Equatable {
        public var candidate: Int
        public var votes: Int
        /// Пусто, если голоса считали по рукам.
        public var voters: [Int]

        public init(candidate: Int, votes: Int, voters: [Int] = []) {
            self.candidate = candidate
            self.votes = votes
            self.voters = voters
        }
    }

    public struct Voting: Codable, Sendable, Equatable {
        public var round: VotingRoundKind
        public var candidates: [Int]
        public var tallies: [VoteTally]
        /// Кандидат, за которого сейчас голосуют.
        public var current: Int?
        /// Попил: лидеры круга.
        public var tie: [Int]
        /// Покидают стол по итогу голосования.
        public var eliminated: [Int]
        /// Голоса «поднять всех».
        public var liftVotes: Int?

        public init(
            round: VotingRoundKind, candidates: [Int], tallies: [VoteTally] = [], current: Int? = nil,
            tie: [Int] = [], eliminated: [Int] = [], liftVotes: Int? = nil
        ) {
            self.round = round
            self.candidates = candidates
            self.tallies = tallies
            self.current = current
            self.tie = tie
            self.eliminated = eliminated
            self.liftVotes = liftVotes
        }
    }

    public struct Check: Codable, Sendable, Equatable {
        public var target: Int
        /// Шериф нашёл чёрного или дон нашёл шерифа.
        public var positive: Bool

        public init(target: Int, positive: Bool) {
            self.target = target
            self.positive = positive
        }
    }

    /// Одна ночь. Выстрел `nil` — промах или выстрела ещё не было.
    public struct Night: Codable, Sendable, Equatable {
        public var number: Int
        /// Ночь закончилась.
        public var resolved: Bool
        public var shot: Int?
        public var donCheck: Check?
        public var sheriffCheck: Check?

        public init(number: Int, resolved: Bool, shot: Int? = nil, donCheck: Check? = nil, sheriffCheck: Check? = nil) {
            self.number = number
            self.resolved = resolved
            self.shot = shot
            self.donCheck = donCheck
            self.sheriffCheck = sheriffCheck
        }
    }

    /// День: кто ушёл голосованием.
    public struct Day: Codable, Sendable, Equatable {
        public var number: Int
        public var eliminated: [Int]
        /// День закончился: итог окончательный.
        public var finished: Bool

        public init(number: Int, eliminated: [Int], finished: Bool) {
            self.number = number
            self.eliminated = eliminated
            self.finished = finished
        }
    }

    public struct BestMove: Codable, Sendable, Equatable {
        public var author: Int
        public var seats: [Int]
        public var points: Double?

        public init(author: Int, seats: [Int], points: Double? = nil) {
            self.author = author
            self.seats = seats
            self.points = points
        }
    }

    public struct PlayerScore: Codable, Sendable, Equatable {
        public var seat: Int
        /// Победа, поражение, ничья.
        public var main: Double
        public var extra: Double
        /// Штрафы со знаком минус.
        public var penalty: Double
        public var total: Double

        public init(seat: Int, main: Double, extra: Double, penalty: Double, total: Double) {
            self.seat = seat
            self.main = main
            self.extra = extra
            self.penalty = penalty
            self.total = total
        }
    }

    public struct Outcome: Codable, Sendable, Equatable {
        public var winner: Winner
        /// Баллы внесены окончательно. До этого итог показывается без таблицы.
        public var scoresFinal: Bool
        public var scores: [PlayerScore]

        public init(winner: Winner, scoresFinal: Bool, scores: [PlayerScore]) {
            self.winner = winner
            self.scoresFinal = scoresFinal
            self.scores = scores
        }
    }

    public struct LineupEntry: Codable, Sendable, Equatable {
        public var seat: Int
        public var nickname: String
        public var avatarUrl: String?

        public init(seat: Int, nickname: String, avatarUrl: String? = nil) {
            self.seat = seat
            self.nickname = nickname
            self.avatarUrl = avatarUrl
        }
    }
}

extension GameBroadcast {
    /// Тот же снимок позже: таймер, который идёт, отсчитан на `seconds` вперёд.
    /// Нужен, когда снимок досылается после переподключения к ноутбуку.
    public func aged(by seconds: TimeInterval) -> GameBroadcast {
        guard seconds > 0, let timer = speech?.timer, timer.running else { return self }
        var copy = self
        let remaining = max(0, timer.remainingMs - Int(seconds * 1000))
        copy.speech?.timer = Timer(totalSeconds: timer.totalSeconds, remainingMs: remaining, running: remaining > 0)
        return copy
    }
}
