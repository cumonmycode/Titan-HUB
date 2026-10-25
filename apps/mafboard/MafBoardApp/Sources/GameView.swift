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
    /// Что отменит «Назад» и куда ведёт «Далее» — подписи под кнопками шагов.
    private(set) var backHint = ""
    private(set) var nextHint = ""
    /// Сохранить идущую игру (на телефоне и затем на сервере).
    @ObservationIgnored var onSave: ((GameSession, [PlayerProfile]) -> Void)?
    @ObservationIgnored var onFinish: ((GameRecord, [PlayerProfile]) -> Void)?
    @ObservationIgnored var onReopen: ((GameID) -> Void)?

    init(session: GameSession, players: [PlayerProfile]) {
        id = session.setup.gameID
        self.session = session
        self.players = players
        restoreTimer()
        refreshHints()
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
        let stepTitle = step.title(in: state)
        do throws(GameError) {
            try session.perform(action)
        } catch {
            errorMessage = error.message
            return false
        }
        refreshHints(stepBefore: stepTitle)
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
        let undone: GameAction
        do throws(GameError) {
            undone = try session.undo()
        } catch {
            errorMessage = error.message
            return
        }
        refreshHints()
        if state.currentStep != step {
            resetTimer()
        } else if case .extraTime = undone {
            // Отменили «+30» — время речи возвращается к прежнему.
            countdown?.extend(bySeconds: -state.ruleset.discipline.extraTimeRule.seconds)
            timerChanged()
        }
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
        refreshHints()
        if state.currentStep != step { resetTimer() }
        if wasFinished, !state.isFinished { onReopen?(id) }
        save()
    }

    // MARK: Подсказки для «Назад» и «Далее»

    /// Подсказки считаются один раз после хода, а не при каждой перерисовке: для «Назад» после «Далее»
    /// раньше заново проигрывалась вся партия — на каждой перерисовке панели.
    private func refreshHints(stepBefore: String? = nil) {
        let next = Self.nextHint(for: state)
        let back = Self.backHint(for: session, stepBefore: stepBefore)
        if next != nextHint { nextHint = next }
        if back != backHint { backHint = back }
    }

    /// Куда ведёт «Далее»: заголовок следующего шага.
    private static func nextHint(for state: GameState) -> String {
        if state.isFinished { return "К списку игр" }
        guard state.canAdvance else { return "Сначала подсчитайте голоса" }
        guard let next = try? GameEngine.apply(.advance, to: state, at: .now) else { return "" }
        return next.currentStep.title(in: next)
    }

    /// Что отменит «Назад». `stepBefore` — заголовок шага до только что сделанного «Далее»: тогда партию не переигрываем.
    private static func backHint(for session: GameSession, stepBefore: String?) -> String {
        guard let last = session.log.last?.action else { return "Нечего отменять" }
        guard case .advance = last else { return "отменить \(last.undoLabel)" }
        if let stepBefore { return "к «\(stepBefore)»" }
        guard let previous = try? GameSession.replay(setup: session.setup, log: Array(session.log.dropLast())) else { return "" }
        return "к «\(previous.currentStep.title(in: previous))»"
    }

    // MARK: Таймер

    func toggleTimer() {
        guard var timer = countdown else { return }
        if timer.isRunning { timer.pause(at: .now) } else { timer.start(at: .now) }
        countdown = timer
        timerChanged()
    }

    /// «+30 за 2 фола» говорящему: `nil` — на этом шаге не положено.
    var extraTimeOffer: ExtraTimeOffer? {
        guard let speaker = state.currentSpeaker, state.timerSeconds != nil else { return nil }
        return ExtraTimeOffer(policy: state.ruleset.discipline.extraTimeRule, isAllowed: state.canTakeExtraTime(speaker))
    }

    /// Говорящий берёт время фолами. Если время уже вышло, таймер снова идёт.
    func takeExtraTime() {
        guard let speaker = state.currentSpeaker else { return }
        let policy = state.ruleset.discipline.extraTimeRule
        let wasOver = countdown.map { !$0.isRunning && $0.isExpired(at: .now) } ?? false
        guard perform(.extraTime(speaker)) else { return }
        countdown?.extend(bySeconds: policy.seconds)
        if wasOver { countdown?.start(at: .now) }
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

    /// Старые правила: ЛХ записывают во время заключительной речи, и таймер ждёт его. В новых ЛХ — отдельный шаг до речи.
    private var isWaitingForBestMove: Bool {
        guard state.ruleset.farewell == nil, case let .farewell(seat) = state.currentStep else { return false }
        return state.awaitsBestMove(from: seat)
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
        storeTimer()
        scheduleExpiry()
    }

    private func storeTimer() {
        if let countdown, !state.isFinished {
            TimerStore.save(countdown, gameID: id, step: timerStepKey)
        } else {
            TimerStore.clear(gameID: id)
        }
    }

    /// Время выйдет — таймер встанет на нуле. С «Дальше по окончании» через пару секунд — следующий шаг.
    private func scheduleExpiry() {
        expiryTask?.cancel()
        expiryTask = nil
        guard let timer = countdown else { return }
        let step = state.currentStep
        if timer.isRunning {
            let delay = timer.remaining(at: .now)
            expiryTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(delay))
                guard !Task.isCancelled else { return }
                self?.timerRanOut(on: step)
            }
        } else if timer.isExpired(at: .now) {
            scheduleAdvance(from: step)
        }
    }

    private func timerRanOut(on step: CurrentStep) {
        guard state.currentStep == step, var timer = countdown, timer.isRunning else { return }
        // Проснулись чуть раньше, чем вышло время, — ждём остаток.
        guard timer.isExpired(at: .now) else {
            scheduleExpiry()
            return
        }
        timer.finish()
        countdown = timer
        storeTimer()
        scheduleAdvance(from: step)
    }

    private func scheduleAdvance(from step: CurrentStep) {
        guard autoAdvances else { return }
        expiryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(TimerSettings.advanceGrace))
            guard !Task.isCancelled else { return }
            self?.advanceAfterExpiry(from: step)
        }
    }

    private func advanceAfterExpiry(from step: CurrentStep) {
        guard autoAdvances, state.currentStep == step, state.canAdvance,
              let timer = countdown, !timer.isRunning, timer.isExpired(at: .now)
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

/// «+30 за 2 фола» на текущей речи: правила и можно ли взять сейчас.
struct ExtraTimeOffer {
    let policy: ExtraTimePolicy
    let isAllowed: Bool
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
            case .miss: "промах"
            case .check: "проверку"
            case .heal: "лечение"
            case .skip: "пропуск"
            }
        case let .extraTime(seat): "+30 сек №\(seat)"
        case let .foul(seat): "фол №\(seat)"
        case let .cancelFoul(seat): "снятие фола №\(seat)"
        case let .techFoul(seat): "МТФ №\(seat)"
        case let .bigTechFoul(seat): "БТФ №\(seat)"
        case let .cancelTechFoul(seat): "снятие техфола №\(seat)"
        case let .warning(seat): "предупреждение №\(seat)"
        case let .disqualify(seat, _): "удаление №\(seat)"
        case let .eliminateByHost(seat, _): "выбывание №\(seat)"
        case let .markCriticalRemoval(seat, _): "отметку удаления №\(seat)"
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
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var isShowingLog = false
    /// iPhone: раскрытые карточки. Говорящий раскрыт всегда, остальные — по касанию, независимо друг от друга.
    @State private var expanded: Set<Seat> = []
    /// iPad: игрок в пульте, выбранный касанием на столе. `nil` — пульт следит за говорящим.
    @State private var focusedSeat: Seat?
    @State private var bestMovePick: SeatPick?
    @State private var protocolPick: SeatPick?
    @State private var forfeitPick: SeatPick?
    /// Утро после ночи с убийством: сначала объявление «Ночью убит», лист лучшего хода — по «Далее» в нём.
    @State private var nightVictims: [AnnouncedVictim]?
    @State private var scrollTask: Task<Void, Never>?

    private var state: GameState { game.state }

    private var isNight: Bool {
        switch state.phase {
        case .night, .nightZero: true
        default: false
        }
    }

    /// Широкое окно (iPad): стол и пульт рядом. Узкое (iPhone, iPad в узком Split View) — один список.
    private var usesTable: Bool { sizeClass == .regular }

    var body: some View {
        NavigationStack {
            Group {
                if usesTable { tableLayout } else { listLayout }
            }
            .ambientBackground(mood: isNight ? .night : .accent)
            .navigationTitle(state.moment.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .onChange(of: state.currentSpeaker, initial: true) { previous, speaker in
                focusedSeat = nil
                withAnimation(.snappy(duration: 0.2)) {
                    if let previous, previous != speaker { expanded.remove(previous) }
                    if let speaker { expanded.insert(speaker) }
                }
            }
            .onChange(of: state.currentStep, initial: true) { previous, step in
                // Новый шаг — пульт iPad снова у того, кто сейчас на шаге (говорящий, выбывший на заключительной минуте).
                focusedSeat = nil
                // Ночь кончилась убийством — сначала объявляем, кого убили; лучший ход — потом, по «Далее».
                if previous.isNight, !step.isNight, let report = state.morningReport, !report.victims.isEmpty {
                    nightVictims = report.victims.map { AnnouncedVictim(seat: $0.seat, name: game.name(of: $0.seat)) }
                } else if nightVictims == nil {
                    // Пока висит объявление ночи, листы не открываем: нужный откроет «Далее» в объявлении.
                    presentFarewellSheet(for: step)
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
            } message: { _ in
                // Команду не называем: экран ведущего видят за столом.
                Text("Клятва, пари, шантаж, подсказки из зала — команда нарушителя проигрывает (ФСМ 6.9).")
            }
            .sheet(isPresented: $isShowingLog) {
                NavigationStack {
                    GameLogView(events: game.state.events, revealsRoles: game.showsRoles || state.isFinished) { game.name(of: $0) }
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Готово", systemImage: "checkmark") { isShowingLog = false }
                            }
                        }
                }
                .phoneDetents([.medium, .large])
            }
            .alert("Ошибка", isPresented: Binding(get: { game.errorMessage != nil }, set: { if !$0 { game.errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(game.errorMessage ?? "")
            }
        }
        // Результат проверки и итог ночи — крупной карточкой поверх экрана, а не системным окном.
        // Анимация — только у карточки: раньше она висела на всём экране, и ход после проверки пружинил целиком.
        .overlay {
            ZStack { announcements }
                .animation(.snappy(duration: 0.25), value: game.checkResult)
                .animation(.snappy(duration: 0.25), value: nightVictims)
        }
        .connectionIndicator()
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    // MARK: iPhone: один список

    private var listLayout: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    PhaseHeader(game: game) { bestMovePick = SeatPick(seat: $0) }
                        .id(ScrollTarget.top)
                    stepContent(isLarge: false)
                    if !state.isFinished {
                        VStack(spacing: 8) {
                            ForEach(state.seats) { seat in
                                PlayerCard(
                                    game: game, seat: seat, isExpanded: expanded.contains(seat.seat),
                                    onToggle: {
                                        withAnimation(.snappy(duration: 0.25)) {
                                            if expanded.contains(seat.seat) { expanded.remove(seat.seat) } else { expanded.insert(seat.seat) }
                                        }
                                    },
                                    onBestMove: { bestMovePick = SeatPick(seat: seat.seat) },
                                    onProtocol: { protocolPick = SeatPick(seat: seat.seat) }
                                )
                                .id(ScrollTarget.seat(seat.seat))
                            }
                        }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 16)
            }
            // Новый шаг — экран сам едет к нему: к карточке говорящего или наверх (ночь, голосование, итоги).
            .onChange(of: state.currentStep, initial: true) { _, _ in
                scrollToActiveStep(proxy)
            }
        }
        .safeAreaInset(edge: .bottom) { StepBar(game: game) { dismiss() } }
    }

    /// Докручиваем к говорящему, когда карточка прошлого говорящего уже свернулась (0.2 с): иначе цель
    /// считается по старым размерам и новая карточка уезжает выше края экрана.
    private func scrollToActiveStep(_ proxy: ScrollViewProxy) {
        let target = state.currentSpeaker.map(ScrollTarget.seat) ?? .top
        scrollTask?.cancel()
        scrollTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(200))
            guard !Task.isCancelled else { return }
            withAnimation(.snappy(duration: 0.3)) { proxy.scrollTo(target, anchor: .top) }
        }
    }

    // MARK: iPad: стол и пульт

    /// Слева стол — все игроки сразу, справа пульт: шаг, таймер, выставление и нарушения игрока, «Назад» и «Далее»
    /// под правой рукой. Ландшафт — стол в две колонки, портрет — в одну.
    private var tableLayout: some View {
        GeometryReader { proxy in
            let isLandscape = proxy.size.width >= 1100
            HStack(spacing: 0) {
                if !state.isFinished {
                    SeatTable(game: game, focused: focusTarget, columns: isLandscape ? 2 : 1) { seat in
                        // Касание говорящего или повторное касание выбранного — пульт снова у говорящего.
                        let current = state.currentSpeaker ?? state.currentStep.farewellSeat
                        focusedSeat = seat == current || focusTarget == seat ? nil : seat
                    }
                    .frame(width: isLandscape ? proxy.size.width * 0.52 : max(340, proxy.size.width * 0.42))
                }
                controlPane
            }
        }
    }

    private var controlPane: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 12) {
                    PhaseHeader(game: game) { bestMovePick = SeatPick(seat: $0) }
                        .id(ScrollTarget.top)
                    stepContent(isLarge: true)
                    if !state.isFinished {
                        speakerTimer
                        focusPanel
                    }
                }
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                .padding(.horizontal)
                .padding(.bottom, 16)
            }
            .onChange(of: state.currentStep) { _, _ in
                withAnimation(.snappy(duration: 0.3)) { proxy.scrollTo(ScrollTarget.top, anchor: .top) }
            }
        }
        .safeAreaInset(edge: .bottom) { StepBar(game: game) { dismiss() }.frame(maxWidth: 760) }
    }

    /// Игрок в пульте: выбранный на столе, иначе говорящий или выбывший на заключительной минуте. Ночью — никто.
    private var focusTarget: Seat? {
        guard !isNight else { return nil }
        return focusedSeat ?? state.currentSpeaker ?? state.currentStep.farewellSeat
    }

    /// Выбран не говорящий — таймер речи остаётся на виду над карточкой выбранного. Касание имени — пульт снова у говорящего.
    @ViewBuilder
    private var speakerTimer: some View {
        if let speaker = state.currentSpeaker, let target = focusTarget, target != speaker, game.countdown != nil {
            VStack(alignment: .leading, spacing: 10) {
                Button { focusedSeat = nil } label: {
                    Label("Говорит №\(speaker) \(game.name(of: speaker))", systemImage: "waveform")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.tint)
                TimerView(game: game)
            }
            .gameCard()
        }
    }

    @ViewBuilder
    private var focusPanel: some View {
        if let target = focusTarget, let seat = state.seat(target) {
            let context = SeatContext(game: game, seat: seat)
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    PlayerIdentity(context: context, avatarSize: 52)
                    Spacer(minLength: 4)
                    PenaltyMarks(fouls: seat.fouls, techFouls: seat.techFoulKinds)
                    if context.isRemoved { ReinstateButton(context: context) }
                    if focusedSeat != nil {
                        Button("К говорящему", systemImage: "xmark") { focusedSeat = nil }
                            .labelStyle(.iconOnly)
                            .font(.subheadline.weight(.bold))
                            .buttonStyle(.solid(.circle))
                    }
                }
                if context.isActive {
                    PlayerControls(
                        context: context, isLargeTimer: true,
                        onBestMove: { bestMovePick = SeatPick(seat: target) },
                        onProtocol: { protocolPick = SeatPick(seat: target) }
                    )
                }
            }
            .gameCard()
            .overlay {
                if context.isSpeaker {
                    RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.tint, lineWidth: 1.5)
                }
            }
            // Свой набор состояний у каждого игрока: вопросы об удалении не переезжают к другому.
            .id(target)
        } else if !isNight {
            Label("Нажмите на игрока на столе — фолы, техфолы и удаление.", systemImage: "hand.tap")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
        }
    }

    // MARK: Объявления и листы

    @ViewBuilder
    private var announcements: some View {
        if let check = game.checkResult {
            CheckResultOverlay(check: check, name: game.name(of: check.target)) { game.checkResult = nil }
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
        } else if let victims = nightVictims {
            NightVictimsOverlay(victims: victims, nextStep: farewellTitle) { continueAfterNight() }
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
        }
    }

    /// Подпись под «Далее» в объявлении ночи: что сейчас начнётся.
    private var farewellTitle: String {
        switch state.currentStep {
        case let .farewellBestMove(seat): "Лучший ход №\(seat)"
        case let .farewell(seat): "Заключительная речь №\(seat)"
        default: state.currentStep.title(in: state)
        }
    }

    /// Объявили, кого убили, — дальше лучший ход. Если заключительная речь уже пошла сама — время с начала.
    private func continueAfterNight() {
        nightVictims = nil
        presentFarewellSheet(for: state.currentStep)
        if case .farewell = state.currentStep, game.countdown?.isRunning == true { game.restartTimer() }
    }

    /// Лучший ход — до заключительной речи, протокол — после: листы открываются сами.
    private func presentFarewellSheet(for step: CurrentStep) {
        switch step {
        case let .farewellBestMove(seat):
            bestMovePick = SeatPick(seat: seat)
        case let .farewellProtocol(seat):
            protocolPick = SeatPick(seat: seat)
        case let .farewell(seat) where state.ruleset.farewell == nil && state.awaitsBestMove(from: seat):
            bestMovePick = SeatPick(seat: seat)
        default:
            break
        }
    }

    @ViewBuilder
    private func stepContent(isLarge: Bool) -> some View {
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
            TimerView(game: game, isLarge: isLarge).gameCard()
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
            .buttonStyle(.floating(.capsule))
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
            .buttonStyle(.solidProminent(.capsule))
            .disabled(!game.state.canAdvance && !game.state.isFinished)
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 6)
    }
}

/// Куда докручивать экран игры.
private enum ScrollTarget: Hashable {
    case top
    case seat(Seat)
}

private extension CurrentStep {
    var isNight: Bool {
        if case .night = self { true } else { false }
    }
}
