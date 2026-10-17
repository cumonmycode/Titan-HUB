import Observation
import SwiftUI
import MafBoardCore

// MARK: - Черновик

/// Место за столом в черновике: игрок или пусто. Свой id — чтобы места можно было перетаскивать.
struct SeatSlot: Identifiable, Equatable {
    let id = UUID()
    var player: PlayerProfile?
}

/// Черновик новой игры, общий для всех шагов мастера.
@Observable @MainActor
final class NewGameDraft {
    var variant: GameVariant = .sport
    var format: CompetitionFormat = .funky
    /// Вечер, который продолжаем. `nil` — начнём новый.
    var evening: Evening?
    var cityCount = 12
    var slots: [SeatSlot] = (0..<10).map { _ in SeatSlot() }
    /// Роли по местам после раздачи.
    var roles: [Role] = []

    /// «Простой режим» спортивной мафии: в голосовании вводится число голосов, а не кто голосовал.
    /// Запоминается на телефоне для всех следующих игр.
    static let simpleVotingKey = "sportSimpleVoting"

    var playerCount: Int { variant == .sport ? 10 : cityCount }
    var ruleset: Ruleset {
        var rules = variant.defaultRuleset
        if variant == .sport {
            rules.voting.ballotStyle = UserDefaults.standard.bool(forKey: Self.simpleVotingKey) ? .handCount : .perVoter
        }
        return rules
    }
    var taken: Set<PlayerID> { Set(slots.compactMap { $0.player?.id }) }
    var filled: Int { slots.filter { $0.player != nil }.count }
    var freeSeats: Int { playerCount - filled }

    func choose(variant: GameVariant) {
        self.variant = variant
        resize()
    }

    func resize() {
        let count = playerCount
        if slots.count > count {
            slots = Array(slots.prefix(count))
        } else {
            slots += (slots.count..<count).map { _ in SeatSlot() }
        }
        roles = []
    }

    /// Состав прошлой игры вечера — по тем же местам.
    func seat(_ players: [PlayerProfile]) {
        slots = (0..<playerCount).map { index in SeatSlot(player: players.indices.contains(index) ? players[index] : nil) }
        roles = []
    }

    /// Игрок на первое свободное место (или на указанное).
    @discardableResult
    func add(_ player: PlayerProfile, to slotID: SeatSlot.ID? = nil) -> Bool {
        guard !taken.contains(player.id) else { return false }
        let index = slotID.flatMap { id in slots.firstIndex { $0.id == id } } ?? slots.firstIndex { $0.player == nil }
        guard let index else { return false }
        slots[index].player = player
        roles = []
        return true
    }

    func remove(_ playerID: PlayerID) {
        guard let index = slots.firstIndex(where: { $0.player?.id == playerID }) else { return }
        slots[index].player = nil
        roles = []
    }

    /// Игроки двух мест меняются местами (перетаскивание в рассадке).
    func swapSeats(_ first: SeatSlot.ID, _ second: SeatSlot.ID) {
        guard first != second,
              let lhs = slots.firstIndex(where: { $0.id == first }),
              let rhs = slots.firstIndex(where: { $0.id == second })
        else { return }
        let player = slots[lhs].player
        slots[lhs].player = slots[rhs].player
        slots[rhs].player = player
        roles = []
    }

    func shuffleSeats() {
        var players = slots.map(\.player)
        players.shuffle()
        slots = players.map { SeatSlot(player: $0) }
        roles = []
    }

    func dealRoles() throws(GameError) {
        roles = try ruleset.standardRoles(playerCount: playerCount).shuffled()
    }

    /// Игроки в порядке мест; пустые места — гости «Игрок N».
    var seatedPlayers: [PlayerProfile] {
        slots.enumerated().map { index, slot in slot.player ?? PlayerProfile(nickname: "Игрок \(index + 1)") }
    }
}

// MARK: - Мастер

/// «Новая игра»: игра → режим → игроки → роли → старт.
struct NewGameFlow: View {
    /// «Следующая игра» вечера: сразу к игрокам, тем же составом.
    let evening: Evening?
    @State private var draft = NewGameDraft()
    @State private var path: [Step] = []
    @Environment(\.dismiss) private var dismiss
    @Environment(GameLibrary.self) private var library

    enum Step: Hashable {
        case format
        case players
        case roles
    }

    var body: some View {
        NavigationStack(path: $path) {
            GameTypeStep { path.append(.format) }
                .navigationDestination(for: Step.self) { step in
                    switch step {
                    case .format: FormatStep { path.append(.players) }
                    case .players: PlayersStep { path.append(.roles) }
                    // Закрывает весь лист (а не только шаг) — тогда игра открывается.
                    case .roles: RolesStep { dismiss() }
                    }
                }
        }
        .environment(draft)
        .onAppear {
            // Вечер — свежий из библиотеки: в нём уже состав только что сыгранной игры.
            guard let evening = evening.map({ old in library.evenings.first { $0.id == old.id } ?? old }), path.isEmpty else { return }
            draft.choose(variant: evening.variant)
            draft.format = evening.format
            draft.evening = evening
            draft.seat(library.lastLineup(of: evening))
            path = [.format, .players]
        }
    }
}

