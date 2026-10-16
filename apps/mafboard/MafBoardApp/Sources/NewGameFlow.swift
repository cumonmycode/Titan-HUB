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

    var playerCount: Int { variant == .sport ? 10 : cityCount }
    var ruleset: Ruleset { variant.defaultRuleset }
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
            guard let evening, path.isEmpty else { return }
            draft.choose(variant: evening.variant)
            draft.format = evening.format
            draft.evening = evening
            draft.seat(evening.lastPlayers)
            path = [.format, .players]
        }
    }
}

// MARK: - Шаг 1: игра

private struct GameTypeStep: View {
    let onNext: () -> Void
    @Environment(NewGameDraft.self) private var draft
    @Environment(\.dismiss) private var dismiss

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
                }
            }
        }
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
        case .sport: ["10 игроков", "Выставления, попил и «поднять всех»", "Дон, две мафии, шериф"]
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
        .navigationTitle("Режим")
        .confirmationDialog(
            "Продолжить вечер?",
            isPresented: Binding(get: { openEvening != nil }, set: { if !$0 { openEvening = nil } }),
            titleVisibility: .visible,
            presenting: openEvening
        ) { evening in
            Button("Продолжить «\(evening.title)»") {
                draft.evening = evening
                if draft.filled == 0 { draft.seat(evening.lastPlayers) }
                onNext()
            }
            Button("Начать новый вечер") {
                draft.evening = nil
                onNext()
            }
        } message: { evening in
            Text("Уже сыграно: \(gamesPlayed(library.games(of: evening).count)). Игры одного вечера складываются в общие итоги.")
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
        case .rating: "Рейтинг клуба: баллы игроков суммируются за вечер и за любой период."
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

// MARK: - Шаг 3: игроки

/// Подсказка при вводе на место: игрок клуба, игрок GoMafia или гость под введённым именем.
private enum Suggestion: Identifiable {
    case club(GoMafiaPlayer)
    case goMafia(GoMafiaPlayer)
    case guest(String)

    var id: String {
        switch self {
        case let .club(player): "club-\(player.id)"
        case let .goMafia(player): "gm-\(player.id)"
        case let .guest(name): "guest-\(name)"
        }
    }

    var profile: PlayerProfile {
        switch self {
        case let .club(player), let .goMafia(player): PlayerProfile(goMafia: player)
        case let .guest(name): PlayerProfile(nickname: name)
        }
    }
}

/// Рассадка: нажатие на место открывает ввод прямо в строке — клавиатура, поиск по клубу,
/// затем по GoMafia, последним — гость под введённым именем.
private struct PlayersStep: View {
    let onNext: () -> Void
    @Environment(NewGameDraft.self) private var draft
    @Environment(GameLibrary.self) private var library
    @Environment(AppModel.self) private var model
    @State private var editingSlot: SeatSlot.ID?
    @State private var query = ""
    @State private var roster: [GoMafiaPlayer] = []
    @State private var found: [GoMafiaPlayer] = []
    @State private var isSearching = false
    @State private var errorMessage: String?
    @FocusState private var isFieldFocused: Bool

    private static let clubLimit = 5
    private static let goMafiaLimit = 6

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        @Bindable var draft = draft
        ScrollViewReader { proxy in
            List {
                Section {
                    LabeledContent("Игра", value: draft.variant.displayName)
                    LabeledContent("Режим") { FormatTag(format: draft.format) }
                    if let evening = draft.evening {
                        LabeledContent("Вечер", value: "\(evening.title) · игра \(library.games(of: evening).count + 1)")
                    }
                    if draft.variant == .city {
                        Stepper("Игроков: \(draft.cityCount)", value: $draft.cityCount, in: Ruleset.city.allowedPlayerCounts)
                            .onChange(of: draft.cityCount) { draft.resize() }
                    }
                }

                Section {
                    ForEach(Array(draft.slots.enumerated()), id: \.element.id) { index, slot in
                        if slot.id == editingSlot {
                            editingRow(index: index, slot: slot)
                        } else {
                            Button {
                                beginEditing(slot.id)
                            } label: {
                                SlotRow(number: index + 1, player: slot.player)
                            }
                            .foregroundStyle(.primary)
                            .swipeActions {
                                if let player = slot.player {
                                    Button("Убрать", systemImage: "person.badge.minus", role: .destructive) { draft.remove(player.id) }
                                }
                            }
                        }
                    }
                    .onMove { draft.slots.move(fromOffsets: $0, toOffset: $1) }
                } header: {
                    HStack {
                        Text("Рассадка")
                        Spacer()
                        Text("\(draft.filled) из \(draft.playerCount)")
                    }
                } footer: {
                    Text("Нажмите на место и начните вводить ник: сначала ваш клуб, затем GoMafia, последним — гость под этим именем.")
                }

                Section {
                    if let last = draft.evening?.lastPlayers, !last.isEmpty {
                        Button("Состав прошлой игры", systemImage: "arrow.uturn.backward.circle") { draft.seat(last) }
                    }
                    Button("Перемешать места", systemImage: "shuffle") { draft.shuffleSeats() }
                        .disabled(draft.filled < 2)
                    Button("Очистить", systemImage: "trash", role: .destructive) { draft.seat([]) }
                        .disabled(draft.filled == 0)
                }
            }
            .onChange(of: editingSlot) { _, slot in
                guard let slot else { return }
                withAnimation { proxy.scrollTo(slot, anchor: .top) }
            }
        }
        .navigationTitle("Игроки")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { EditButton() }
        }
        .safeAreaInset(edge: .bottom) {
            if editingSlot == nil {
                Button {
                    proceed()
                } label: {
                    Text(draft.freeSeats == 0 ? "Далее: роли" : "Далее: роли (гостей: \(draft.freeSeats))")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .padding(.horizontal)
            }
        }
        .task { await loadRoster() }
        .task(id: trimmed) { await searchGoMafia() }
        .alert("Нельзя продолжить", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: Ввод на месте

    private func editingRow(index: Int, slot: SeatSlot) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text("\(index + 1)")
                    .font(.headline)
                    .monospacedDigit()
                    .foregroundStyle(.tint)
                    .frame(width: 26, alignment: .trailing)
                TextField(slot.player?.nickname ?? "Ник или имя гостя", text: $query)
                    .focused($isFieldFocused)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.next)
                    .onSubmit { if let first = suggestions.first { pick(first) } }
                    .onAppear { isFieldFocused = true }
                if isSearching {
                    ProgressView()
                }
                Button("Готово") { endEditing() }
                    .buttonStyle(.borderless)
                    .fontWeight(.semibold)
            }
            .padding(.vertical, 4)
            ForEach(suggestions) { suggestion in
                Divider().padding(.leading, 38)
                Button {
                    pick(suggestion)
                } label: {
                    SuggestionRow(suggestion: suggestion, isGuestAllowed: !draft.format.countsTowardStandings)
                }
                .buttonStyle(.borderless)
                .foregroundStyle(.primary)
            }
        }
    }

    /// Сначала свой клуб, затем GoMafia, последним — гость под введённым именем.
    private var suggestions: [Suggestion] {
        guard !trimmed.isEmpty else { return [] }
        let taken = draft.taken
        let needle = trimmed.lowercased()
        let club = roster
            .filter { $0.nickname.lowercased().contains(needle) && !taken.contains(PlayerID.goMafia($0.id)) }
            .sorted { lhs, rhs in
                let lhsPrefix = lhs.nickname.lowercased().hasPrefix(needle)
                let rhsPrefix = rhs.nickname.lowercased().hasPrefix(needle)
                if lhsPrefix != rhsPrefix { return lhsPrefix }
                return (lhs.elo ?? 0) > (rhs.elo ?? 0)
            }
            .prefix(Self.clubLimit)
        let clubIDs = Set(roster.map(\.id))
        let others = found
            .filter { !clubIDs.contains($0.id) && !taken.contains(PlayerID.goMafia($0.id)) }
            .prefix(Self.goMafiaLimit)
        return club.map(Suggestion.club) + others.map(Suggestion.goMafia) + [.guest(trimmed)]
    }

    private func beginEditing(_ slotID: SeatSlot.ID) {
        query = ""
        editingSlot = slotID
    }

    private func endEditing() {
        editingSlot = nil
        query = ""
        isFieldFocused = false
    }

    /// Сажаем игрока и сразу переходим к следующему свободному месту.
    private func pick(_ suggestion: Suggestion) {
        guard let slotID = editingSlot,
              let index = draft.slots.firstIndex(where: { $0.id == slotID }),
              draft.add(suggestion.profile, to: slotID)
        else { return }
        query = ""
        let following = draft.slots[(index + 1)...] + draft.slots[..<index]
        if let next = following.first(where: { $0.player == nil }) {
            editingSlot = next.id
        } else {
            endEditing()
        }
    }

    private func proceed() {
        if draft.format.countsTowardStandings {
            let guests = draft.slots.enumerated().filter { $0.element.player?.goMafiaID == nil }.map { "№\($0.offset + 1)" }
            guard guests.isEmpty else {
                errorMessage = "В режиме «\(draft.format.displayName)» все игроки должны быть из GoMafia. Заполните места: \(guests.joined(separator: ", "))."
                return
            }
        }
        onNext()
    }

    // MARK: Загрузка

    private func loadRoster() async {
        guard roster.isEmpty, let clubID = model.account?.goMafia?.club?.id else { return }
        roster = await model.clubRoster(clubID: clubID) ?? []
    }

    private func searchGoMafia() async {
        guard trimmed.count >= 2 else {
            found = []
            return
        }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        isSearching = true
        defer { isSearching = false }
        guard let players = await model.searchPlayers(trimmed), !Task.isCancelled else { return }
        found = players
    }
}

