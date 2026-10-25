import SwiftUI
import MafBoardCore

// MARK: - Хронология: модель

/// Что произошло в фазе игры — в том виде, в каком это удобно пересмотреть после игры.
enum TimelineEntry {
    /// Выставления дня: кто кого.
    case nominations([NominationMark])
    /// Раунд голосования: голоса у каждого кандидата и, если считали поимённо, кто за кого.
    case voting(VotingRound)
    /// Итог голосования: кто выбыл или почему голосования не было.
    case verdict(VotingRecord)
    /// Выстрел. Промах — с подробностями, кто куда стрелял (если ведущий их записал).
    case shot(killer: Killer, target: Seat?, misses: [MissedShot])
    case check(NightCheck)
    case heal(Seat)
    case morning(NightReport)
    /// Удаление за нарушения или выбывание по решению ведущего.
    case removal(Seat, EliminationCause)
    case bestMove(BestMove)
    case colorProtocol(ColorProtocol)
    /// Фолы, техфолы и прочее в фазе — одной строкой.
    case discipline([DisciplineMark])
    case finished(GameOutcome)
}

struct NominationMark: Hashable {
    let by: Seat
    let candidate: Seat
    var isWithdrawn = false
}

struct DisciplineMark: Hashable {
    let seat: Seat
    let text: String
    let tint: Color
}

struct TimelineItem: Identifiable {
    let id: Int
    var entry: TimelineEntry
}

struct TimelinePhase: Identifiable {
    let id: Int
    let moment: GameMoment
    let startedAt: Date
    var items: [TimelineItem]
}

enum GameTimeline {
    /// Фазы игры с их событиями. Служебное (начало шага, очередная речь) пропускаем.
    /// `revealsRoles == false` — без «кто куда стрелял»: это выдаёт состав мафии.
    static func phases(from events: [GameEvent], revealsRoles: Bool) -> [TimelinePhase] {
        var builder = Builder(revealsRoles: revealsRoles)
        for event in events {
            builder.add(event)
        }
        return builder.phases.filter { !$0.items.isEmpty }
    }

    private struct Builder {
        let revealsRoles: Bool
        var phases: [TimelinePhase] = []
        private var nextID = 0

        init(revealsRoles: Bool) {
            self.revealsRoles = revealsRoles
        }

        private var lastEntry: TimelineEntry? { phases.last?.items.last?.entry }

