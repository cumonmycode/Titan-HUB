import SwiftUI
import MafBoardCore

/// Вкладка «Игры»: идущая игра, открытые вечера и прошлые вечера.
struct GamesView: View {
    @Environment(GameLibrary.self) private var library
    let onNewGame: (Evening?) -> Void

    var body: some View {
        NavigationStack {
            List {
                if let active = library.active {
                    Section {
                        ResumeGameRow(game: active) { library.resumeActive() }
                    }
                }
                ForEach(library.openEvenings) { evening in
                    OpenEveningSection(evening: evening, isGameRunning: library.active != nil) { onNewGame(evening) }
                }
                if library.active == nil, library.openEvenings.isEmpty {
                    Section {
                        StartCard { onNewGame(nil) }
                    }
                }
                if !library.closedEvenings.isEmpty {
                    Section("История") {
                        ForEach(library.closedEvenings) { evening in
                            NavigationLink {
                                EveningDetailView(evening: evening)
                            } label: {
                                EveningRow(evening: evening, games: library.games(of: evening).count)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Игры")
            .profileButton()
        }
    }
}

// MARK: - Строки

private struct ResumeGameRow: View {
    let game: SavedGame
    let action: () -> Void
    @Environment(GameLibrary.self) private var library

    var body: some View {
        let state = game.session.state
        let setup = game.session.setup
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "play.fill")
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(.tint, in: .circle)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Продолжить игру").font(.headline)
                    Text("\(setup.variant.displayName) · \(setup.format.displayName)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("\(state.moment.displayName) · в игре \(state.aliveSeats.count) из \(state.seats.count)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.vertical, 6)
        }
        .foregroundStyle(.primary)
        .swipeActions {
            Button("Удалить", systemImage: "trash", role: .destructive) { library.discardActive() }
        }
    }
}

private struct StartCard: View {
    let action: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: "theatermasks.fill")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            VStack(spacing: 4) {
                Text("Начните вечер").font(.title3.weight(.semibold))
                Text("Выберите игру и режим, добавьте игроков — приложение раздаст роли и проведёт игру.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: action) {
                Label("Новая игра", systemImage: "plus").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
    }
}

/// Открытый вечер: его игры, итоги и «Следующая игра».
private struct OpenEveningSection: View {
    let evening: Evening
    let isGameRunning: Bool
    let onNext: () -> Void
    @Environment(GameLibrary.self) private var library
    @State private var isConfirmingClose = false

    var body: some View {
        let games = library.games(of: evening)
        Section {
            ForEach(Array(games.enumerated()), id: \.element.id) { index, game in
                NavigationLink {
                    FinishedGameView(game: game, number: index + 1)
                } label: {
                    GameLine(game: game, number: index + 1)
                }
            }
            if !games.isEmpty {
                NavigationLink {
                    EveningDetailView(evening: evening)
                } label: {
                    HStack {
                        Label("Итоги вечера", systemImage: "list.number")
                        Spacer()
                        if let leader = library.summary(of: evening).first {
                            Text(leader.player.nickname).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
            if !isGameRunning {
                Button(action: onNext) {
                    Label(games.isEmpty ? "Первая игра вечера" : "Следующая игра", systemImage: "plus.circle.fill")
                        .fontWeight(.semibold)
                }
            }
        } header: {
            HStack {
                Text(evening.title)
                Spacer()
                FormatTag(format: evening.format)
            }
        } footer: {
            HStack {
                Text("\(evening.variant.displayName) · \(gamesPlayed(games.count))")
                Spacer()
                Button("Завершить вечер") { isConfirmingClose = true }
                    .font(.footnote.weight(.semibold))
                    .confirmationDialog("Завершить вечер?", isPresented: $isConfirmingClose, titleVisibility: .visible) {
                        Button("Завершить") { library.closeEvening(evening.id) }
                    } message: {
                        Text("Итоги останутся в истории.")
                    }
            }
        }
    }
}

struct EveningRow: View {
    let evening: Evening
    let games: Int

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(evening.title)
                Text("\(evening.variant.displayName) · \(gamesPlayed(games))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            FormatTag(format: evening.format)
        }
    }
}

private struct GameLine: View {
    let game: FinishedGame
    let number: Int

    var body: some View {
        HStack {
            Text("Игра \(number)")
            Spacer()
            WinnerLabel(winner: game.record.outcome.winner).font(.subheadline)
            Text(game.record.finishedAt.formatted(date: .omitted, time: .shortened))
                .font(.subheadline)
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Подробности

/// Вечер: итоги и все его игры.
struct EveningDetailView: View {
    let evening: Evening
    @Environment(GameLibrary.self) private var library

    var body: some View {
        let games = library.games(of: evening)
        List {
            Section {
                ForEach(Array(library.summary(of: evening).enumerated()), id: \.element.id) { place, row in
                    HStack(spacing: 12) {
                        Text("\(place + 1)")
                            .font(.headline)
                            .monospacedDigit()
                            .foregroundStyle(place < 3 ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                            .frame(width: 24)
                        PlayerAvatar(name: row.player.nickname, url: row.player.avatarURL, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.player.nickname).lineLimit(1)
                            Text("Игр: \(row.games) · побед: \(row.wins)").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(row.points.description).font(.headline).monospacedDigit()
                    }
                }
            } header: {
                Text("Итоги")
            } footer: {
                Text(evening.format.countsTowardStandings
                     ? "Сумма баллов за вечер. Таблица за любой период — во вкладке «Рейтинг»."
                     : "Фанка в рейтинги не идёт — это сумма баллов за вечер.")
            }
            Section("Игры") {
                ForEach(Array(games.enumerated()), id: \.element.id) { index, game in
                    NavigationLink {
                        FinishedGameView(game: game, number: index + 1)
                    } label: {
                        GameLine(game: game, number: index + 1)
                    }
                }
            }
        }
        .navigationTitle(evening.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Законченная игра: исход и баллы игроков.
struct FinishedGameView: View {
    let game: FinishedGame
    let number: Int

    var body: some View {
        List {
            Section {
                LabeledContent("Итог") { WinnerLabel(winner: game.record.outcome.winner) }
                LabeledContent("Режим") { FormatTag(format: game.record.format) }
                LabeledContent("Игра", value: game.record.variant.displayName)
                LabeledContent("Окончена", value: game.record.finishedAt.formatted(date: .abbreviated, time: .shortened))
                LabeledContent("Номер игры", value: game.id.shortCode)
                    .monospaced()
                if game.isUploaded {
                    Label("Сохранена на сервере", systemImage: "checkmark.icloud").foregroundStyle(.green)
                }
            }
            Section("Баллы") {
                GameResultsList(record: game.record) { game.profile(at: $0) }
            }
        }
        .navigationTitle("Игра \(number)")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// «1 игра», «3 игры», «5 игр».
func gamesPlayed(_ count: Int) -> String {
    let tail = count % 100
    let last = count % 10
    if (11...14).contains(tail) || last == 0 || (5...9).contains(last) { return "\(count) игр" }
    return last == 1 ? "\(count) игра" : "\(count) игры"
}
