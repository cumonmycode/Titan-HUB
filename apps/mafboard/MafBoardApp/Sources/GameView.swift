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

    /// Игрок, чья карточка раскрыта: говорит сейчас (речь, прощальная, оправдание, добор).
    var expandedSeat: Seat? { state.currentSpeaker }

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
        if !wasFinished, state.isFinished, let record { onFinish?(record, players) }
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
        save()
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

    /// Законченную игру хранит история, идущую — файл текущей игры.
    private func save() {
        guard !state.isFinished else { return }
        do {
            try SavedGameStore.save(SavedGame(session: session, players: players))
        } catch {
            errorMessage = "Игра не сохранилась на устройстве: \(error.localizedDescription)"
        }
    }
}

private extension GameEvent {
    var isCheck: Bool {
        if case .check = kind { true } else { false }
    }
}

// MARK: - Экран игры

struct GameScreen: View {
    @Bindable var game: GameController
    @Environment(\.dismiss) private var dismiss
    @State private var isPickingBestMove = false

    var body: some View {
        NavigationStack {
            List {
                PhaseSection(game: game) { isPickingBestMove = true }
                if let speaker = game.expandedSeat, let seat = game.state.seat(speaker) {
                    SpeakerSection(game: game, seat: seat)
                }
                Section("Игроки") {
                    ForEach(game.state.seats) { SeatRow(game: game, seat: $0) }
                }
            }
            .listSectionSpacing(.compact)
            .animation(.snappy, value: game.expandedSeat)
            .navigationTitle(game.state.moment.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .sheet(isPresented: $isPickingBestMove) { BestMoveSheet(game: game) }
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
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Закрыть", systemImage: "xmark") { dismiss() }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button(game.showsRoles ? "Скрыть роли" : "Показать роли", systemImage: game.showsRoles ? "eye.slash" : "eye") {
                game.showsRoles.toggle()
            }
            Menu("Ещё", systemImage: "ellipsis") {
                Section("Завершить вручную") {
                    ForEach([Winner.red, .black, .draw], id: \.self) { winner in
                        Button(winner.displayName) { game.perform(.declareOutcome(winner, note: nil)) }
                    }
                }
            }
            .disabled(game.state.isFinished)
        }
        ToolbarItem(placement: .bottomBar) {
            Button("Отменить", systemImage: "arrow.uturn.backward") { game.undo() }
                .disabled(!game.session.canUndo)
        }
        ToolbarSpacer(.flexible, placement: .bottomBar)
        ToolbarItem(placement: .bottomBar) {
            if game.state.isFinished {
                Button("Готово", systemImage: "checkmark") { dismiss() }
                    .labelStyle(.titleAndIcon)
                    .buttonStyle(.glassProminent)
            } else {
                Button("Далее", systemImage: "forward.fill") { game.perform(.advance) }
                    .labelStyle(.titleAndIcon)
                    .buttonStyle(.glassProminent)
                    .disabled(!game.state.canAdvance)
            }
        }
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
