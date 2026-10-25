import SwiftUI
import MafBoardCore

// MARK: - Ночь

/// Шаг ночи: кто действует, прошлые проверки, промах и пропуск. Цель выбирают нажатием на игрока ниже.
struct NightPanel: View {
    let game: GameController
    let step: NightStep
    @State private var isShowingMiss = false

    private var state: GameState { game.state }

    private var performers: [Seat] {
        state.seats.filter { $0.isAlive && step.isPerformed(by: $0.role) }.map(\.seat)
    }

    /// Подробный промах (кто куда стрелял) — только в подробном режиме. В простом — просто промах.
    private var asksMissDetails: Bool {
        step == .mafiaShot && state.ruleset.voting.ballotStyle == .perVoter
    }

    /// Прошлые проверки этой роли — ведущему, если проверяющий спросит.
    private var pastChecks: [NightCheck] {
        guard step == .donCheck || step == .sheriffCheck else { return [] }
        let checker: Role = step == .donCheck ? .don : .sheriff
        var checks = state.nights.flatMap(\.actions.checks)
        if case let .night(progress) = state.phase { checks += progress.actions.checks }
        return checks.filter { $0.checker == checker }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !performers.isEmpty {
                Label("\(step.actorTitle): " + performers.map { "№\($0)" }.joined(separator: ", "), systemImage: step.icon)
                    .font(.headline)
                    .foregroundStyle(.indigo)
            }
            if !pastChecks.isEmpty {
                Text("Уже проверял: " + pastChecks.map { "№\($0.target) — \($0.verdictText)" }.joined(separator: ", "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(step.hint).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                if step.killer != nil {
                    Button {
                        if asksMissDetails { isShowingMiss = true } else { game.perform(.night(.shot(nil))) }
                    } label: {
                        Label("Промах", systemImage: "scope").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                Button { game.perform(.night(.skip)) } label: {
                    Label("Пропустить", systemImage: "forward").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.large)
        }
        .gameCard()
        .sheet(isPresented: $isShowingMiss) { MissSheet(game: game, shooters: performers) }
    }
}

extension NightStep {
    /// «Стреляет мафия», «Проверяет шериф».
    var actorTitle: String {
        switch self {
        case .mafiaShot: "Стреляет мафия"
        case .maniacShot: "Стреляет маньяк"
        case .donCheck: "Проверяет дон"
        case .sheriffCheck: "Проверяет шериф"
        case .doctorHeal: "Лечит доктор"
        }
    }

    var icon: String {
        switch self {
        case .mafiaShot, .maniacShot: "scope"
        case .donCheck, .sheriffCheck: "magnifyingglass"
        case .doctorHeal: "cross.case.fill"
        }
    }

    var hint: String {
        switch self {
        case .mafiaShot, .maniacShot: "Нажмите на игрока — в него стреляют."
        case .donCheck, .sheriffCheck: "Нажмите на игрока — его проверяют. Можно проверить и того, кто уже выбыл."
        case .doctorHeal: "Нажмите на игрока — его лечат."
        }
    }
}

// MARK: - Промах

/// Промах мафии: кто из стрелявших куда стрелял. Не отмеченный — не стрелял. «Просто промах» — без подробностей.
struct MissSheet: View {
    let game: GameController
    let shooters: [Seat]
    @Environment(\.dismiss) private var dismiss
    /// Стрелявший → цель. Нет записи — не стрелял.
    @State private var targets: [Seat: Seat] = [:]
    @State private var current: Seat?

    private var state: GameState { game.state }
    private var selected: Seat? { current ?? shooters.first }

    /// Все выстрелили в одного живого — это попадание, а не промах.
    private var unanimousTarget: Seat? {
        let picked = Set(shooters.map { targets[$0] })
        guard picked.count == 1, let only = picked.first, let target = only, state.isAlive(target) else { return nil }
        return target
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Кто куда стрелял. Выберите стрелявшего, затем номер. Не отмеченный — не стрелял.")
                        .foregroundStyle(.secondary)
                    shooterChips
                    if let shooter = selected {
                        Keypad(count: state.seats.count) { number in
                            let seat = Seat(number)
                            let style: KeypadKey.Style = !state.isAlive(seat) ? .disabled : (targets[shooter] == seat ? .selected : .normal)
                            KeypadKey(number: number, style: style, tint: .red) { pick(seat, for: shooter) }
                        }
                    }
                    if let target = unanimousTarget {
                        Label("Все выстрелили в №\(target.number) — это попадание, а не промах", systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.orange)
                    }
                    Button {
                        if game.perform(.night(.shot(nil))) { dismiss() }
                    } label: {
                        Label("Просто промах", systemImage: "scope").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.solid)
                    .controlSize(.large)
                }
                .padding()
            }
            .background { AmbientBackground(mood: .night) }
            .navigationTitle("Промах")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Записать", systemImage: "checkmark") {
                        let shots = shooters.map { MissedShot($0, at: targets[$0]) }
                        if game.perform(.night(.miss(shots))) { dismiss() }
                    }
                    .disabled(unanimousTarget != nil)
                }
            }
        }
        .presentationDetents([.large])
    }

    /// Стрелявшие: номер, роль и куда выстрелил.
    private var shooterChips: some View {
        HStack(spacing: 8) {
            ForEach(shooters, id: \.self) { shooter in
                let label = VStack(spacing: 2) {
                    Text("№\(shooter.number) · \(state.seat(shooter)?.role.displayName.lowercased() ?? "")")
                        .font(.subheadline.weight(.semibold))
                    Text(targets[shooter].map { "→ №\($0.number)" } ?? "не стрелял")
                        .font(.caption.weight(.medium))
                        .opacity(0.8)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                Group {
                    if shooter == selected {
                        Button { current = shooter } label: { label }.buttonStyle(.solidProminent).tint(.indigo)
                    } else {
                        Button { withAnimation(.snappy) { current = shooter } } label: { label }.buttonStyle(.solid)
                    }
                }
            }
        }
    }

    /// Номер у стрелявшего: повторное нажатие снимает выстрел. Дальше — следующий, кто ещё не отмечен.
    private func pick(_ seat: Seat, for shooter: Seat) {
        if targets[shooter] == seat {
            targets[shooter] = nil
            return
        }
        targets[shooter] = seat
        if let next = shooters.first(where: { $0 != shooter && targets[$0] == nil }) {
            withAnimation(.snappy) { current = next }
        }
    }
}

