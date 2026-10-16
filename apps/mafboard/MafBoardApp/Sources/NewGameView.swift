import SwiftUI
import MafBoardCore

/// Лист «Новая игра»: вариант, режим, игроки по местам (из GoMafia или гости), раздача ролей.
struct NewGameView: View {
    @Environment(AppModel.self) private var model
    @Environment(GameLibrary.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var variant: GameVariant = .sport
    @State private var format: CompetitionFormat = .funky
    @State private var cityCount = 10
    @State private var seats: [PlayerProfile?] = Array(repeating: nil, count: 10)
    @State private var shufflesSeating = false
    @State private var picking: SeatSlot?
    @State private var errorMessage: String?

    private struct SeatSlot: Identifiable {
        let index: Int
        var id: Int { index }
    }

    private var count: Int { variant == .sport ? 10 : cityCount }
    private var access: HostingAccess? { model.account?.hostingAccess }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Вариант", selection: $variant) {
                        ForEach(GameVariant.allCases, id: \.self) { Text($0.displayName).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    if variant == .city {
                        Stepper("Игроков: \(cityCount)", value: $cityCount, in: Ruleset.city.allowedPlayerCounts)
                    }
                }
                formatSection
                seatsSection
                Section {
                    Toggle("Случайная рассадка", isOn: $shufflesSeating)
                } footer: {
                    Text("Роли раздаются случайно. Пустые места займут гости «Игрок N» — это можно только в фанке.")
                }
            }
            .navigationTitle("Новая игра")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена", systemImage: "xmark") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Начать", systemImage: "checkmark", action: start)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: start) {
                    Text("Раздать роли и начать").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .padding(.horizontal)
            }
            .sheet(item: $picking) { slot in
                PlayerPickerView(taken: Set(seats.compactMap { $0?.id })) { seats[slot.index] = $0 }
            }
            .onChange(of: count) { _, newCount in
                seats = Array(seats.prefix(newCount)) + Array(repeating: nil, count: max(0, newCount - seats.count))
            }
            .alert("Не удалось начать", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    // MARK: Разделы

    private var formatSection: some View {
        Section {
            ForEach(CompetitionFormat.allCases, id: \.self) { item in
                let allowed = item == .funky || access?.allows(item) == true
                Button {
                    format = item
                } label: {
                    HStack {
                        Text(item.displayName).foregroundStyle(allowed ? .primary : .secondary)
                        Spacer()
                        if !allowed {
                            Image(systemName: "lock.fill").foregroundStyle(.secondary)
                        } else if format == item {
                            Image(systemName: "checkmark").foregroundStyle(.tint).fontWeight(.semibold)
                        }
                    }
                }
                .disabled(!allowed)
            }
        } header: {
            Text("Режим")
        } footer: {
            if access?.allows(.rating) != true {
                Text("Рейтинг, миникап и турнир — для ведущего клуба GoMafia. Привяжите GoMafia в профиле.")
            } else if format.countsTowardStandings {
                Text("Только игроки GoMafia. Игры вечера складываются в одну серию.")
            }
        }
    }

    private var seatsSection: some View {
        Section {
            ForEach(0..<count, id: \.self) { index in
                Button {
                    picking = SeatSlot(index: index)
                } label: {
                    seatRow(index)
                }
                .foregroundStyle(.primary)
                .swipeActions {
                    if seats[index] != nil {
                        Button("Убрать", systemImage: "person.badge.minus", role: .destructive) { seats[index] = nil }
                    }
                }
            }
        } header: {
            HStack {
                Text("Рассадка")
                Spacer()
                Text("\(seats.prefix(count).compactMap { $0 }.count) из \(count)")
            }
        }
    }

    private func seatRow(_ index: Int) -> some View {
        HStack(spacing: 12) {
            Text("\(index + 1)")
                .font(.body.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .frame(width: 24, alignment: .trailing)
            if let player = seats[index] {
                PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 32)
                Text(player.nickname).lineLimit(1)
                Spacer()
                if player.goMafiaID == nil {
                    Text("гость").font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Image(systemName: "person.crop.circle.badge.plus")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .frame(width: 32)
                Text("Выбрать игрока").foregroundStyle(.secondary)
                Spacer()
            }
        }
    }

    // MARK: Старт

    private func start() {
        let profiles = (0..<count).map { seats[$0] ?? PlayerProfile(nickname: "Игрок \($0 + 1)") }
        var generator = SystemRandomNumberGenerator()
        let ordered = shufflesSeating ? profiles.shuffled(using: &generator) : profiles
        let ruleset = variant.defaultRuleset
        do throws(GameError) {
            let roles = RoleDealer.deal(try ruleset.standardRoles(playerCount: count), using: &generator)
            let setup: GameSetup
            if let account = model.account {
                setup = try GameSetup.hosted(
                    by: account, format: format, ruleset: ruleset, players: ordered, roles: roles,
                    seriesID: library.seriesID(format: format, variant: variant)
                )
            } else {
                setup = try GameSetup(format: .funky, ruleset: ruleset, players: ordered.map(\.id), roles: roles)
            }
            library.start(setup: setup, players: ordered)
            dismiss()
        } catch {
            errorMessage = error.message
        }
    }
}

// MARK: - Выбор игрока

/// Игрок на место: поиск в GoMafia (сначала свой клуб) или гость без аккаунта.
struct PlayerPickerView: View {
    let taken: Set<PlayerID>
    let onPick: (PlayerProfile) -> Void
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [GoMafiaPlayer] = []
    @State private var guestName = ""

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField("Имя гостя", text: $guestName)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .onSubmit(addGuest)
                        Button("Добавить", action: addGuest)
                            .disabled(guestName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                } header: {
                    Text("Гость")
                } footer: {
                    Text("Игрок без аккаунта GoMafia — только для фанки.")
                }
                if !results.isEmpty {
                    Section("GoMafia") {
                        ForEach(results) { player in
                            let isTaken = taken.contains(PlayerID.goMafia(player.id))
                            Button { pick(PlayerProfile(goMafia: player)) } label: {
                                PlayerRow(player: player)
                            }
                            .foregroundStyle(.primary)
                            .disabled(isTaken)
                        }
                    }
                }
            }
            .overlay {
                if trimmed.count >= 2, results.isEmpty {
                    ContentUnavailableView.search(text: trimmed)
                }
            }
            .navigationTitle("Игрок")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Ник в GoMafia")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена", systemImage: "xmark") { dismiss() } }
            }
            .task(id: trimmed) {
                guard trimmed.count >= 2 else {
                    results = []
                    return
                }
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                guard let found = await model.searchPlayers(trimmed), !Task.isCancelled else { return }
                results = found
            }
        }
    }

    private func addGuest() {
        let name = guestName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        pick(PlayerProfile(nickname: name))
    }

    private func pick(_ profile: PlayerProfile) {
        onPick(profile)
        dismiss()
    }
}
