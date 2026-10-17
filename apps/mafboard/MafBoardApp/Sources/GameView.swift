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
    /// Таймер сам запускается на каждой речи. Настройка ведущего — общая для всех игр.
    private(set) var autoStartsTimer = TimerSettings.autoStart
    /// Время вышло — через пару секунд следующая речь (и её таймер).
    private(set) var autoAdvances = TimerSettings.autoAdvance
    @ObservationIgnored private var expiryTask: Task<Void, Never>?
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
        restoreTimer()
    }

    var state: GameState { session.state }

    func profile(at seat: Seat) -> PlayerProfile? {
        guard let playerID = state.seat(seat)?.playerID else { return nil }
        return players.first { $0.id == playerID }
    }

    func name(of seat: Seat) -> String {
        profile(at: seat)?.nickname ?? "Игрок \(seat)"
    }

    /// Возвращает `false`, если движок отклонил действие (ошибка уже показана ведущему).
    @discardableResult
    func perform(_ action: GameAction) -> Bool {
        let step = state.currentStep
        do throws(GameError) {
            try session.perform(action)
        } catch {
            errorMessage = error.message
            return false
        }
        if case .night(.check) = action, case let .check(check)? = state.events.last(where: \.isCheck)?.kind {
            checkResult = check
        }
        if state.currentStep != step {
            resetTimer()
        } else if action.isBestMove {
            // Лучший ход записан — пошла заключительная минута.
            startTimerIfAuto()
        }
        save()
        // Законченная игра (и любые правки после конца — доп. баллы, лучший ход) — в историю и на сервер.
        if state.isFinished, let record { onFinish?(record, players) }
        return true
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
        timerChanged()
    }

    func extendTimer() {
        countdown?.extend(bySeconds: 30)
        timerChanged()
    }

    /// Заново с полного времени — и сразу идёт.
    func restartTimer() {
        countdown = state.timerSeconds.map(Countdown.init(seconds:))
        countdown?.start(at: .now)
        timerChanged()
    }

    func setAutoStart(_ isOn: Bool) {
        autoStartsTimer = isOn
        TimerSettings.autoStart = isOn
    }

    func setAutoAdvance(_ isOn: Bool) {
        autoAdvances = isOn
        TimerSettings.autoAdvance = isOn
        scheduleExpiry()
    }

    /// Новый шаг — свой таймер. С автозапуском он сразу идёт; на заключительной речи с невписанным ЛХ —
    /// ждёт ЛХ: по правилам его записывают до минуты.
    private func resetTimer() {
        countdown = state.timerSeconds.map(Countdown.init(seconds:))
        if autoStartsTimer, !isWaitingForBestMove { countdown?.start(at: .now) }
        timerChanged()
    }

    private func startTimerIfAuto() {
        guard autoStartsTimer, var timer = countdown, !timer.isRunning, timer.elapsed(at: .now) == 0 else { return }
        timer.start(at: .now)
        countdown = timer
        timerChanged()
    }

    private var isWaitingForBestMove: Bool {
        if case let .farewell(seat) = state.currentStep { state.awaitsBestMove(from: seat) } else { false }
    }

    /// Экран игры открыт заново или приложение перезапущено — время текущей речи продолжается.
    private func restoreTimer() {
        guard state.timerSeconds != nil, let saved = TimerStore.load(gameID: id, step: timerStepKey) else {
            resetTimer()
            return
        }
        countdown = saved
        scheduleExpiry()
    }

    /// Шаг, к которому относится сохранённое время: «День 2|speech(5)».
    private var timerStepKey: String { "\(state.moment.displayName)|\(state.currentStep)" }

    private func timerChanged() {
        if let countdown, !state.isFinished {
            TimerStore.save(countdown, gameID: id, step: timerStepKey)
        } else {
            TimerStore.clear(gameID: id)
        }
        scheduleExpiry()
    }

    /// «Дальше по окончании»: когда время выйдет (и ещё пара секунд), игра сама идёт к следующему шагу.
    private func scheduleExpiry() {
        expiryTask?.cancel()
        expiryTask = nil
        guard autoAdvances, let timer = countdown, timer.isRunning else { return }
        let delay = timer.remaining(at: .now) + TimerSettings.advanceGrace
        let step = state.currentStep
        expiryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.advanceAfterExpiry(from: step)
        }
    }

    private func advanceAfterExpiry(from step: CurrentStep) {
        guard autoAdvances, state.currentStep == step, state.canAdvance,
              let timer = countdown, timer.isRunning, timer.isExpired(at: .now)
        else { return }
        perform(.advance)
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
    var isBestMove: Bool {
        switch self {
        case .recordBestMove, .recordBestMoveBy: true
        default: false
        }
    }

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
        case let .bigTechFoul(seat): "большой техфол №\(seat)"
        case let .cancelTechFoul(seat): "снятие техфола №\(seat)"
        case let .warning(seat): "предупреждение №\(seat)"
        case let .disqualify(seat, _): "удаление №\(seat)"
        case let .eliminateByHost(seat, _): "выбывание №\(seat)"
        case let .markCriticalRemoval(seat, _): "«на критике» №\(seat)"
        case let .markSheriffClaim(seat, _): "вскрытие №\(seat)"
        case .forfeit: "ППК"
        case .recordBestMove, .recordBestMoveBy: "лучший ход"
        case let .recordProtocol(proto): "протокол №\(proto.author)"
        case .declareOutcome: "итог игры"
        case .adjustScore, .setScoreAdjustments: "баллы"
        }
    }
}

