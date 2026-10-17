import SwiftUI
import MafBoardCore

/// «Мой клуб» (открывается из профиля): клуб ведущего в GoMafia и его состав; поиск — по всей GoMafia.
struct ClubView: View {
    @Environment(AppModel.self) private var model
    @State private var roster: [GoMafiaPlayer] = []
    @State private var isLoading = false
    @State private var query = ""
    @State private var results: [GoMafiaPlayer] = []

    private var club: GoMafiaClub? { model.account?.goMafia?.club }
    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    private var isSearching: Bool { trimmed.count >= 2 }

    var body: some View {
        List {
            if isSearching {
                Section("Поиск в GoMafia") {
                    ForEach(results) { PlayerRow(player: $0) }
                }
            } else if let club {
                Section {
                    LabeledContent("Город", value: club.city ?? "—")
                    LabeledContent("Игроков в составе", value: isLoading && roster.isEmpty ? "…" : "\(roster.count)")
                }
                Section("Состав") {
                    if isLoading, roster.isEmpty {
                        ProgressView().frame(maxWidth: .infinity)
                    }
                    ForEach(roster.sorted { ($0.elo ?? 0) > ($1.elo ?? 0) }) { PlayerRow(player: $0) }
                }
            }
        }
        .ambientBackground()
        .overlay { placeholder }
        .navigationTitle(club?.title ?? "Мой клуб")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "Ник в GoMafia")
        .refreshable { await loadRoster() }
        .task(id: club?.id) { await loadRoster() }
        .task(id: trimmed) {
            guard isSearching else {
                results = []
                return
            }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            guard let found = await model.searchPlayers(trimmed), !Task.isCancelled else { return }
            results = found
        }
    }

    @ViewBuilder
    private var placeholder: some View {
        if isSearching, results.isEmpty {
            ContentUnavailableView.search(text: trimmed)
        } else if !isSearching, club == nil {
            ContentUnavailableView {
                Label("Нет клуба", systemImage: "person.3")
            } description: {
                Text(model.account?.goMafia == nil
                     ? "Подключите GoMafia — здесь появится ваш клуб и его состав."
                     : "В GoMafia вы пока не состоите в клубе. Поиск игроков работает и так.")
            } actions: {
                if model.account?.goMafia == nil {
                    NavigationLink("Подключить GoMafia") { GoMafiaConnectionView() }
                        .buttonStyle(.glassProminent)
                }
            }
        }
    }

    private func loadRoster() async {
        guard let club else {
            roster = []
            return
        }
        isLoading = true
        if let players = await model.clubRoster(clubID: club.id) { roster = players }
        isLoading = false
    }
}

struct PlayerRow: View {
    let player: GoMafiaPlayer

    var body: some View {
        HStack(spacing: 12) {
            PlayerAvatar(name: player.nickname, url: player.avatarURL)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(player.nickname).lineLimit(1)
                    if player.isInHostClub {
                        Image(systemName: "star.fill").font(.caption2).foregroundStyle(.yellow)
                    }
                }
                let details = [player.clubTitle, player.city].compactMap { $0 }.joined(separator: " · ")
                if !details.isEmpty {
                    Text(details).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer()
            if let elo = player.elo {
                Text(elo.formatted(.number.precision(.fractionLength(0))))
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
        }
    }
}