        mutating func add(_ event: GameEvent) {
            switch event.kind {
            case let .nominated(candidate, by):
                let mark = NominationMark(by: by, candidate: candidate)
                if case var .nominations(marks)? = lastEntry {
                    marks.append(mark)
                    replaceLast(.nominations(marks))
                } else {
                    append(.nominations([mark]), for: event)
                }
            case let .nominationWithdrawn(candidate, by):
                if case var .nominations(marks)? = lastEntry,
                   let index = marks.lastIndex(where: { $0.by == by && $0.candidate == candidate && !$0.isWithdrawn }) {
                    marks[index].isWithdrawn = true
                    replaceLast(.nominations(marks))
                }
            case let .votingRound(round):
                append(.voting(round), for: event)
            case let .votingFinished(record):
                append(.verdict(record), for: event)
            case let .shot(killer, target):
                // Подробности промаха могли прийти раньше самого промаха — тогда строка уже есть.
                if target.seat == nil, case let .shot(_, nil, misses)? = lastEntry, !misses.isEmpty {
                    replaceLast(.shot(killer: killer, target: nil, misses: misses))
                } else {
                    append(.shot(killer: killer, target: target.seat, misses: []), for: event)
                }
            case let .missedShots(shots):
                guard revealsRoles else { break }
                if case let .shot(killer, nil, _)? = lastEntry {
                    replaceLast(.shot(killer: killer, target: nil, misses: shots))
                } else {
                    append(.shot(killer: .mafia, target: nil, misses: shots), for: event)
                }
            case let .check(check):
                append(.check(check), for: event)
            case let .heal(seat):
                append(.heal(seat), for: event)
            case let .nightResolved(report):
                append(.morning(report), for: event)
            case let .eliminated(seat, cause):
                // Убитых и заголосованных видно в утре и итоге голосования.
                switch cause {
                case .removed, .hostDecision: append(.removal(seat, cause), for: event)
                case .killed, .votedOut: break
                }
            case let .bestMove(move):
                // Правка лучшего хода — показываем последний вариант.
                removeAll { if case let .bestMove(old) = $0 { old.author == move.author } else { false } }
                append(.bestMove(move), for: event)
            case let .protocolRecorded(proto):
                removeAll { if case let .colorProtocol(old) = $0 { old.author == proto.author } else { false } }
                append(.colorProtocol(proto), for: event)
            case let .foul(seat, total):
                addDiscipline(DisciplineMark(seat: seat, text: "фол \(total)-й", tint: .orange), for: event)
            case let .foulCancelled(seat, total):
                addDiscipline(DisciplineMark(seat: seat, text: "снят фол, осталось \(total)", tint: .secondary), for: event)
            case let .techFoul(seat, _):
                addDiscipline(DisciplineMark(seat: seat, text: "МТФ", tint: .red), for: event)
            case let .bigTechFoul(seat, _):
                addDiscipline(DisciplineMark(seat: seat, text: "БТФ", tint: .red), for: event)
            case let .techFoulCancelled(seat, _):
                addDiscipline(DisciplineMark(seat: seat, text: "снят техфол", tint: .secondary), for: event)
            case let .warning(seat, total):
                addDiscipline(DisciplineMark(seat: seat, text: "предупреждение \(total)-е", tint: .yellow), for: event)
            case let .extraTime(seat, seconds):
                addDiscipline(DisciplineMark(seat: seat, text: "+\(seconds) сек за фолы", tint: .orange), for: event)
            case let .speechHalved(seat):
                addDiscipline(DisciplineMark(seat: seat, text: "речь полминуты", tint: .orange), for: event)
            case let .silenced(seat):
                addDiscipline(DisciplineMark(seat: seat, text: "пропустит речь", tint: .orange), for: event)
            case let .sheriffClaimMarked(seat, claimed) where claimed:
                addDiscipline(DisciplineMark(seat: seat, text: "вскрылся шерифом", tint: .yellow), for: event)
            case let .gameFinished(outcome):
                append(.finished(outcome), for: event)
            default:
                break
            }
        }

        private mutating func append(_ entry: TimelineEntry, for event: GameEvent) {
            nextID += 1
            let item = TimelineItem(id: nextID, entry: entry)
            if let last = phases.indices.last, phases[last].moment == event.moment {
                phases[last].items.append(item)
            } else {
                phases.append(TimelinePhase(id: nextID, moment: event.moment, startedAt: event.date, items: [item]))
            }
        }

        private mutating func replaceLast(_ entry: TimelineEntry) {
            guard let phase = phases.indices.last, let item = phases[phase].items.indices.last else { return }
            phases[phase].items[item].entry = entry
        }

        private mutating func addDiscipline(_ mark: DisciplineMark, for event: GameEvent) {
            if phases.last?.moment == event.moment, case var .discipline(marks)? = lastEntry {
                marks.append(mark)
                replaceLast(.discipline(marks))
            } else {
                append(.discipline([mark]), for: event)
            }
        }

        private mutating func removeAll(where shouldRemove: (TimelineEntry) -> Bool) {
            for phase in phases.indices {
                phases[phase].items.removeAll { shouldRemove($0.entry) }
            }
        }
    }
}

extension NightCheck {
    /// «чёрный», «красный», «шериф», «не шериф».
    var verdictText: String {
        switch checker {
        case .don: isPositive ? "шериф" : "не шериф"
        default: isPositive ? "чёрный" : "красный"
        }
    }
}

// MARK: - Хронология: вид

