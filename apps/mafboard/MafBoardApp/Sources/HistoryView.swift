import SwiftUI
import MafBoardCore

/// «История»: серии вечеров по разделам, внутри — игры и итоги.
struct HistoryView: View {
    @Environment(GameLibrary.self) private var library

    var body: some View {
        NavigationStack {
            List {
                ForEach(library.groups) { group in
                    Section {
                        ForEach(Array(group.games.enumerated()), id: \.element.id) { index, game in
                            NavigationLink {
                                FinishedGameView(game: game)
                            } label: {
                                HStack {
                                    Text("Игра \(index + 1)")
                                    Spacer()
                                    WinnerLabel(winner: game.record.outcome.winner)
                                        .font(.subheadline)
                                    Text(game.record.finishedAt.formatted(date: .omitted, time: .shortened))
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .monospacedDigit()
                                }
                            }
                        }
                        NavigationLink {
                            SeriesSummaryView(group: group)
                        } label: {
                            Label("Итоги", systemImage: "list.number")
                        }
                    } header: {
                        HStack {
                            Text(group.title)
                            Spacer()
                            if group.isClosed { Image(systemName: "lock.fill").imageScale(.small) }
                        }
                    } footer: {
                        Text("\(gamesPlayed(group.games.count)) · \(group.isClosed ? "серия завершена" : "серия идёт")")
                    }
                }
            }
            .overlay {
                if library.groups.isEmpty {
                    ContentUnavailableView(
                        "Пока нет игр",
                        systemImage: "clock.arrow.circlepath",
                        description: Text("Законченные игры и итоги серий появятся здесь.")
                    )
                }
            }
            .navigationTitle("История")
        }
    }
}

/// Законченная игра: исход и баллы игроков.
struct FinishedGameView: View {
    let game: FinishedGame

    var body: some View {
        List {
            Section {
                LabeledContent("Режим") { FormatTag(format: game.record.format) }
                LabeledContent("Вариант", value: game.record.variant.displayName)
                LabeledContent("Итог") { WinnerLabel(winner: game.record.outcome.winner) }
                if game.isUploaded {
                    Label("Сохранена в истории на сервере", systemImage: "checkmark.icloud")
                        .foregroundStyle(.green)
                }
            }
            Section("Баллы") {
                GameResultsList(record: game.record) { game.profile(at: $0) }
            }
        }
        .navigationTitle(game.record.finishedAt.formatted(date: .abbreviated, time: .shortened))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Итоги серии: сумма баллов игроков за все её игры.
struct SeriesSummaryView: View {
    let group: HistoryGroup

    var body: some View {
        List {
            Section {
                ForEach(Array(GameLibrary.summary(of: group).enumerated()), id: \.element.id) { place, row in
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
            } footer: {
                Text(group.format.countsTowardStandings
                     ? "Баллы по правилам серии."
                     : "Фанка в рейтинги не идёт — это просто сумма баллов за вечер.")
            }
        }
        .navigationTitle("Итоги")
        .navigationBarTitleDisplayMode(.inline)
    }
}