// MARK: - Экран игры

struct GameScreen: View {
    @Bindable var game: GameController
    /// «Ещё одна игра» серии с экрана итогов. `nil` — серия уже закрыта.
    var onNextGame: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var isShowingLog = false
    /// Раскрытые карточки: говорящий раскрыт всегда, остальные — по касанию, независимо друг от друга.
    @State private var expanded: Set<Seat> = []
    @State private var bestMovePick: SeatPick?
    @State private var protocolPick: SeatPick?
    @State private var forfeitPick: SeatPick?

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
                    PhaseHeader(game: game) { bestMovePick = SeatPick(seat: $0) }
                    stepContent
                    if !state.isFinished {
                        VStack(spacing: 8) {
                            ForEach(state.seats) { seat in
                                PlayerCard(
                                    game: game, seat: seat, isExpanded: expanded.contains(seat.seat),
                                    onToggle: {
                                        withAnimation(.snappy) {
                                            if expanded.contains(seat.seat) { expanded.remove(seat.seat) } else { expanded.insert(seat.seat) }
                                        }
                                    },
                                    onBestMove: { bestMovePick = SeatPick(seat: seat.seat) },
                                    onProtocol: { protocolPick = SeatPick(seat: seat.seat) }
                                )
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
            // Лучший ход записывают перед заключительной минутой — лист открывается сам.
            .onChange(of: state.currentStep, initial: true) { _, step in
                if case let .farewell(seat) = step, state.awaitsBestMove(from: seat) {
                    bestMovePick = SeatPick(seat: seat)
                }
            }
            .sheet(item: $bestMovePick) { BestMoveSheet(game: game, author: $0.seat) }
            .sheet(item: $protocolPick) { ProtocolSheet(game: game, author: $0.seat) }
            .confirmationDialog(
                forfeitPick.map { "ППК: нарушение №\($0.seat) \(game.name(of: $0.seat))?" } ?? "",
                isPresented: Binding(get: { forfeitPick != nil }, set: { if !$0 { forfeitPick = nil } }),
                titleVisibility: .visible,
                presenting: forfeitPick
            ) { pick in
                Button("Присудить поражение команде (\((-(state.setup.scoring.forfeitPenalty ?? .zero)).signed))", role: .destructive) {
                    game.perform(.forfeit(pick.seat, note: nil))
                }
            } message: { pick in
                let team = state.seat(pick.seat)?.team == .black ? "чёрных" : "красных"
                Text("Клятва, пари, шантаж, подсказки из зала — команда \(team) проигрывает (ФСМ 6.9).")
            }
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
            Group {
                if state.ruleset.voting.ballotStyle == .handCount {
                    CountVotingPanel(game: game, candidates: candidates, kind: kind)
                } else {
                    VotingPanel(game: game, candidates: candidates, kind: kind)
                }
            }
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
                    onBestMove: { bestMovePick = SeatPick(seat: $0) },
                    onProtocol: { protocolPick = SeatPick(seat: $0) },
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
                ForEach(state.pendingBestMoveAuthors, id: \.self) { author in
                    Button("Лучший ход №\(author)", systemImage: "star") { bestMovePick = SeatPick(seat: author) }
                }
                let protocolAuthors = state.seats.map(\.seat).filter(state.mayLeaveProtocol)
                if !protocolAuthors.isEmpty {
                    Menu("Протокол", systemImage: "list.clipboard") {
                        ForEach(protocolAuthors, id: \.self) { author in
                            Button("№\(author) \(game.name(of: author))") { protocolPick = SeatPick(seat: author) }
                        }
                    }
                }
                Menu("ППК", systemImage: "exclamationmark.octagon") {
                    ForEach(state.seats) { seat in
                        Button("№\(seat.seat) \(game.name(of: seat.seat))") { forfeitPick = SeatPick(seat: seat.seat) }
                    }
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
