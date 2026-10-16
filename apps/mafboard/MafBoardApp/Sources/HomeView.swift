import SwiftUI
import MafBoardCore

/// «Главная»: идущая игра, сегодняшние серии и последние игры.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @Environment(GameLibrary.self) private var library
    let onNewGame: () -> Void
    let onOpenProfile: () -> Void

    private var todayGroups: [HistoryGroup] { library.groups.filter { !$0.isClosed } }

    var body: some View {
        NavigationStack {
            List {
                activeSection
                if model.account?.goMafia == nil {
                    Section {
                        Button(action: onOpenProfile) {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Привяжите GoMafia")
                                    Text("Откроются рейтинг, миникап и турнир, игры уйдут в историю клуба")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: "link.badge.plus")
                            }
                        }
                    }
                }
                if !todayGroups.isEmpty {
                    Section("Сегодня") {
                        ForEach(todayGroups) { group in
                            NavigationLink {
                                SeriesSummaryView(group: group)
                            } label: {
                                SeriesRow(group: group)
                            }
                        }
                    }
                }
                if !library.history.isEmpty {
                    Section("Последние игры") {
                        ForEach(library.history.prefix(5)) { game in
                            NavigationLink {
                                FinishedGameView(game: game)
                            } label: {
                                FinishedGameRow(game: game)
                            }
                        }
                    }
                }
            }
            .navigationTitle("MafBoard")
        }
    }

    @ViewBuilder
    private var activeSection: some View {
        if let active = library.active {
            Section("Идёт игра") {
                Button { library.resumeActive() } label: {
                    ActiveGameRow(game: active)
                }
                .foregroundStyle(.primary)
                .swipeActions {
                    Button("Удалить", systemImage: "trash", role: .destructive) { library.discardActive() }
                }
            }
        } else {
            Section {
                Button(action: onNewGame) {
                    Label("Новая игра", systemImage: "plus.circle.fill")
                        .font(.headline)
                }
            } footer: {
                Text("Рассадка, роли, фазы, голосования и фолы — приложение ведёт игру целиком.")
            }
        }
    }
}

private struct ActiveGameRow: View {
    let game: SavedGame

    var body: some View {
        let state = game.session.state
        HStack(spacing: 12) {
            Image(systemName: "theatermasks.fill")
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 40)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(game.session.setup.variant.displayName).font(.headline)
                    FormatTag(format: game.session.setup.format)
                }
                Text("\(state.moment.displayName) · в игре \(state.aliveSeats.count) из \(state.seats.count)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
    }
}

struct SeriesRow: View {
    let group: HistoryGroup

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(group.title).font(.headline)
                Text(gamesPlayed(group.games.count)).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            FormatTag(format: group.format)
        }
    }
}

struct FinishedGameRow: View {
    let game: FinishedGame

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(game.record.variant.displayName)
                Text(game.record.finishedAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            WinnerLabel(winner: game.record.outcome.winner).font(.subheadline)
        }
    }
}

/// «1 игра», «3 игры», «5 игр».
func gamesPlayed(_ count: Int) -> String {
    let tail = count % 100
    let last = count % 10
    if (11...14).contains(tail) || last == 0 || (5...9).contains(last) { return "\(count) игр" }
    return last == 1 ? "\(count) игра" : "\(count) игры"
}
