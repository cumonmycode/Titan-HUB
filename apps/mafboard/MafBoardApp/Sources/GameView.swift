import Foundation
import Observation
import SwiftUI
import UIKit
import MafBoardCore

// MARK: - Идущая игра

/// Игра, которую ведёт ведущий: сессия движка + имена игроков + таймер текущего шага.
/// После каждого действия игра сохраняется на диск — закрытие приложения её не теряет.
@Observable @MainActor
final class GameController {
    let id: GameID
    private(set) var session: GameSession
    let players: [PlayerProfile]
    private(set) var countdown: Countdown?
    /// Результат проверки дона или шерифа — показываем ведущему сразу после ввода.
    var checkResult: NightCheck?
    var errorMessage: String?
    var showsRoles = false

    init(session: GameSession, players: [PlayerProfile]) {
        id = session.setup.gameID
        self.session = session
        self.players = players
        resetTimer()
    }

    var state: GameState { session.state }

    func name(of seat: Seat) -> String {
        guard let playerID = state.seat(seat)?.playerID else { return "№\(seat)" }
        return players.first { $0.id == playerID }?.nickname ?? "№\(seat)"
    }

    func perform(_ action: GameAction) {
        let step = state.currentStep
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
    }

    func undo() {
        let step = state.currentStep
        do throws(GameError) {
            try session.undo()
        } catch {
            errorMessage = error.message
            return
        }
        if state.currentStep != step { resetTimer() }
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

    private func save() {
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

// MARK: - Сохранение текущей игры

struct SavedGame: Codable {
    let session: GameSession
    let players: [PlayerProfile]
}

enum SavedGameStore {
    private static var url: URL {
        URL.applicationSupportDirectory.appending(path: "current-game.json")
    }

    /// `nil` — сохранённой игры нет. Файл, который не читается (например, после смены движка),
    /// не удаляется молча: он откладывается рядом, а вызывающий получает ошибку.
    static func load() throws -> SavedGame? {
        guard FileManager.default.fileExists(atPath: url.path()) else { return nil }
        do {
            return try JSONDecoder().decode(SavedGame.self, from: Data(contentsOf: url))
        } catch {
            let backup = url.deletingLastPathComponent().appending(path: "unreadable-game-\(Int(Date.now.timeIntervalSince1970)).json")
            try? FileManager.default.moveItem(at: url, to: backup)
            throw error
        }
    }

    static func save(_ game: SavedGame) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(game).write(to: url, options: [.atomic, .completeFileProtection])
    }

    static func clear() {
        try? FileManager.default.removeItem(at: url)
    }
}

// MARK: - Новая игра

/// Вкладка «Игра»: продолжить сохранённую или начать новую (пока — тренировочную фанку).
struct GameHomeView: View {
    @State private var variant: GameVariant = .sport
    @State private var cityPlayers = 10
    @State private var game: GameController?
    @State private var saved: SavedGame?
    @State private var setupError: String?
    @State private var isConfirmingReplace = false

    private var playerCount: Int { variant == .sport ? 10 : cityPlayers }

    var body: some View {
        NavigationStack {
            Form {
                if let saved {
                    Section("Незавершённая игра") {
                        Button("Продолжить: \(saved.session.setup.variant.displayName), \(saved.session.state.moment.displayName)") {
                            game = GameController(session: saved.session, players: saved.players)
                        }
                        Button("Удалить", role: .destructive) {
                            SavedGameStore.clear()
                            self.saved = nil
                        }
                    }
                }
                Section {
                    Picker("Вариант", selection: $variant) {
                        ForEach(GameVariant.allCases, id: \.self) { Text($0.displayName).tag($0) }
                    }
                    if variant == .city {
                        Stepper("Игроков: \(cityPlayers)", value: $cityPlayers, in: Ruleset.city.allowedPlayerCounts)
                    } else {
                        LabeledContent("Игроков", value: "10")
                    }
                    LabeledContent("Режим", value: CompetitionFormat.funky.displayName)
                } header: {
                    Text("Новая игра")
                } footer: {
                    Text("Тренировочная фанка с игроками «Игрок 1…N»: роли раздаются случайно. Выбор игроков GoMafia и рейтинговые режимы — следующим шагом.")
                }
                Section {
                    Button("Раздать роли и начать", systemImage: "theatermasks.fill") {
                        if saved == nil { start() } else { isConfirmingReplace = true }
                    }
                    .buttonStyle(.glassProminent)
                    .frame(maxWidth: .infinity)
                    .confirmationDialog("Заменить незавершённую игру?", isPresented: $isConfirmingReplace, titleVisibility: .visible) {
                        Button("Начать новую", role: .destructive, action: start)
                    } message: {
                        Text("Сохранённая игра будет удалена без возможности вернуть.")
                    }
                }
                .listRowBackground(Color.clear)
            }
            .navigationTitle("Игра")
            .onAppear(perform: reloadSaved)
            .fullScreenCover(item: $game, onDismiss: reloadSaved) { game in
                GameScreen(game: game)
            }
            .alert("Игра", isPresented: Binding(get: { setupError != nil }, set: { if !$0 { setupError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(setupError ?? "")
            }
        }
    }

    private func reloadSaved() {
        do {
            saved = try SavedGameStore.load()
        } catch {
            saved = nil
            setupError = "Сохранённую игру не удалось открыть — файл отложен. \(error.localizedDescription)"
        }
    }

    private func start() {
        let players = (1...playerCount).map { PlayerProfile(nickname: "Игрок \($0)") }
        var generator = SystemRandomNumberGenerator()
        do throws(GameError) {
            let setup = try GameSetup.dealt(
                format: .funky,
                ruleset: variant.defaultRuleset,
                players: players.map(\.id),
                shufflesSeating: false,
                using: &generator
            )
            SavedGameStore.clear()
            saved = nil
            game = GameController(session: GameSession(setup: setup), players: players)
        } catch {
            setupError = error.message
        }
    }
}

extension GameController: Identifiable {}

// MARK: - Экран игры

struct GameScreen: View {
    @Bindable var game: GameController
    @Environment(\.dismiss) private var dismiss
    @State private var isPickingBestMove = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    StepHeader(game: game)
                    StepControls(game: game)
                    if game.state.bestMoveAuthor != nil, game.state.bestMove == nil {
                        Button("Лучший ход №\(game.state.bestMoveAuthor!)", systemImage: "star") { isPickingBestMove = true }
                            .buttonStyle(.glass)
                    }
                    SeatGrid(game: game)
                }
                .padding()
            }
            .navigationTitle(game.state.moment.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .safeAreaInset(edge: .bottom) { bottomBar }
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
            Button("Закрыть", systemImage: "xmark") {
                if game.state.isFinished { SavedGameStore.clear() }
                dismiss()
            }
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
    }

    private var bottomBar: some View {
        HStack(spacing: 12) {
            Button("Отменить", systemImage: "arrow.uturn.backward") { game.undo() }
                .buttonStyle(.glass)
                .disabled(!game.session.canUndo)
            Button {
                game.perform(.advance)
            } label: {
                Label("Далее", systemImage: "forward.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .disabled(!game.state.canAdvance)
        }
        .controlSize(.large)
        .padding(.horizontal)
        .padding(.bottom, 8)
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
