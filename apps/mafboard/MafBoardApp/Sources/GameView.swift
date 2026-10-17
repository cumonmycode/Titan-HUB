import Foundation
import Observation
import SwiftUI
import UIKit
import MafBoardCore

// MARK: - Идущая игра

/// Игра, которую ведёт ведущий: сессия движка + профили игроков + таймер текущего шага.
/// После каждого действия игра сохраняется на диск — закрытие приложения её не теряет.
@Observable @MainActor
final class GameController: Identifiable {
    let id: GameID
    private(set) var session: GameSession
    let players: [PlayerProfile]
    private(set) var countdown: Countdown?
    /// Результат проверки дона или шерифа — показываем ведущему сразу после ввода.
    var checkResult: NightCheck?
    var errorMessage: String?
    var showsRoles = false
    /// Сохранить идущую игру (на телефоне и затем на сервере).
    @ObservationIgnored var onSave: ((GameSession, [PlayerProfile]) -> Void)?
    @ObservationIgnored var onFinish: ((GameRecord, [PlayerProfile]) -> Void)?
    @ObservationIgnored var onReopen: ((GameID) -> Void)?

    init(session: GameSession, players: [PlayerProfile]) {
        id = session.setup.gameID
        self.session = session
        self.players = players
        resetTimer()
    }

    var state: GameState { session.state }

    func profile(at seat: Seat) -> PlayerProfile? {
        guard let playerID = state.seat(seat)?.playerID else { return nil }
        return players.first { $0.id == playerID }
    }

    func name(of seat: Seat) -> String {
        profile(at: seat)?.nickname ?? "Игрок \(seat)"
    }

    func perform(_ action: GameAction) {
        let step = state.currentStep
        let wasFinished = state.isFinished
        do throws(GameError) {
            try session.perform(action)
        } catch {
            errorMessage = error.message
            return
        }
        if case .night(.check) = action, case let .check(check)? = state.events.last(where: \.isCheck)?.kind {
            checkResult = check
        }
        if state.currentStep != step { resetTimer() }
        save()
        // Законченная игра (и любые правки после конца — доп. баллы, лучший ход) — в историю и на сервер.
        if state.isFinished, let record { onFinish?(record, players) }
    }

    func undo() {
        let step = state.currentStep
        let wasFinished = state.isFinished
        do throws(GameError) {
            try session.undo()
        } catch {
            errorMessage = error.message
            return
        }
        if state.currentStep != step { resetTimer() }
        if wasFinished, !state.isFinished { onReopen?(id) }
        if state.isFinished, let record { onFinish?(record, players) }
        save()
    }

    /// Вернуть удалённого игрока: удаление уходит из журнала вместе с последствиями.
    func reinstate(_ seat: Seat) {
        let step = state.currentStep
        let wasFinished = state.isFinished
        do throws(GameError) {
            try session.reinstate(seat)
        } catch {
            errorMessage = error.message
            return
        }
        if state.currentStep != step { resetTimer() }
        if wasFinished, !state.isFinished { onReopen?(id) }
        save()
    }

    // MARK: Подсказки для «Назад» и «Далее»

    /// Куда ведёт «Далее»: заголовок следующего шага.
    var nextHint: String {
        if state.isFinished { return "К списку игр" }
        guard state.canAdvance else { return "Сначала подсчитайте голоса" }
        guard let next = try? GameEngine.apply(.advance, to: state, at: .now) else { return "" }
        return next.currentStep.title(in: next)
    }

    /// Что отменит «Назад».
    var backHint: String {
        guard let last = session.log.last?.action else { return "Нечего отменять" }
        if case .advance = last,
           let previous = try? GameSession.replay(setup: session.setup, log: Array(session.log.dropLast())) {
            return "к «\(previous.currentStep.title(in: previous))»"
        }
        return "отменить \(last.undoLabel)"
    }

    // MARK: Таймер

    func toggleTimer() {
        guard var timer = countdown else { return }
        if timer.isRunning { timer.pause(at: .now) } else { timer.start(at: .now) }
        countdown = timer
    }

    func extendTimer() {
        countdown?.extend(bySeconds: 30)
    }

    func restartTimer() {
        resetTimer()
    }

    private func resetTimer() {
        countdown = state.timerSeconds.map(Countdown.init(seconds:))
    }

    // MARK: Итоги

    var record: GameRecord? {
        try? GameRecord(session: session)
    }

    /// Законченную игру хранит история, идущую — телефон и сервер.
    private func save() {
        guard !state.isFinished else { return }
        onSave?(session, players)
    }
}

private extension GameEvent {
    var isCheck: Bool {
        if case .check = kind { true } else { false }
    }
}

private extension GameAction {
    /// «фол №3», «выставление №5» — для подписи кнопки «Назад».
    var undoLabel: String {
        switch self {
        case .advance: "шаг"
        case let .nominate(candidate, _): "выставление №\(candidate)"
        case .withdrawNomination: "снятие кандидатуры"
        case .submitBallot: "голосование"
        case let .night(input):
            switch input {
            case .shot: "выстрел"
            case .check: "проверку"
            case .heal: "лечение"
            case .skip: "пропуск"
            }
        case let .foul(seat): "фол №\(seat)"
        case let .cancelFoul(seat): "снятие фола №\(seat)"
        case let .techFoul(seat): "техфол №\(seat)"
        case let .cancelTechFoul(seat): "снятие техфола №\(seat)"
        case let .warning(seat): "предупреждение №\(seat)"
        case let .disqualify(seat, _): "удаление №\(seat)"
        case let .eliminateByHost(seat, _): "выбывание №\(seat)"
        case .recordBestMove: "лучший ход"
        case .declareOutcome: "итог игры"
        case .adjustScore: "баллы"
        }
    }
}

