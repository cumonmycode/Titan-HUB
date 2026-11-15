import Foundation
import Testing
import MafBoardCore
@testable import MafBoardRemote

/// Команды инфографики. С `MAFBOARD_BROADCAST_DUMP=<папка>` конверт `setGame` кладётся туда,
/// чтобы его разобрал `parse_phone_frame` MafBoard Studio.
@Suite("Пульт: снимок игры для инфографики")
struct RemoteGameTests {
    static let game = GameBroadcast(
        gameId: "game-1", revision: 7, phase: .init(kind: .day, number: 1),
        players: [.init(seat: 1, nickname: "Боня", role: "civilian", team: .red), .init(seat: 2, nickname: "Клёпа", status: .killed)],
        speech: .init(seat: 1, kind: .speech, timer: .init(totalSeconds: 60, remainingMs: 41_000, running: true)),
        nominations: [.init(candidate: 2, by: 1)]
    )

    private func object(_ envelope: RemoteEnvelope) throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(envelope)) as? [String: Any])
    }

    @Test("setGame кладёт снимок в поле game, clearGame — без полей")
    func encoding() throws {
        let envelope = RemoteEnvelope(id: "g-1", sentAtMs: 5, command: .setGame(Self.game))
        let command = try #require(try object(envelope)["command"] as? [String: Any])
        #expect(command["kind"] as? String == "setGame")
        let game = try #require(command["game"] as? [String: Any])
        #expect(game["gameId"] as? String == "game-1")
        #expect(game["revision"] as? Int == 7)
        let timer = try #require((game["speech"] as? [String: Any])?["timer"] as? [String: Any])
        #expect(timer["remainingMs"] as? Int == 41_000)
        #expect(timer["running"] as? Bool == true)

        let clear = try object(RemoteEnvelope(id: "g-2", sentAtMs: 5, command: .clearGame))
        #expect(clear["command"] as? [String: String] == ["kind": "clearGame"])

        if let folder = ProcessInfo.processInfo.environment["MAFBOARD_BROADCAST_DUMP"] {
            let url = URL(fileURLWithPath: folder).appending(path: "envelope-setGame.json")
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(envelope).write(to: url)
        }
    }
}
