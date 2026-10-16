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
            ScrollView {
                VStack(spacing: 16) {
                    variantCard
                    formatCard
                    seatsCard
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .appBackground()
            .navigationTitle("Новая игра")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена", systemImage: "xmark") { dismiss() }
                }
            }
            .safeAreaInset(edge: .bottom) {
                Button(action: start) {
                    Label("Раздать роли и начать", systemImage: "theatermasks.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .padding(.horizontal)
                .padding(.bottom, 8)
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

    // MARK: Карточки

    private var variantCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CapsLabel(text: "Вариант")
            Picker("Вариант", selection: $variant) {
                ForEach(GameVariant.allCases, id: \.self) { Text($0.displayName).tag($0) }
            }
            .pickerStyle(.segmented)
            if variant == .city {
                Stepper("Игроков: \(cityCount)", value: $cityCount, in: Ruleset.city.allowedPlayerCounts)
            }
        }
        .glassCard()
    }

    private var formatCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            CapsLabel(text: "Режим")
            GlassEffectContainer(spacing: 10) {
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible())], spacing: 10) {
                    ForEach(CompetitionFormat.allCases, id: \.self) { item in
                        let allowed = item == .funky || access?.allows(item) == true
                        Button {
                            if allowed {
                                format = item
                            } else {
                                errorMessage = "«\(item.displayName)» доступен ведущему клуба GoMafia. Привяжите GoMafia в профиле."
                            }
                        } label: {
                            HStack {
                                Text(item.displayName).font(.headline)
                                Spacer()
                                if !allowed { Image(systemName: "lock.fill").foregroundStyle(.secondary) }
                            }
                            .padding(.horizontal, 14)
                            .frame(maxWidth: .infinity, minHeight: 48)
                        }
                        .buttonStyle(.plain)
                        .glassEffect(format == item ? .regular.tint(item.tint.opacity(0.45)).interactive() : .regular.interactive(), in: .rect(cornerRadius: 16))
                        .opacity(allowed ? 1 : 0.6)
                    }
                }
            }
            if format.countsTowardStandings {
                Text("В «\(format.displayName)» играют только игроки GoMafia. Игры вечера складываются в одну серию.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .glassCard()
    }

    private var seatsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                CapsLabel(text: "Рассадка")
                Spacer()
                Text("\(seats.prefix(count).compactMap { $0 }.count) из \(count)").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(0..<count, id: \.self) { index in
                seatRow(index)
            }
            Toggle("Случайная рассадка", isOn: $shufflesSeating)
                .padding(.top, 6)
            Text("Пустые места займут гости «Игрок N» — только для фанки.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .glassCard()
    }

    private func seatRow(_ index: Int) -> some View {
        HStack(spacing: 12) {
            Text("\(index + 1)").font(.headline).monospacedDigit().frame(width: 26)
            if let player = seats[index] {
                PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 36)
                Text(player.nickname).lineLimit(1)
                if player.goMafiaID == nil { FormatTag(text: "гость", color: .secondary) }
                Spacer()
                Button("Убрать", systemImage: "xmark.circle.fill") { seats[index] = nil }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.secondary)
                    .buttonStyle(.plain)
            } else {
                Image(systemName: "person.crop.circle.badge.plus").font(.title2).foregroundStyle(.secondary).frame(width: 36)
                Text("Выбрать игрока").foregroundStyle(.secondary)
                Spacer()
            }
        }
        .padding(10)
        .background(.white.opacity(0.06), in: .rect(cornerRadius: 16))
        .contentShape(.rect)
        .onTapGesture { picking = SeatSlot(index: index) }
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
            ScrollView {
                VStack(spacing: 10) {
                    HStack(spacing: 10) {
                        TextField("Гость без GoMafia", text: $guestName)
                            .textInputAutocapitalization(.words)
                            .submitLabel(.done)
                            .onSubmit(addGuest)
                        Button("Добавить", action: addGuest)
                            .buttonStyle(.glass)
                            .disabled(guestName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .glassCard(cornerRadius: 20, padding: 12)

                    ForEach(results) { player in
                        let isTaken = taken.contains(PlayerID.goMafia(player.id))
                        Button { pick(PlayerProfile(goMafia: player)) } label: {
                            PlayerRow(player: player).glassCard(cornerRadius: 20, padding: 12)
                        }
                        .buttonStyle(.plain)
                        .disabled(isTaken)
                        .opacity(isTaken ? 0.4 : 1)
                    }
                    if results.isEmpty {
                        Text(trimmed.count < 2 ? "Введите хотя бы 2 символа ника" : "Никого не нашли")
                            .foregroundStyle(.secondary)
                            .padding(.top, 24)
                    }
                }
                .padding()
            }
            .appBackground()
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
