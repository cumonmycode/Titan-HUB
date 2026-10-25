import SwiftUI
import MafBoardCore

// MARK: - Шаг 4: роли

/// Раздача ролей: случайно (с перераздачей) или вручную — ведущий выбирает роль и нажимает номер игрока.
struct RolesStep: View {
    @Environment(NewGameDraft.self) private var draft
    @Environment(AppModel.self) private var model
    @Environment(GameLibrary.self) private var library
    /// Игра создана — закрыть мастер целиком.
    let onStarted: () -> Void
    @State private var mode = Mode.random
    @State private var isRevealed = false
    /// Ручная раздача: особые роли по слотам и кому каждая выдана (индекс места).
    @State private var slots: [RoleSlot] = []
    @State private var currentSlot = 0
    @State private var errorMessage: String?

    enum Mode: String, CaseIterable, Identifiable {
        case random = "Случайно"
        case manual = "Вручную"
        var id: Self { self }
    }

    struct RoleSlot: Identifiable, Equatable {
        let id: Int
        let role: Role
        var seat: Int?
    }

    private var isComplete: Bool { draft.roles.count == draft.playerCount }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Раздача", selection: $mode) {
                    ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)

                switch mode {
                case .random: randomCard
                case .manual: manualCard
                }

                seatsList
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .ambientBackground()
        .navigationTitle("Роли")
        .safeAreaInset(edge: .bottom) {
            Button(action: start) {
                Label(isComplete ? "Начать игру" : "Выдайте все роли", systemImage: "play.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.solidProminent)
            .controlSize(.large)
            .disabled(!isComplete)
            .padding(.horizontal)
        }
        .onAppear { if draft.roles.count != draft.playerCount { deal() } }
        .onChange(of: mode) { _, mode in
            if mode == .manual { loadSlots() } else if !isComplete { deal() }
        }
        .sensoryFeedback(.selection, trigger: slots)
        .alert("Не удалось начать", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "")
        }
    }

    // MARK: Случайно

    private var randomCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Состав").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            Text(composition).font(.subheadline)
            Button {
                withAnimation(.snappy) { deal() }
            } label: {
                Label("Перераздать роли", systemImage: "shuffle").font(.subheadline.weight(.semibold))
            }
            .buttonStyle(.solidProminent)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 24, style: .continuous))
    }

    private var composition: String {
        let counts = Dictionary(grouping: draft.roles, by: { $0 }).mapValues(\.count)
        return counts
            .sorted { Self.rank($0.key) < Self.rank($1.key) }
            .map { $0.value > 1 ? "\($0.key.displayName) × \($0.value)" : $0.key.displayName }
            .joined(separator: ", ")
    }

    // MARK: Вручную

    private var manualCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Выберите роль и нажмите номер игрока. Остальные — мирные.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(Array(slots.enumerated()), id: \.element.id) { index, slot in
                        Button {
                            withAnimation(.snappy) { currentSlot = index }
                        } label: {
                            VStack(spacing: 2) {
                                Text(slot.role.displayName).font(.caption.weight(.semibold)).lineLimit(1)
                                Text(slot.seat.map { "№\($0 + 1)" } ?? "—").font(.headline).monospacedDigit()
                            }
                            .frame(minWidth: 58, minHeight: 40)
                        }
                        .modifier(RoleChipStyle(isSelected: index == currentSlot, tint: slot.role.team.tint))
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
            Keypad(count: draft.playerCount, layout: .grid(columns: 5), spacing: 8) { number in
                let seat = number - 1
                let holder = slots.first { $0.seat == seat }
                let isCurrent = holder != nil && holder?.id == slots[safe: currentSlot]?.id
                KeypadKey(
                    number: number, caption: holder?.role.displayName,
                    style: isCurrent ? .selected : (holder != nil ? .marked : .normal),
                    tint: holder?.role.team.tint
                ) { assign(seat) }
            }
            Button("Очистить", systemImage: "arrow.counterclockwise") {
                withAnimation(.snappy) { clearSlots() }
            }
            .buttonStyle(.solid)
            .disabled(slots.allSatisfy { $0.seat == nil })
        }
        .padding(16)
        .glassEffect(.regular, in: .rect(cornerRadius: 24, style: .continuous))
    }

    /// Номер нажат для выбранной роли. Номер уже у другой роли — роли меняются местами.
    private func assign(_ seat: Int) {
        guard slots.indices.contains(currentSlot) else { return }
        var updated = slots
        if updated[currentSlot].seat == seat {
            updated[currentSlot].seat = nil
        } else {
            if let other = updated.firstIndex(where: { $0.seat == seat }) {
                updated[other].seat = updated[currentSlot].seat
            }
            updated[currentSlot].seat = seat
        }
        withAnimation(.snappy) {
            slots = updated
            let after = updated.indices.filter { $0 > currentSlot } + updated.indices.filter { $0 <= currentSlot }
            if let next = after.first(where: { updated[$0].seat == nil }) { currentSlot = next }
        }
        applySlots()
    }

    /// Ручная раздача начинается с того, что уже роздано, — ведущий правит только нужное.
    private func loadSlots() {
        let special: [Role]
        do throws(GameError) {
            special = try draft.ruleset.standardRoles(playerCount: draft.playerCount)
                .filter { $0 != .civilian }
                .sorted { Self.rank($0) < Self.rank($1) }
        } catch {
            errorMessage = error.message
            return
        }
        var used = Set<Int>()
        slots = special.enumerated().map { index, role in
            let seat = draft.roles.indices.first { draft.roles[$0] == role && !used.contains($0) }
            if let seat { used.insert(seat) }
            return RoleSlot(id: index, role: role, seat: seat)
        }
        currentSlot = slots.firstIndex { $0.seat == nil } ?? 0
        applySlots()
    }

    private func clearSlots() {
        slots = slots.map { RoleSlot(id: $0.id, role: $0.role, seat: nil) }
        currentSlot = 0
        applySlots()
    }

    /// Все особые роли выданы — состав готов; иначе игру не начать.
    private func applySlots() {
        guard slots.allSatisfy({ $0.seat != nil }) else {
            draft.roles = []
            return
        }
        var roles = Array(repeating: Role.civilian, count: draft.playerCount)
        for slot in slots {
            if let seat = slot.seat { roles[seat] = slot.role }
        }
        draft.roles = roles
    }

    // MARK: Места

    private var seatsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Роли по местам").font(.title3.bold())
                Spacer()
                Toggle("Показать", isOn: $isRevealed).fixedSize()
            }
            .padding(.horizontal, 4)
            ForEach(Array(draft.seatedPlayers.enumerated()), id: \.offset) { index, player in
                HStack(spacing: 12) {
                    Text("\(index + 1)")
                        .font(.subheadline.weight(.bold))
                        .monospacedDigit()
                        .frame(width: 30, height: 30)
                        .background(Color(.tertiarySystemFill), in: .circle)
                    PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 36)
                    Text(player.nickname).font(.body.weight(.medium)).lineLimit(1)
                    Spacer()
                    if draft.roles.indices.contains(index) {
                        let role = draft.roles[index]
                        Text(isRevealed ? role.displayName : "•••")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(isRevealed ? AnyShapeStyle(role.team.tint) : AnyShapeStyle(.tertiary))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background((isRevealed ? role.team.tint : Color.secondary).opacity(0.14), in: .capsule)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .glassEffect(.regular, in: .rect(cornerRadius: 20, style: .continuous))
            }
            Text(mode == .random
                 ? "Роли розданы случайно. Покажите их игрокам по очереди или раздайте карты в том же порядке."
                 : "Роли выданы ведущим. Можно включить «Показать» и сверить с картами.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)
        }
    }

    // MARK: Логика

    /// Порядок ролей: дон, мафия, шериф, остальные особые, мирные.
    private static func rank(_ role: Role) -> Int {
        if role == .don { return 0 }
        if role.team == .black { return 1 }
        if role == .sheriff { return 2 }
        if role == .civilian { return 4 }
        return 3
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

private struct RoleChipStyle: ViewModifier {
    let isSelected: Bool
    let tint: Color

    func body(content: Content) -> some View {
        if isSelected {
            content.buttonStyle(.solidProminent).tint(tint)
        } else {
            content.buttonStyle(.solid)
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
