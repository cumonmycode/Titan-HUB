import SwiftUI
import MafBoardCore

// MARK: - Шаг 3: игроки

/// Рассадка. Нажатие на место — подбор игрока; удержание и перетаскивание на другое место — игроки меняются местами;
/// «Пересадить» — случайная рассадка одной кнопкой. Состав прошлой игры вечера уже на местах.
struct PlayersStep: View {
    let onNext: () -> Void
    @Environment(NewGameDraft.self) private var draft
    @Environment(GameLibrary.self) private var library
    @State private var picking: SlotPick?
    @State private var dropTarget: SeatSlot.ID?
    @State private var errorMessage: String?

    var body: some View {
        @Bindable var draft = draft
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                summary
                actions
                HStack {
                    Text("Рассадка").font(.title3.bold())
                    Spacer()
                    Text("\(draft.filled) из \(draft.playerCount)")
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 4)
                .padding(.top, 4)
                VStack(spacing: 8) {
                    ForEach(Array(draft.slots.enumerated()), id: \.element.id) { index, slot in
                        seatRow(index: index, slot: slot)
                    }
                }
                Label("Удерживайте игрока и перетащите на другое место — они поменяются местами.", systemImage: "hand.draw")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .ambientBackground()
        .navigationTitle("Игроки")
        .safeAreaInset(edge: .bottom) {
            Button(action: proceed) {
                Text(draft.freeSeats == 0 ? "Далее: роли" : "Далее: роли (гостей: \(draft.freeSeats))")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.solidProminent)
            .controlSize(.large)
            .padding(.horizontal)
        }
        .sheet(item: $picking) { SeatPickerSheet(start: $0.index) }
        .sensoryFeedback(.selection, trigger: draft.slots.map(\.player?.id))
        .alert("Нельзя продолжить", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: Части

    private var summary: some View {
        @Bindable var draft = draft
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(draft.variant.displayName).font(.headline)
                FormatTag(format: draft.format)
                Spacer()
            }
            if let evening = draft.evening {
                Label("\(evening.title) · игра \(library.games(of: evening).count + 1)", systemImage: "calendar")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if draft.variant == .city {
                Stepper("Игроков: \(draft.cityCount)", value: $draft.cityCount, in: Ruleset.city.allowedPlayerCounts)
                    .onChange(of: draft.cityCount) { draft.resize() }
            }
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 24, style: .continuous))
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button {
                withAnimation(.snappy) { draft.shuffleSeats() }
            } label: {
                Label("Пересадить", systemImage: "shuffle").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.solidProminent)
            .disabled(draft.filled < 2)
            if let last = draft.evening.map(library.lastLineup(of:)), !last.isEmpty {
                Button {
                    withAnimation(.snappy) { draft.seat(last) }
                } label: {
                    Label("Прошлый состав", systemImage: "arrow.uturn.backward").font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.solid)
            }
            Spacer(minLength: 0)
            Button(role: .destructive) {
                withAnimation(.snappy) { draft.seat([]) }
            } label: {
                Image(systemName: "trash").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.solid(.circle))
            .disabled(draft.filled == 0)
            .accessibilityLabel("Очистить рассадку")
        }
    }

    private func seatRow(index: Int, slot: SeatSlot) -> some View {
        Button {
            picking = SlotPick(index: index)
        } label: {
            SlotRow(number: index + 1, player: slot.player)
        }
        .buttonStyle(.plain)
        .overlay {
            if dropTarget == slot.id {
                RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.tint, lineWidth: 2)
            }
        }
        .contextMenu {
            Button("Выбрать игрока", systemImage: "person.crop.circle.badge.plus") { picking = SlotPick(index: index) }
            if let player = slot.player {
                Button("Убрать с места", systemImage: "person.badge.minus", role: .destructive) {
                    withAnimation(.snappy) { draft.remove(player.id) }
                }
            }
        }
        .draggable(slot.id.uuidString) {
            SlotRow(number: index + 1, player: slot.player).frame(width: 300)
        }
        .dropDestination(for: String.self) { items, _ in
            guard let raw = items.first, let source = UUID(uuidString: raw) else { return false }
            withAnimation(.snappy) { draft.swapSeats(source, slot.id) }
            return true
        } isTargeted: { isTargeted in
            if isTargeted { dropTarget = slot.id } else if dropTarget == slot.id { dropTarget = nil }
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

private struct SlotPick: Identifiable {
    let index: Int
    var id: Int { index }
}

/// Место в рассадке — стеклянная строка: номер, игрок (или «Свободно») и подсказка.
private struct SlotRow: View {
    let number: Int
    let player: PlayerProfile?

    var body: some View {
        HStack(spacing: 12) {
            Text("\(number)")
                .font(.subheadline.weight(.bold))
                .monospacedDigit()
                .foregroundStyle(player == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.white))
                .frame(width: 30, height: 30)
                .background(player == nil ? AnyShapeStyle(Color(.tertiarySystemFill)) : AnyShapeStyle(Color.accentColor.gradient), in: .circle)
            if let player {
                PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 38)
                VStack(alignment: .leading, spacing: 1) {
                    Text(player.nickname).font(.body.weight(.semibold)).lineLimit(1)
                    Text(player.goMafiaID == nil ? "Гость" : "GoMafia").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "line.3.horizontal").font(.subheadline).foregroundStyle(.tertiary)
            } else {
                Image(systemName: "plus.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .frame(width: 38, height: 38)
                Text("Свободно").foregroundStyle(.secondary)
                Spacer()
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(.rect)
        .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
    }
}

// MARK: - Подбор игрока на место

/// Кандидат на место: игрок клуба, игрок GoMafia или гость под введённым именем.
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

/// Лист «Место N»: полоса мест сверху, кто сейчас сидит, поиск и список кандидатов.
/// После выбора — сразу следующее свободное место; мест не осталось — лист закрывается.
private struct SeatPickerSheet: View {
    @Environment(NewGameDraft.self) private var draft
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var index: Int
    @State private var query = ""
    @State private var roster: [GoMafiaPlayer] = []
    @State private var found: [GoMafiaPlayer] = []
    @State private var isSearching = false
    @FocusState private var isFieldFocused: Bool

    private static let rosterLimit = 40
    private static let goMafiaLimit = 8

    init(start: Int) {
        _index = State(initialValue: start)
    }

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    private var occupant: PlayerProfile? { draft.slots.indices.contains(index) ? draft.slots[index].player : nil }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    SeatStripPicker(slots: draft.slots, selected: $index)
                    if let occupant { occupantCard(occupant) }
                    searchField
                    results
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .ambientBackground()
            .navigationTitle("Место \(index + 1)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово", systemImage: "checkmark") { dismiss() }
                }
            }
            .task { await loadRoster() }
            .task(id: trimmed) { await searchGoMafia() }
            .onChange(of: index) { query = "" }
        }
        .presentationDetents([.large])
    }

    // MARK: Части

    private func occupantCard(_ player: PlayerProfile) -> some View {
        HStack(spacing: 12) {
            PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text("Сейчас на месте").font(.caption).foregroundStyle(.secondary)
                Text(player.nickname).font(.headline).lineLimit(1)
            }
            Spacer()
            Button("Убрать", systemImage: "person.badge.minus", role: .destructive) {
                withAnimation(.snappy) { draft.remove(player.id) }
            }
            .buttonStyle(.solid)
            .tint(.red)
        }
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 22, style: .continuous))
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(occupant == nil ? "Ник игрока или имя гостя" : "Кем заменить?", text: $query)
                .focused($isFieldFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .onSubmit { if let first = suggestions.first { pick(first) } }
            if isSearching {
                ProgressView()
            } else if !query.isEmpty {
                Button("Стереть", systemImage: "xmark.circle.fill") { query = "" }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 50)
        .glassEffect(.regular, in: .capsule)
        .onAppear { isFieldFocused = occupant == nil }
    }

    @ViewBuilder
    private var results: some View {
        let all = suggestions
        let club = all.filter { if case .club = $0 { true } else { false } }
        let others = all.filter { if case .goMafia = $0 { true } else { false } }
        let guest = all.first { if case .guest = $0 { true } else { false } }

        if !club.isEmpty { group("Мой клуб", club) }
        if !others.isEmpty { group("GoMafia", others) }
        if let guest { group("Гость", [guest]) }
        if all.isEmpty {
            ContentUnavailableView(
                trimmed.isEmpty ? "Начните вводить ник" : "Никого не нашли",
                systemImage: "person.crop.circle.badge.questionmark",
                description: Text("Поиск по вашему клубу и GoMafia. Можно посадить гостя под любым именем.")
            )
            .padding(.top, 8)
        }
    }

    private func group(_ title: String, _ items: [Suggestion]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
                .padding(.horizontal, 6)
            ForEach(items) { suggestion in
                Button { pick(suggestion) } label: {
                    SuggestionRow(suggestion: suggestion, isGuestAllowed: !draft.format.countsTowardStandings)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Логика

    /// Без ввода — весь клуб по ELO; при вводе — клуб, затем GoMafia, последним — гость.
    private var suggestions: [Suggestion] {
        let taken = draft.taken
        let needle = trimmed.lowercased()
        let free = roster.filter { !taken.contains(PlayerID.goMafia($0.id)) }
        let club = (needle.isEmpty ? free : free.filter { $0.nickname.lowercased().contains(needle) })
            .sorted { lhs, rhs in
                let lhsPrefix = !needle.isEmpty && lhs.nickname.lowercased().hasPrefix(needle)
                let rhsPrefix = !needle.isEmpty && rhs.nickname.lowercased().hasPrefix(needle)
                if lhsPrefix != rhsPrefix { return lhsPrefix }
                return (lhs.elo ?? 0) > (rhs.elo ?? 0)
            }
            .prefix(Self.rosterLimit)
        guard !needle.isEmpty else { return club.map(Suggestion.club) }
        let clubIDs = Set(roster.map(\.id))
        let others = found
            .filter { !clubIDs.contains($0.id) && !taken.contains(PlayerID.goMafia($0.id)) }
            .prefix(Self.goMafiaLimit)
        return club.map(Suggestion.club) + others.map(Suggestion.goMafia) + [.guest(trimmed)]
    }

    private func pick(_ suggestion: Suggestion) {
        guard draft.slots.indices.contains(index),
              draft.add(suggestion.profile, to: draft.slots[index].id)
        else { return }
        query = ""
        let following = Array(draft.slots.indices[(index + 1)...]) + Array(draft.slots.indices[..<index])
        if let next = following.first(where: { draft.slots[$0].player == nil }) {
            withAnimation(.snappy) { index = next }
        } else {
            dismiss()
        }
    }

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

/// Полоса мест: занятые — со значком, текущее — выделено. Нажатие — перейти к месту.
private struct SeatStripPicker: View {
    let slots: [SeatSlot]
    @Binding var selected: Int

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(Array(slots.enumerated()), id: \.element.id) { index, slot in
                        Button {
                            withAnimation(.snappy) { selected = index }
                        } label: {
                            VStack(spacing: 2) {
                                Text("\(index + 1)").font(.headline).monospacedDigit()
                                Image(systemName: slot.player == nil ? "circle.dashed" : "person.fill")
                                    .font(.caption2)
                            }
                            .frame(width: 40, height: 44)
                        }
                        .modifier(SeatKeyStyle(isSelected: index == selected))
                        .id(index)
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
            .onChange(of: selected, initial: true) { _, index in
                withAnimation { proxy.scrollTo(index, anchor: .center) }
            }
        }
    }
}

private struct SeatKeyStyle: ViewModifier {
    let isSelected: Bool

    func body(content: Content) -> some View {
        if isSelected {
            content.buttonStyle(.solidProminent)
        } else {
            content.buttonStyle(.solid)
        }
    }
}

private struct SuggestionRow: View {
    let suggestion: Suggestion
    let isGuestAllowed: Bool

    var body: some View {
        HStack(spacing: 12) {
            switch suggestion {
            case let .club(player), let .goMafia(player):
                PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text(player.nickname).font(.body.weight(.semibold)).lineLimit(1)
                    Text([player.clubTitle, player.city].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                if let elo = player.elo {
                    Text("\(Int(elo))")
                        .font(.caption.weight(.bold))
                        .monospacedDigit()
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.accentColor.opacity(0.15), in: .capsule)
                        .foregroundStyle(.tint)
                }
                if case .club = suggestion {
                    Image(systemName: "star.fill").font(.caption).foregroundStyle(.yellow)
                }
            case let .guest(name):
                Image(systemName: "person.crop.circle.badge.plus")
                    .font(.title2)
                    .foregroundStyle(.secondary)
                    .frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Гость «\(name)»").font(.body.weight(.semibold)).lineLimit(1)
                    Text(isGuestAllowed ? "Без аккаунта GoMafia — играет под этим именем" : "Только для фанки")
                        .font(.caption)
                        .foregroundStyle(isGuestAllowed ? AnyShapeStyle(.secondary) : AnyShapeStyle(.orange))
                }
                Spacer()
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(.rect)
        .glassEffect(.regular, in: .rect(cornerRadius: 20, style: .continuous))
    }
}