private struct SuggestionRow: View {
    let suggestion: Suggestion
    let isGuestAllowed: Bool

    var body: some View {
        HStack(spacing: 12) {
            switch suggestion {
            case let .club(player), let .goMafia(player):
                PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(player.nickname).lineLimit(1)
                    Text([player.clubTitle, player.elo.map { "ELO \(Int($0))" }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                if case .club = suggestion {
                    Label("Клуб", systemImage: "star.fill").font(.caption).foregroundStyle(.yellow)
                } else {
                    Text("GoMafia").font(.caption).foregroundStyle(.secondary)
                }
            case let .guest(name):
                Image(systemName: "person.crop.circle.badge.questionmark")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Гостевой игрок «\(name)»").lineLimit(1)
                    Text(isGuestAllowed ? "Без аккаунта GoMafia — играет под этим именем" : "Только для фанки")
                        .font(.caption)
                        .foregroundStyle(isGuestAllowed ? AnyShapeStyle(.secondary) : AnyShapeStyle(.orange))
                }
                Spacer()
            }
        }
        .padding(.vertical, 8)
        .padding(.leading, 38)
        .contentShape(.rect)
    }
}

private struct SlotRow: View {
    let number: Int
    let player: PlayerProfile?

    var body: some View {
        HStack(spacing: 12) {
            Text("\(number)")
                .font(.headline)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 26, alignment: .trailing)
            if let player {
                PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 34)
                Text(player.nickname).lineLimit(1)
                Spacer()
                if player.goMafiaID == nil {
                    Text("гость").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Image(systemName: "plus.circle")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .frame(width: 34)
                Text("Свободно").foregroundStyle(.secondary)
                Spacer()
            }
        }
    }
}

