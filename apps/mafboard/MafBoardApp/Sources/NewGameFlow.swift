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
                    case .roles: RolesStep()
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

private struct PlayersStep: View {
    let onNext: () -> Void
    @Environment(NewGameDraft.self) private var draft
    @Environment(GameLibrary.self) private var library
    @State private var adding: AddTarget?
    @State private var errorMessage: String?

    /// Лист добавления: на свободные места или на конкретное место.
    struct AddTarget: Identifiable {
        let id = UUID()
        var slotID: SeatSlot.ID?
    }

    var body: some View {
        @Bindable var draft = draft
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
                    Button {
                        adding = AddTarget(slotID: slot.id)
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
                .onMove { draft.slots.move(fromOffsets: $0, toOffset: $1) }
            } header: {
                HStack {
                    Text("Рассадка")
                    Spacer()
                    Text("\(draft.filled) из \(draft.playerCount)")
                }
            } footer: {
                Text("Нажмите на место, чтобы выбрать игрока. Удерживайте и перетащите, чтобы поменять места.")
            }

            Section {
                Button("Добавить игроков", systemImage: "person.badge.plus") { adding = AddTarget() }
                    .disabled(draft.freeSeats == 0)
                if let last = draft.evening?.lastPlayers, !last.isEmpty {
                    Button("Состав прошлой игры", systemImage: "arrow.uturn.backward.circle") { draft.seat(last) }
                }
                Button("Перемешать места", systemImage: "shuffle") { draft.shuffleSeats() }
                    .disabled(draft.filled < 2)
                Button("Очистить", systemImage: "trash", role: .destructive) { draft.seat([]) }
                    .disabled(draft.filled == 0)
            }
        }
        .navigationTitle("Игроки")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { EditButton() }
        }
        .safeAreaInset(edge: .bottom) {
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
        .sheet(item: $adding) { AddPlayersSheet(slotID: $0.slotID).environment(draft) }
        .alert("Нельзя продолжить", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
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
    @Environment(\.dismiss) private var dismiss
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
            dismiss()
        } catch {
            errorMessage = error.message
        }
    }
}

// MARK: - Добавление игроков

/// Игроки на места: из клуба (отметками), поиском по GoMafia или гостем.
struct AddPlayersSheet: View {
    /// Место, на которое выбираем одного игрока. `nil` — заполняем свободные места подряд.
    let slotID: SeatSlot.ID?
    @Environment(NewGameDraft.self) private var draft
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var source: Source = .club
    @State private var query = ""
    @State private var roster: [GoMafiaPlayer] = []
    @State private var results: [GoMafiaPlayer] = []
    @State private var guestName = ""
    @State private var isLoadingRoster = false

    enum Source: String, CaseIterable {
        case club = "Клуб"
        case search = "Поиск"
        case guest = "Гость"
    }

    private var clubID: Int? { model.account?.goMafia?.club?.id }
    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    private var filteredRoster: [GoMafiaPlayer] {
        let sorted = roster.sorted { ($0.elo ?? 0) > ($1.elo ?? 0) }
        guard !trimmed.isEmpty else { return sorted }
        return sorted.filter { $0.nickname.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("Источник", selection: $source) {
                        ForEach(Source.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
                switch source {
                case .club: clubSection
                case .search: searchSection
                case .guest: guestSection
                }
            }
            .navigationTitle(slotID == nil ? "Свободно мест: \(draft.freeSeats)" : "Игрок на место")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: source == .club ? "Найти в клубе" : "Ник в GoMafia")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово", systemImage: "checkmark") { dismiss() }
                }
            }
            .task {
                if clubID == nil { source = .search }
                await loadRoster()
            }
            .task(id: "\(source.rawValue)|\(trimmed)") { await search() }
        }
    }

    // MARK: Источники

    @ViewBuilder
    private var clubSection: some View {
        if clubID == nil {
            Section {
                Text("Клуб появится после подключения GoMafia в профиле.").foregroundStyle(.secondary)
            }
        } else {
            Section {
                if isLoadingRoster, roster.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                ForEach(filteredRoster) { player in pickRow(player) }
            } footer: {
                Text("Отмечайте игроков — они займут свободные места по порядку.")
            }
        }
    }

    @ViewBuilder
    private var searchSection: some View {
        Section {
            if trimmed.count < 2 {
                Text("Введите хотя бы 2 символа ника").foregroundStyle(.secondary)
            }
            ForEach(results) { player in pickRow(player) }
        }
    }

    private var guestSection: some View {
        Section {
            HStack {
                TextField("Имя гостя", text: $guestName)
                    .textInputAutocapitalization(.words)
                    .submitLabel(.done)
                    .onSubmit(addGuest)
                Button("Добавить", action: addGuest)
                    .disabled(guestName.trimmingCharacters(in: .whitespaces).isEmpty || draft.freeSeats == 0 && slotID == nil)
            }
        } footer: {
            Text("Игрок без аккаунта GoMafia — только для фанки.")
        }
    }

    private func pickRow(_ player: GoMafiaPlayer) -> some View {
        let profile = PlayerProfile(goMafia: player)
        let isSeated = draft.taken.contains(profile.id)
        return Button {
            if isSeated {
                draft.remove(profile.id)
            } else if draft.add(profile, to: slotID), slotID != nil {
                dismiss()
            }
        } label: {
            HStack {
                PlayerRow(player: player)
                Image(systemName: isSeated ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSeated ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
            }
        }
        .foregroundStyle(.primary)
        .disabled(!isSeated && draft.freeSeats == 0 && slotID == nil)
    }

    private func addGuest() {
        let name = guestName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, draft.add(PlayerProfile(nickname: name), to: slotID) else { return }
        guestName = ""
        if slotID != nil { dismiss() }
    }

    // MARK: Загрузка

    private func loadRoster() async {
        guard let clubID, roster.isEmpty else { return }
        isLoadingRoster = true
        roster = await model.clubRoster(clubID: clubID) ?? []
        isLoadingRoster = false
    }

    private func search() async {
        guard source == .search, trimmed.count >= 2 else {
            results = []
            return
        }
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled else { return }
        guard let found = await model.searchPlayers(trimmed), !Task.isCancelled else { return }
        results = found
    }
}