/// Хронология игры: фазы карточками, внутри — лента событий. У каждого события цветной значок на линии
/// и короткая фраза с номерами; подробности (кто за кого голосовал, кто куда стрелял) — под ней.
/// Когда роли открыты, номера окрашены в цвет команды.
struct GameTimelineView: View {
    let events: [GameEvent]
    let seats: [SeatState]
    /// Во время игры экран могут увидеть за столом: без открытых ролей номера серые и нет «кто куда стрелял».
    var revealsRoles = true
    let name: (Seat) -> String

    var body: some View {
        let phases = GameTimeline.phases(from: events, revealsRoles: revealsRoles)
        let context = TimelineContext(seats: seats, revealsRoles: revealsRoles, name: name)
        LazyVStack(alignment: .leading, spacing: 14) {
            if phases.isEmpty {
                ContentUnavailableView(
                    "Пока пусто", systemImage: "clock.arrow.circlepath",
                    description: Text("Здесь появятся выставления, голосования, ночные ходы и нарушения.")
                )
            } else if revealsRoles {
                TeamLegend()
            }
            ForEach(phases) { phase in
                TimelinePhaseCard(phase: phase, context: context)
            }
        }
    }
}

/// Хронология отдельным листом — с экрана игры и из итогов.
struct GameTimelineSheet: View {
    let events: [GameEvent]
    let seats: [SeatState]
    var revealsRoles = true
    let name: (Seat) -> String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                GameTimelineView(events: events, seats: seats, revealsRoles: revealsRoles, name: name)
                    .padding(.horizontal)
                    .padding(.bottom, 24)
            }
            .readableColumn()
            .ambientBackground()
            .navigationTitle("Хронология")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово", systemImage: "checkmark") { dismiss() }
                }
            }
        }
    }
}

/// Кто есть кто: роли мест и имена — для номеров в ленте.
private struct TimelineContext {
    let seats: [SeatState]
    let revealsRoles: Bool
    let name: (Seat) -> String

    func tint(of seat: Seat) -> Color {
        guard revealsRoles, let team = seats.first(where: { $0.seat == seat })?.team else { return Color(.systemGray) }
        return team.tint
    }

    func isBlack(_ seat: Seat) -> Bool {
        seats.first { $0.seat == seat }?.team == .black
    }
}

/// Что значат цвета номеров.
private struct TeamLegend: View {
    var body: some View {
        HStack(spacing: 14) {
            ForEach([Team.red, .black], id: \.self) { team in
                HStack(spacing: 6) {
                    Circle().fill(team.tint).frame(width: 10, height: 10)
                    Text(team == .red ? "Мирные" : "Мафия").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 4)
    }
}

/// Фаза — карточка с лентой событий: значки на вертикальной линии, как в «Активности».
private struct TimelinePhaseCard: View {
    let phase: TimelinePhase
    let context: TimelineContext

    private var style: (icon: String, tint: Color) {
        switch phase.moment {
        case .nightZero: ("moon.zzz.fill", .indigo)
        case .day: ("sun.max.fill", .orange)
        case .night: ("moon.stars.fill", .indigo)
        case .afterGame: ("flag.checkered", .accentColor)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label(phase.moment.displayName, systemImage: style.icon)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(style.tint)
                Spacer()
                Text(phase.startedAt.formatted(date: .omitted, time: .shortened))
                    .font(.caption)
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
            VStack(alignment: .leading, spacing: 18) {
                ForEach(phase.items) { item in
                    TimelineRow(entry: item.entry, context: context)
                }
            }
            // Линия ленты за значками.
            .background(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.1))
                    .frame(width: 2)
                    .padding(.leading, Rail.iconSize / 2 - 1)
                    .padding(.vertical, Rail.iconSize / 2)
            }
        }
        .contentCard()
    }
}

// MARK: - События

private struct TimelineRow: View {
    let entry: TimelineEntry
    let context: TimelineContext