// MARK: - Результат проверки

/// Результат проверки дона или шерифа — крупно, чтобы ведущий показал его жестом. Касание — закрыть.
struct CheckResultOverlay: View {
    let check: NightCheck
    let name: String
    let onDismiss: () -> Void
    @State private var isShown = false

    private var verdict: (title: String, icon: String, tint: Color) {
        switch check.checker {
        case .don:
            check.isPositive ? ("Шериф", "star.fill", .yellow) : ("Не шериф", "xmark", .gray)
        default:
            check.isPositive ? ("Чёрный", "hand.thumbsdown.fill", Team.black.tint) : ("Красный", "hand.thumbsup.fill", Team.red.tint)
        }
    }

    var body: some View {
        let verdict = verdict
        AnnouncementCard(onBackgroundTap: onDismiss) {
            Label(check.checker == .don ? "Проверка дона" : "Проверка шерифа", systemImage: "magnifyingglass")
                .font(.headline)
                .foregroundStyle(.secondary)
            SeatNumberTitle(seat: check.target, name: name)
            Label(verdict.title, systemImage: verdict.icon)
                .font(.title.weight(.bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity)
                .background(verdict.tint.gradient, in: .capsule)
            Button(action: onDismiss) {
                Text("Понятно").font(.headline).frame(maxWidth: .infinity)
            }
            .buttonStyle(.solidProminent(.capsule))
            .controlSize(.large)
        }
        .onAppear { isShown = true }
        .sensoryFeedback(.success, trigger: isShown)
    }
}

// MARK: - Итог ночи

/// Убитый ночью игрок: место и имя.
struct AnnouncedVictim: Identifiable, Equatable {
    let seat: Seat
    let name: String
    var id: Seat { seat }
}

/// Утро после ночи с убийством: кого убили. Лучший ход и заключительная минута — только по «Далее»,
/// чтобы ведущий сначала объявил столу, кто убит.
struct NightVictimsOverlay: View {
    let victims: [AnnouncedVictim]
    /// Что будет после «Далее»: «Лучший ход №5», «Заключительная речь №5».
    let nextStep: String
    let onContinue: () -> Void

    var body: some View {
        AnnouncementCard(onBackgroundTap: nil) {
            Label(victims.count > 1 ? "Ночью убиты" : "Ночью убит", systemImage: "moon.stars.fill")
                .font(.headline)
                .foregroundStyle(.secondary)
            ForEach(victims) { SeatNumberTitle(seat: $0.seat, name: $0.name) }
            VStack(spacing: 6) {
                Button(action: onContinue) {
                    HStack(spacing: 6) {
                        Text("Далее")
                        Image(systemName: "chevron.forward")
                    }
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.solidProminent(.capsule))
                .controlSize(.large)
                Text(nextStep).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .sensoryFeedback(.warning, trigger: victims)
    }
}

/// Крупный номер и имя под ним — в объявлениях поверх экрана.
private struct SeatNumberTitle: View {
    let seat: Seat
    let name: String

    var body: some View {
        VStack(spacing: 2) {
            Text("№\(seat.number)")
                .font(.system(size: 60, weight: .heavy, design: .rounded))
                .monospacedDigit()
            Text(name).font(.title3.weight(.semibold)).lineLimit(1)
        }
    }
}

/// Карточка поверх затемнённого экрана: результат проверки, итог ночи.
private struct AnnouncementCard<Content: View>: View {
    /// Касание вокруг карточки. `nil` — закрывается только кнопкой.
    let onBackgroundTap: (() -> Void)?
    @ViewBuilder let content: Content

    var body: some View {
        ZStack {
            Rectangle()
                .fill(.black.opacity(0.4))
                .ignoresSafeArea()
                .onTapGesture { onBackgroundTap?() }
            VStack(spacing: 16) { content }
                .padding(24)
                .frame(maxWidth: 360)
                .glassEffect(.regular, in: .rect(cornerRadius: 34, style: .continuous))
                .padding(.horizontal, 24)
        }
        .accessibilityAddTraits(.isModal)
    }
}
