import Foundation
import Testing
@testable import MafBoardRemote

/// Оформление эфира и чат через пульт: те же имена, что у MafBoard Studio (`mbs_remote::messages`).
struct RemoteStudioTests {
    private func encoded(_ command: RemoteCommand) throws -> [String: Any] {
        let data = try JSONEncoder().encode(command)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test("Запросы к студии уходят с именами, которые понимает ноутбук")
    func studioCommandsKeepContractNames() throws {
        #expect(try encoded(.getBroadcast)["kind"] as? String == "getBroadcast")
        #expect(try encoded(.chatBacklog)["kind"] as? String == "chatBacklog")
        let chat = try encoded(.sendChat(platform: "twitch", text: "привет"))
        #expect(chat["kind"] as? String == "sendChat")
        #expect(chat["platform"] as? String == "twitch")
        #expect(chat["text"] as? String == "привет")
        let search = try encoded(.searchCategories(platform: "vk", query: "мафия"))
        #expect(search["query"] as? String == "мафия")
        var broadcast = RemoteBroadcast()
        broadcast.title = "Игра"
        let set = try encoded(.setBroadcast(broadcast))
        #expect((set["broadcast"] as? [String: Any])?["title"] as? String == "Игра")
    }

    @Test("Ответ студии с данными и ошибкой разбирается")
    func answerDecodes() throws {
        let ok = try JSONDecoder().decode(DesktopMessage.self, from: Data(#"{"type":"answer","id":"a","error":null,"data":[{"id":"1","name":"Mafia Online","art":null}]}"#.utf8))
        guard case let .answer(id, error, data) = ok else { Issue.record("не answer"); return }
        #expect(id == "a" && error == nil)
        let categories = try #require(data).decode(as: [RemoteBroadcast.Category].self)
        #expect(categories.first?.name == "Mafia Online")
        let failed = try JSONDecoder().decode(DesktopMessage.self, from: Data(#"{"type":"answer","id":"b","error":"Войдите в Twitch","data":null}"#.utf8))
        #expect(failed == .answer(id: "b", error: "Войдите в Twitch", data: nil))
    }

    @Test("Непонятное сообщение чата не ломает остальные")
    func chatSkipsBrokenMessages() throws {
        let frame = #"{"type":"chat","messages":[{"seq":3,"platform":"twitch","id":"x","author":"Owl","text":"привет","atMs":5,"badges":["vip"],"amount":"100 bits"},{"broken":true}]}"#
        let message = try JSONDecoder().decode(DesktopMessage.self, from: Data(frame.utf8))
        guard case let .chat(messages) = message else { Issue.record("не chat"); return }
        #expect(messages.count == 1)
        #expect(messages[0].badges == ["vip"] && messages[0].amount == "100 bits" && messages[0].id == "twitch:x")
    }

    @Test("Оформление без полей площадки получает значения по умолчанию")
    func broadcastDefaults() throws {
        let broadcast = try JSONDecoder().decode(RemoteBroadcast.self, from: Data(#"{"title":"Игра","platforms":{"youtube":{"title":"YT"}}}"#.utf8))
        #expect(broadcast.look("youtube").privacy == "public")
        #expect(broadcast.look("youtube").dvr)
        #expect(broadcast.category("twitch")?.id == "365898311")
        #expect(RemoteBroadcast.twitchTags(["спортивная мафия", "#ФИИМ", "фиим"]) == ["спортивнаямафия", "ФИИМ"])
    }
}