    var body: some View {
        switch entry {
        case let .nominations(marks):
            RailRow(icon: "hand.point.up.left.fill", tint: .accentColor, title: "Выставления") {
                FlowRow(spacing: 6) {
                    ForEach(marks, id: \.self) { mark in
                        Pill(isDimmed: mark.isWithdrawn) {
                            SeatChip(seat: mark.by, context: context)
                            Arrow()
                            SeatChip(seat: mark.candidate, context: context)
                            if mark.isWithdrawn { Text("снял").font(.caption2.weight(.semibold)).foregroundStyle(.secondary) }
                        }
                    }
                }
            }
        case let .voting(round):
            VotingRow(round: round, context: context)
        case let .verdict(record):
            if let skip = record.skipReason {
                RailRow(icon: "xmark", tint: .gray, title: skip.displayName)
            } else if record.eliminated.isEmpty {
                RailRow(icon: "equal", tint: .gray, title: "Никто не выбывает")
            } else {
                RailRow(icon: "person.fill.xmark", tint: .orange, title: record.isAutomatic ? "Без голосования выбывает" : "Выбывает") {
                    Seats(record.eliminated, context: context)
                }
            }
        case let .shot(killer, target, misses):
            ShotRow(killer: killer, target: target, misses: misses, context: context)
        case let .check(check):
            CheckRow(check: check, context: context)
        case let .heal(seat):
            RailRow(icon: "cross.case.fill", tint: .green, title: "Доктор лечит") {
                SeatChip(seat: seat, context: context, showsName: true)
            }
        case let .morning(report):
            if report.victims.isEmpty {
                RailRow(icon: "sunrise.fill", tint: .orange, title: "Утро: ночь без жертв")
            } else {
                RailRow(icon: "sunrise.fill", tint: .orange, title: report.victims.count > 1 ? "Утро: убиты" : "Утро: убит") {
                    Seats(report.victims.map(\.seat), context: context)
                }
            }
        case let .removal(seat, cause):
            RailRow(icon: "person.fill.xmark", tint: .red, title: cause.label) {
                SeatChip(seat: seat, context: context, showsName: true)
            }
        case let .bestMove(move):
            BestMoveRow(move: move, context: context)
        case let .colorProtocol(proto):
            ProtocolRow(proto: proto, context: context)
        case let .discipline(marks):
            RailRow(icon: "hand.raised.fill", tint: .orange, title: "Нарушения") {
                FlowRow(spacing: 6) {
                    ForEach(Array(marks.enumerated()), id: \.offset) { _, mark in
                        Pill {
                            SeatChip(seat: mark.seat, context: context)
                            Text(mark.text).font(.caption.weight(.semibold)).foregroundStyle(mark.tint)
                        }
                    }
                }
            }
        case let .finished(outcome):
            RailRow(icon: "trophy.fill", tint: outcome.winner.dot, title: outcome.winner.displayName) {
                Text(outcome.reason.text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

/// Размеры ленты.
private enum Rail {
    /// Значок события; линия ленты проходит через его центр.
    static let iconSize: CGFloat = 30
}

/// Событие на ленте: цветной значок на линии, заголовок и подробности под ним.
private struct RailRow<Detail: View>: View {

    let icon: String
    let tint: Color
    let title: String
    var trailing: String?
    var trailingTint: Color = .secondary
    @ViewBuilder let detail: Detail

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: Rail.iconSize, height: Rail.iconSize)
                .background(tint.gradient, in: .circle)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(title).font(.subheadline.weight(.semibold))
                    Spacer(minLength: 4)
                    if let trailing {
                        Text(trailing)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(trailingTint, in: .capsule)
                    }
                }
                .frame(minHeight: Rail.iconSize)
                detail
            }
        }
    }
}

private extension RailRow where Detail == EmptyView {
    init(icon: String, tint: Color, title: String, trailing: String? = nil, trailingTint: Color = .secondary) {
        self.init(icon: icon, tint: tint, title: title, trailing: trailing, trailingTint: trailingTint) { EmptyView() }
    }
}

