import SwiftUI
import MafBoardCore

/// Поиск игроков GoMafia: сначала свой клуб (звёздочка), затем общий поиск.
struct PlayersView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var players: [GoMafiaPlayer] = []

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(players) { PlayerRow(player: $0).glassCard(cornerRadius: 20, padding: 12) }
                }
                .padding()
            }
            .overlay {
                if players.isEmpty {
                    ContentUnavailableView(
                        trimmed.count < 2 ? "Поиск игроков GoMafia" : "Никого не нашли",
                        systemImage: "magnifyingglass",
                        description: Text(trimmed.count < 2 ? "Введите хотя бы 2 символа ника" : "Попробуйте другой ник")
                    )
                }
            }
            .appBackground()
            .navigationTitle("Игроки")
            .searchable(text: $query, prompt: "Ник в GoMafia")
            .task(id: trimmed) {
                guard trimmed.count >= 2 else {
                    players = []
                    return
                }
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                guard let found = await model.searchPlayers(trimmed), !Task.isCancelled else { return }
                players = found
            }
        }
    }
}

struct PlayerRow: View {
    let player: GoMafiaPlayer

    var body: some View {
        HStack(spacing: 12) {
            PlayerAvatar(name: player.nickname, url: player.avatarURL, size: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(player.nickname).font(.headline).lineLimit(1)
                Text([player.clubTitle, player.city].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if let elo = player.elo {
                Text(elo.formatted(.number.precision(.fractionLength(0))))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            if player.isInHostClub {
                Image(systemName: "star.fill").foregroundStyle(.yellow)
            }
        }
    }
}