// MARK: - Шаг 1: игра

private struct GameTypeStep: View {
    let onNext: () -> Void
    @Environment(NewGameDraft.self) private var draft
    @Environment(\.dismiss) private var dismiss
    @AppStorage(NewGameDraft.simpleVotingKey) private var isSimpleVoting = false

    var body: some View {
        List {
            ForEach(GameVariant.allCases, id: \.self) { variant in
                Section {
                    Button {
                        draft.choose(variant: variant)
                        onNext()
                    } label: {
                        VariantCard(variant: variant)
                    }
                    .foregroundStyle(.primary)
                    if variant == .sport {
                        Toggle(isOn: $isSimpleVoting) {
                            Text("Простой режим")
                            Text("В голосовании — только число голосов за кандидата, без отметки, кто голосовал")
                        }
                    }
                }
            }
        }
        .ambientBackground()
        .listSectionSpacing(14)
        .navigationTitle("Какая игра?")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Отмена", systemImage: "xmark") { dismiss() }
            }
        }
    }
}

private struct VariantCard: View {
    let variant: GameVariant

    private var icon: String { variant == .sport ? "person.3.sequence.fill" : "building.2.fill" }
    private var facts: [String] {
        switch variant {
        case .sport: ["10 игроков", "Правила ФСМ: выставления, деление и подъём", "Дон, две мафии, шериф"]
        case .city: ["8–20 игроков", "Голосование за всех живых", "Доктор, маньяк и другие роли"]
        }
    }

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon)
                .font(.title)
                .foregroundStyle(.tint)
                .frame(width: 48)
            VStack(alignment: .leading, spacing: 6) {
                Text(variant.displayName).font(.title3.weight(.semibold))
                ForEach(facts, id: \.self) { fact in
                    Text(fact).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 10)
    }
}

// MARK: - Шаг 2: режим

private struct FormatStep: View {
    let onNext: () -> Void
    @Environment(NewGameDraft.self) private var draft
    @Environment(AppModel.self) private var model
    @Environment(GameLibrary.self) private var library
    @State private var openEvening: Evening?

    private var access: HostingAccess? { model.account?.hostingAccess }

    var body: some View {
        List {
            Section {
                ForEach(CompetitionFormat.allCases, id: \.self) { format in
                    let allowed = format == .funky || access?.allows(format) == true
                    Button {
                        choose(format)
                    } label: {
                        FormatCard(format: format, isAllowed: allowed)
                    }
                    .foregroundStyle(.primary)
                    .disabled(!allowed)
                }
            } footer: {
                if access?.allows(.rating) != true {
                    Text("Рейтинг, миникап и турнир доступны ведущему клуба GoMafia. Подключите GoMafia в профиле.")
                }
            }
        }
        .ambientBackground()
        .navigationTitle("Режим")
        .confirmationDialog(
            "Продолжить серию?",
            isPresented: Binding(get: { openEvening != nil }, set: { if !$0 { openEvening = nil } }),
            titleVisibility: .visible,
            presenting: openEvening
        ) { evening in
            Button("Продолжить «\(evening.title)»") {
                draft.evening = evening
                if draft.filled == 0 { draft.seat(library.lastLineup(of: evening)) }
                onNext()
            }
            Button("Начать новую серию") {
                draft.evening = nil
                onNext()
            }
        } message: { evening in
            Text("Уже сыграно: \(gamesPlayed(library.games(of: evening).count)). Игры одной серии складываются в общие итоги.")
        }
    }

    private func choose(_ format: CompetitionFormat) {
        draft.format = format
        if let evening = library.openEvening(format: format, variant: draft.variant) {
            openEvening = evening
        } else {
            draft.evening = nil
            onNext()
        }
    }
}

private struct FormatCard: View {
    let format: CompetitionFormat
    let isAllowed: Bool

    private var icon: String {
        switch format {
        case .funky: "face.smiling"
        case .rating: "chart.bar.fill"
        case .miniCup: "trophy.fill"
        case .tournament: "flag.checkered"
        }
    }

    private var summary: String {
        switch format {
        case .funky: "Результат только за игру. В рейтинг не идёт, но остаётся в истории."
        case .rating: "Рейтинг клуба: баллы игроков суммируются за серию и за любой период."
        case .miniCup: "Как рейтинг, но своя отдельная таблица."
        case .tournament: "Отдельное мероприятие со своей таблицей."
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(isAllowed ? format.tint : .secondary)
                .frame(width: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(format.displayName).font(.headline)
                Text(summary).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: isAllowed ? "chevron.right" : "lock.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .opacity(isAllowed ? 1 : 0.55)
    }
}