// MARK: - Экран игры

struct GameScreen: View {
    @Bindable var game: GameController
    /// «Следующая игра» вечера с экрана итогов. `nil` — вечер уже закрыт.
    var onNextGame: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var isShowingLog = false
    /// Раскрытые карточки: говорящий раскрыт всегда, остальные — по касанию, независимо друг от друга.
    @State private var expanded: Set<Seat> = []
    @State private var isPickingBestMove = false

    private var state: GameState { game.state }

    private var isNight: Bool {
        switch state.phase {
        case .night, .nightZero: true
        default: false
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    PhaseHeader(game: game) { isPickingBestMove = true }
                    stepContent
                    if !state.isFinished {
                        VStack(spacing: 8) {
                            ForEach(state.seats) { seat in
                                PlayerCard(game: game, seat: seat, isExpanded: expanded.contains(seat.seat)) {
                                    withAnimation(.snappy) {
                                        if expanded.contains(seat.seat) { expanded.remove(seat.seat) } else { expanded.insert(seat.seat) }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 16)
            }
            .ambientBackground(mood: isNight ? .night : .accent)
            .navigationTitle(state.moment.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .safeAreaInset(edge: .bottom) { StepBar(game: game) { dismiss() } }
            .onChange(of: state.currentSpeaker, initial: true) { previous, speaker in
                withAnimation(.snappy) {
                    if let previous, previous != speaker { expanded.remove(previous) }
                    if let speaker { expanded.insert(speaker) }
                }
            }
            .sheet(isPresented: $isPickingBestMove) { BestMoveSheet(game: game) }
            .sheet(isPresented: $isShowingLog) {
                NavigationStack {
                    GameLogView(events: game.state.events) { game.name(of: $0) }
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Готово", systemImage: "checkmark") { isShowingLog = false }
                            }
                        }
                }
                .presentationDetents([.medium, .large])
            }
            .alert("Ошибка", isPresented: Binding(get: { game.errorMessage != nil }, set: { if !$0 { game.errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(game.errorMessage ?? "")
            }
            .alert(
                game.checkResult.map { "\($0.checker.displayName) проверил №\($0.target)" } ?? "",
                isPresented: Binding(get: { game.checkResult != nil }, set: { if !$0 { game.checkResult = nil } })
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(game.checkResult.map(\.verdict) ?? "")
            }
        }
        .connectionIndicator()
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch state.currentStep {
        case let .ballot(candidates, kind):
            VotingPanel(game: game, candidates: candidates, kind: kind)
                .id("\(candidates)|\(kind.rawValue)")
        case let .liftBallot(candidates):
            LiftPanel(game: game, candidates: candidates)
        case let .timed(_, speaker) where speaker == nil:
            TimerView(game: game).gameCard()
        case let .night(step):
            NightPanel(game: game, step: step)
        case .finished:
            if let record = game.record {
                ResultsCard(
                    game: game, record: record,
                    onBestMove: { isPickingBestMove = true },
                    onNextGame: onNextGame.map { next in { next(); dismiss() } }
                )
            }
        default:
            EmptyView()
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Закрыть", systemImage: "xmark") { dismiss() }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button("Ход игры", systemImage: "list.bullet.rectangle.portrait") { isShowingLog = true }
            Button(game.showsRoles ? "Скрыть роли" : "Показать роли", systemImage: game.showsRoles ? "eye.slash" : "eye") {
                game.showsRoles.toggle()
            }
            Menu("Ещё", systemImage: "ellipsis") {
                if state.bestMoveAuthor != nil, state.bestMove == nil {
                    Button("Лучший ход", systemImage: "star") { isPickingBestMove = true }
                }
                Section("Завершить вручную") {
                    ForEach([Winner.red, .black, .draw], id: \.self) { winner in
                        Button(winner.displayName) { game.perform(.declareOutcome(winner, note: nil)) }
                    }
                }
            }
            .disabled(state.isFinished)
        }
    }
}

// MARK: - Шаги: «Назад» и «Далее»

/// Кнопки шагов внизу: «Назад» отменяет последнее действие, «Далее» ведёт к следующему шагу.
/// Под каждой — короткая подпись, что именно произойдёт.
private struct StepBar: View {
    let game: GameController
    let onFinish: () -> Void

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    game.undo()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.backward").font(.subheadline.weight(.bold))
                        VStack(alignment: .leading, spacing: 0) {
                            Text("Назад").font(.subheadline.weight(.semibold))
                            Text(game.backHint).font(.caption2).lineLimit(1).opacity(0.75)
                        }
                    }
                    .frame(maxWidth: 130, alignment: .leading)
                }
                .buttonStyle(.glass)
                .disabled(!game.session.canUndo)

                Button {
                    if game.state.isFinished { onFinish() } else { game.perform(.advance) }
                } label: {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text(game.state.isFinished ? "Готово" : "Далее").font(.subheadline.weight(.semibold))
                            Text(game.nextHint).font(.caption2).lineLimit(1).opacity(0.85)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: game.state.isFinished ? "checkmark" : "chevron.forward")
                            .font(.subheadline.weight(.bold))
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .disabled(!game.state.canAdvance && !game.state.isFinished)
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
    }
}

private extension NightCheck {
    var verdict: String {
        switch checker {
        case .don: isPositive ? "Это шериф" : "Не шериф"
        default: isPositive ? "Чёрный 👎" : "Красный 👍"
        }
    }
}
