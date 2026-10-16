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
            List(players) { PlayerRow(player: $0) }
                .overlay {
                    if players.isEmpty {
                        ContentUnavailableView(
                            trimmed.count < 2 ? "Поиск игроков GoMafia" : "Никого не нашли",
                            systemImage: "magnifyingglass",
                            description: Text(trimmed.count < 2 ? "Введите хотя бы 2 символа ника" : "Попробуйте другой ник")
                        )
                    }
                }
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
            AsyncImage(url: player.avatarURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: "person.crop.circle.fill").resizable().foregroundStyle(.secondary)
            }
            .frame(width: 40, height: 40)
            .clipShape(.circle)
            VStack(alignment: .leading) {
                Text(player.nickname).font(.headline)
                Text([player.clubTitle, player.city].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
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