/// Номер места в круге: цвет команды, когда роли открыты, иначе серый. С именем — по желанию.
private struct SeatChip: View {
    let seat: Seat
    let context: TimelineContext
    var showsName = false

    var body: some View {
        HStack(spacing: 6) {
            Text("\(seat.number)")
                .font(.system(.caption, design: .rounded).weight(.heavy))
                .monospacedDigit()
                .foregroundStyle(.white)
                .frame(minWidth: 24, minHeight: 24)
                .background(context.tint(of: seat), in: .circle)
            if showsName {
                Text(context.name(seat)).font(.subheadline.weight(.medium)).lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Несколько игроков с именами в строку.
private struct Seats: View {
    let seats: [Seat]
    let context: TimelineContext

    init(_ seats: [Seat], context: TimelineContext) {
        self.seats = seats
        self.context = context
    }

    var body: some View {
        FlowRow(spacing: 10) {
            ForEach(seats, id: \.self) { SeatChip(seat: $0, context: context, showsName: true) }
        }
    }
}

/// Капсула с номерами: «3 → 5», «2 фол 1-й».
private struct Pill<Content: View>: View {
    var isDimmed = false
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 4) { content }
            .padding(3)
            .padding(.trailing, 4)
            .background(Color.primary.opacity(0.06), in: .capsule)
            .opacity(isDimmed ? 0.45 : 1)
    }
}

private struct Arrow: View {
    var body: some View {
        Image(systemName: "arrow.right").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
    }
}

/// Голосование: у каждого кандидата шкала голосов и — если считали поимённо — кто именно голосовал.
private struct VotingRow: View {
    let round: VotingRound
    let context: TimelineContext

    private var title: String {
        switch round.kind {
        case .main: "Голосование"
        case .revote: "Переголосование"
        case .lift: "Поднять всех"
        }
    }

    var body: some View {
        RailRow(icon: round.kind == .lift ? "hand.raised.fill" : "checklist", tint: .accentColor, title: title) {
            if let lift = round.liftVotes {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        ForEach(round.candidates, id: \.self) { SeatChip(seat: $0, context: context) }
                        Text("за подъём — \(pluralized(lift, "голос", "голоса", "голосов"))").font(.subheadline.weight(.semibold))
                    }
                    if let voters = round.liftVoters, !voters.isEmpty {
                        Voters(voters: voters, autoAssigned: [], context: context)
                    }
                }
            } else {
                let maxVotes = max(round.results.map(\.votes).max() ?? 0, 1)
                let leaders = Set(round.leaders)
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(round.results, id: \.candidate) { result in
                        let isLeader = leaders.contains(result.candidate)
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(spacing: 8) {
                                SeatChip(seat: result.candidate, context: context, showsName: true)
                                Spacer(minLength: 6)
                                Text("\(result.votes)")
                                    .font(.headline)
                                    .monospacedDigit()
                                    .foregroundStyle(isLeader ? Color.orange : Color.primary)
                            }
                            GeometryReader { proxy in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Color.primary.opacity(0.07))
                                    Capsule()
                                        .fill(isLeader ? AnyShapeStyle(Color.orange.gradient) : AnyShapeStyle(Color.accentColor.opacity(0.55)))
                                        .frame(width: result.votes == 0 ? 0 : max(8, proxy.size.width * CGFloat(result.votes) / CGFloat(maxVotes)))
                                }
                            }
                            .frame(height: 6)
                            if let voters = result.voters, !voters.isEmpty {
                                Voters(voters: voters, autoAssigned: Set(round.autoAssignedVoters), context: context)
                            }
                        }
                    }
                    if !round.autoAssignedVoters.isEmpty {
                        Text("Бледные номера не голосовали — их голоса ушли последней кандидатуре.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

private struct Voters: View {
    let voters: [Seat]
    let autoAssigned: Set<Seat>
    let context: TimelineContext

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Text("голосовали").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 5)
            FlowRow(spacing: 4) {
                ForEach(voters, id: \.self) { voter in
                    SeatChip(seat: voter, context: context)
                        .opacity(autoAssigned.contains(voter) ? 0.4 : 1)
                }
            }
        }
    }
}

