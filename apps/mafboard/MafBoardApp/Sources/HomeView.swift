import SwiftUI
import MafBoardCore

/// Вкладка «Судья»: идущие игры и история серий.
struct HomeView: View {
    @Environment(GameLibrary.self) private var library
    let onNewGame: () -> Void
    @State private var segment = Segment.active
    @State private var summaryGroup: HistoryGroup?

    enum Segment: String, CaseIterable {
        case active = "Активные"
        case history = "История"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    VStack(spacing: 6) {
                        Text("MafBoard").font(.system(size: 40, weight: .heavy, design: .rounded))
                        Text("Панель управления мафией").foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)

                    Picker("Раздел", selection: $segment) {
                        ForEach(Segment.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .controlSize(.large)

                    switch segment {
                    case .active: activeSection
                    case .history: historySection
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .appBackground()
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: GameID.self) { id in
                if let game = library.history.first(where: { $0.id == id }) {
                    FinishedGameView(game: game)
                }
            }
            .sheet(item: $summaryGroup) { SeriesSummaryView(group: $0) }
        }
    }

    @ViewBuilder
    private var activeSection: some View {
        SectionTitle(title: "Активные игры", count: library.active == nil ? 0 : 1)
        if let active = library.active {
            ActiveGameCard(game: active)
                .onTapGesture { library.resumeActive() }
                .contextMenu {
                    Button("Удалить игру", systemImage: "trash", role: .destructive) { library.discardActive() }
                }
        } else {
            VStack(spacing: 14) {
                Image(systemName: "theatermasks").font(.system(size: 40)).foregroundStyle(.secondary)
                Text("Нет активных игр").font(.headline)
                Button(action: onNewGame) {
                    Label("Новая игра", systemImage: "plus").padding(.horizontal, 8)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
            .frame(maxWidth: .infinity)
            .glassCard(padding: 28)
        }
    }

    @ViewBuilder
    private var historySection: some View {
        let groups = library.groups
        SectionTitle(title: "История игр", count: groups.count)
        if groups.isEmpty {
            Text("Законченные игры появятся здесь")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .glassCard(padding: 28)
        }
        ForEach(groups) { group in
            HistoryGroupCard(group: group) { summaryGroup = group }
        }
    }
}

// MARK: - Карточки

private struct ActiveGameCard: View {
    let game: SavedGame

    var body: some View {
        let state = game.session.state
        let format = game.session.setup.format
        HStack(spacing: 14) {
            Image(systemName: "theatermasks.fill")
                .font(.title2)
                .frame(width: 58, height: 58)
                .glassEffect(.regular, in: .rect(cornerRadius: 18))
            VStack(alignment: .leading, spacing: 6) {
                Text(game.session.setup.variant.displayName).font(.title3.bold())
                HStack(spacing: 8) {
                    FormatTag(text: format.displayName, color: format.tint)
                    Text(state.moment.displayName).font(.subheadline).foregroundStyle(.secondary)
                }
                ProgressView(value: Double(state.seats.count - state.aliveSeats.count), total: Double(max(state.seats.count, 1)))
                    .tint(format.tint)
                Text("В игре \(state.aliveSeats.count) из \(state.seats.count)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Image(systemName: "chevron.right").foregroundStyle(.secondary)
        }
        .glassCard()
        .contentShape(.rect)
    }
}

private struct HistoryGroupCard: View {
    let group: HistoryGroup
    let onSummary: () -> Void
    @State private var isExpanded = false

    var body: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.snappy) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: group.isClosed ? "lock" : "clock")
                        .font(.title3)
                        .frame(width: 54, height: 54)
                        .glassEffect(.regular, in: .rect(cornerRadius: 16))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(group.title).font(.headline).multilineTextAlignment(.leading)
                        FormatTag(text: group.format.displayName, color: group.format.tint)
                        Text(gamesPlayed(group.games.count)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.down")
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                        .foregroundStyle(.secondary)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            if isExpanded {
                VStack(spacing: 4) {
                    ForEach(Array(group.games.enumerated()), id: \.element.id) { index, game in
                        NavigationLink(value: game.id) {
                            HStack(spacing: 8) {
                                Text("Игра \(index + 1)").foregroundStyle(.secondary)
                                Spacer()
                                Circle().fill(game.record.outcome.winner.dot).frame(width: 8, height: 8)
                                Text(game.record.outcome.winner.shortName)
                                Text(game.record.finishedAt.formatted(.dateTime.day().month(.abbreviated)))
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                                Image(systemName: "arrow.right").font(.caption).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 10)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                    HStack {
                        Button("Итоги", systemImage: "list.bullet", action: onSummary)
                            .buttonStyle(.glass)
                            .tint(.yellow)
                        Spacer()
                        if group.isClosed {
                            Label("Серия завершена", systemImage: "lock").font(.subheadline).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.top, 10)
                }
                .padding(.top, 14)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .glassCard()
    }

    private func gamesPlayed(_ count: Int) -> String {
        let tail = count % 100
        let last = count % 10
        if (11...14).contains(tail) || last == 0 || (5...9).contains(last) { return "\(count) игр сыграно" }
        return last == 1 ? "\(count) игра сыграна" : "\(count) игры сыграно"
    }
}

// MARK: - История

private struct FinishedGameView: View {
    let game: FinishedGame

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 8) {
                    FormatTag(text: game.record.format.displayName, color: game.record.format.tint)
                    Text(game.record.variant.displayName).foregroundStyle(.secondary)
                    Spacer()
                    if game.isUploaded {
                        Label("В истории клуба", systemImage: "checkmark.icloud").font(.caption).foregroundStyle(.green)
                    }
                }
                GameResultsList(record: game.record) { game.profile(at: $0) }
                    .glassCard()
            }
            .padding()
        }
        .appBackground()
        .navigationTitle(game.record.finishedAt.formatted(date: .abbreviated, time: .shortened))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct SeriesSummaryView: View {
    let group: HistoryGroup
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(Array(GameLibrary.summary(of: group).enumerated()), id: \.element.id) { place, row in
                        HStack(spacing: 12) {
                            Text("\(place + 1)").font(.headline).monospacedDigit().frame(width: 26)
                            PlayerAvatar(name: row.player.nickname, url: row.player.avatarURL, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.player.nickname).font(.headline).lineLimit(1)
                                Text("Игр: \(row.games) · побед: \(row.wins)").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(row.points.description).font(.title3.bold()).monospacedDigit()
                        }
                        .glassCard(cornerRadius: 20, padding: 12)
                    }
                }
                .padding()
            }
            .appBackground()
            .navigationTitle("Итоги · \(group.title)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } }
            }
        }
    }
}