// MARK: - Шаг 4: роли

private struct RolesStep: View {
    @Environment(NewGameDraft.self) private var draft
    @Environment(AppModel.self) private var model
    @Environment(GameLibrary.self) private var library
    /// Игра создана — закрыть мастер целиком.
    let onStarted: () -> Void
    @State private var isRevealed = false
    @State private var errorMessage: String?

    private var composition: String {
        let counts = Dictionary(grouping: draft.roles, by: { $0 }).mapValues(\.count)
        return counts
            .sorted { ($0.key.team == .black ? 0 : 1, $0.key.isUnique ? 0 : 1) < ($1.key.team == .black ? 0 : 1, $1.key.isUnique ? 0 : 1) }
            .map { $0.value > 1 ? "\($0.key.displayName) × \($0.value)" : $0.key.displayName }
            .joined(separator: ", ")
    }

    var body: some View {
        List {
            Section("Состав ролей") {
                Text(composition).foregroundStyle(.secondary)
            }
            Section {
                Toggle("Показать роли", isOn: $isRevealed)
                ForEach(Array(draft.seatedPlayers.enumerated()), id: \.offset) { index, player in
                    HStack(spacing: 12) {
                        Text("\(index + 1)")
                            .font(.headline)
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                            .frame(width: 26, alignment: .trailing)
                        PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 34)
                        Text(player.nickname).lineLimit(1)
                        Spacer()
                        if draft.roles.indices.contains(index) {
                            let role = draft.roles[index]
                            Text(isRevealed ? role.displayName : "•••")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(isRevealed ? AnyShapeStyle(role.team.tint) : AnyShapeStyle(.tertiary))
                        }
                    }
                }
            } header: {
                Text("Роли по местам")
            } footer: {
                Text("Роли розданы случайно. Покажите их игрокам по очереди или раздайте карты в том же порядке.")
            }
            Section {
                Button("Перераздать роли", systemImage: "shuffle") { deal() }
            }
        }
        .navigationTitle("Роли")
        .safeAreaInset(edge: .bottom) {
            Button(action: start) {
                Label("Начать игру", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .padding(.horizontal)
        }
        .onAppear { if draft.roles.count != draft.playerCount { deal() } }
        .alert("Не удалось начать", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func deal() {
        do throws(GameError) {
            try draft.dealRoles()
        } catch {
            errorMessage = error.message
        }
    }

    private func start() {
        let players = draft.seatedPlayers
        let eveningID = draft.evening?.id ?? SeriesID()
        do throws(GameError) {
            let setup: GameSetup
            if let account = model.account {
                setup = try GameSetup.hosted(
                    by: account, format: draft.format, ruleset: draft.ruleset,
                    players: players, roles: draft.roles, seriesID: eveningID
                )
            } else {
                setup = try GameSetup(format: .funky, ruleset: draft.ruleset, players: players.map(\.id), roles: draft.roles, seriesID: eveningID)
            }
            if draft.evening == nil {
                library.startEvening(id: eveningID, format: draft.format, variant: draft.variant)
            }
            library.start(setup: setup, players: players)
            onStarted()
        } catch {
            errorMessage = error.message
        }
    }
}