/// Выстрел: в кого. Промах — кто куда стрелял, не отмеченный — не стрелял.
private struct ShotRow: View {
    let killer: Killer
    let target: Seat?
    let misses: [MissedShot]
    let context: TimelineContext

    private var shooter: String { killer == .mafia ? "Мафия" : "Маньяк" }

    var body: some View {
        if let target {
            RailRow(icon: "scope", tint: .red, title: "\(shooter) стреляет") {
                SeatChip(seat: target, context: context, showsName: true)
            }
        } else {
            RailRow(icon: "scope", tint: .gray, title: "\(shooter): промах") {
                if !misses.isEmpty {
                    FlowRow(spacing: 6) {
                        ForEach(misses, id: \.self) { shot in
                            Pill {
                                SeatChip(seat: shot.shooter, context: context)
                                if let aim = shot.target {
                                    Arrow()
                                    SeatChip(seat: aim, context: context)
                                } else {
                                    Text("не стрелял").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Проверка дона или шерифа: кто, кого и что увидел.
private struct CheckRow: View {
    let check: NightCheck
    let context: TimelineContext

    private var verdictTint: Color {
        switch check.checker {
        case .don: check.isPositive ? .orange : .gray
        default: check.isPositive ? Team.black.tint : Team.red.tint
        }
    }

    var body: some View {
        RailRow(
            icon: check.checker == .don ? "magnifyingglass" : "star.fill", tint: check.checker == .don ? Team.black.tint : .yellow,
            title: check.checker == .don ? "Проверка дона" : "Проверка шерифа",
            trailing: check.verdictText, trailingTint: verdictTint
        ) {
            HStack(spacing: 6) {
                SeatChip(seat: check.by, context: context)
                Arrow()
                SeatChip(seat: check.target, context: context, showsName: true)
            }
        }
    }
}

/// Лучший ход: кого назвал и сколько угадал (когда роли открыты).
private struct BestMoveRow: View {
    let move: BestMove
    let context: TimelineContext

    var body: some View {
        let guessed = move.seats.filter(context.isBlack).count
        RailRow(
            icon: "star.fill", tint: .orange, title: "Лучший ход",
            trailing: context.revealsRoles ? "угадано \(guessed) из \(move.seats.count)" : nil,
            trailingTint: guessed > 0 ? .orange : .gray
        ) {
            HStack(spacing: 6) {
                SeatChip(seat: move.author, context: context, showsName: true)
                Arrow()
                ForEach(move.seats, id: \.self) { SeatChip(seat: $0, context: context) }
            }
        }
    }
}

/// Протокол: чёрные, красные и версия на шерифа.
private struct ProtocolRow: View {
    let proto: ColorProtocol
    let context: TimelineContext

    var body: some View {
        RailRow(icon: "list.clipboard.fill", tint: .accentColor, title: "Протокол") {
            VStack(alignment: .leading, spacing: 8) {
                SeatChip(seat: proto.author, context: context, showsName: true)
                if !proto.blacks.isEmpty { marked("чёрные", proto.blacks) }
                if !proto.reds.isEmpty { marked("красные", proto.reds) }
                if let version = proto.version {
                    HStack(spacing: 6) {
                        Text("шериф").font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: 64, alignment: .leading)
                        SeatChip(seat: version.sheriff, context: context)
                        Text("±\(version.value.description)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func marked(_ title: String, _ seats: [Seat]) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary).frame(width: 64, alignment: .leading).padding(.top, 5)
            FlowRow(spacing: 4) {
                ForEach(seats, id: \.self) { SeatChip(seat: $0, context: context) }
            }
        }
    }
}
