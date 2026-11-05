import Foundation
import Testing
@testable import MafBoardRemote

@Suite("Пульт: выбор канала")
struct RemoteChannelPolicyTests {
    private let start = Date(timeIntervalSince1970: 1_000_000)

    private func at(_ seconds: TimeInterval) -> Date {
        start.addingTimeInterval(seconds)
    }

    @Test("Ноутбук виден в сети: сразу сеть, в облако не ходим")
    func lanFirst() {
        var policy = RemoteChannelPolicy(now: start)
        #expect(policy.channel == nil)
        policy.lanVisibilityChanged(true, at: at(0.5))
        #expect(policy.channel == .lan)
        #expect(policy.connectionSerial == 1)
    }

    @Test("Ноутбука не видно 3 секунды после запуска: облако")
    func cloudWhenLanNeverAppears() {
        var policy = RemoteChannelPolicy(now: start)
        policy.tick(at: at(2.9))
        #expect(policy.channel == nil)
        policy.tick(at: at(3))
        #expect(policy.channel == .cloud)
    }

    @Test("Пока сеть отвечает, канал не меняется")
    func staysOnLan() {
        var policy = RemoteChannelPolicy(now: start)
        policy.lanVisibilityChanged(true, at: start)
        for second in 1...30 {
            policy.heard(on: .lan, at: at(Double(second)))
            policy.tick(at: at(Double(second)))
        }
        #expect(policy.channel == .lan)
        #expect(policy.connectionSerial == 1)
    }

    @Test("3 секунды без сигнала в сети: облако")
    func fallsBackToCloud() {
        var policy = RemoteChannelPolicy(now: start)
        policy.lanVisibilityChanged(true, at: start)
        policy.heard(on: .lan, at: at(1))
        policy.tick(at: at(3.9))
        #expect(policy.channel == .lan)
        policy.tick(at: at(4))
        #expect(policy.channel == .cloud)
        #expect(policy.connectionSerial == 2)
    }

    @Test("Bonjour снова увидел ноутбук: возвращаемся в сеть")
    func returnsToLan() {
        var policy = RemoteChannelPolicy(now: start)
        policy.lanVisibilityChanged(true, at: start)
        policy.tick(at: at(3))
        #expect(policy.channel == .cloud)
        policy.lanVisibilityChanged(false, at: at(4))
        policy.heard(on: .cloud, at: at(5))
        policy.lanVisibilityChanged(true, at: at(6))
        #expect(policy.channel == .lan)
    }

    @Test("Bonjour видит, а соединение не проходит: не прыгаем, сеть пробуем редко")
    func lanVisibleButBroken() {
        var policy = RemoteChannelPolicy(now: start)
        policy.lanVisibilityChanged(true, at: start)
        policy.tick(at: at(3))
        #expect(policy.channel == .cloud)

        var second = 4.0
        while second < 32 {
            policy.heard(on: .cloud, at: at(second))
            policy.tick(at: at(second))
            #expect(policy.channel == .cloud, "ещё рано пробовать сеть: \(second)")
            second += 1
        }
        policy.heard(on: .cloud, at: at(33))
        policy.tick(at: at(33))
        #expect(policy.channel == .lan)
    }

    @Test("Сигнал от старого канала не считается")
    func foreignSignalIgnored() {
        var policy = RemoteChannelPolicy(now: start)
        policy.lanVisibilityChanged(true, at: start)
        policy.tick(at: at(3))
        policy.heard(on: .lan, at: at(5))
        policy.tick(at: at(6))
        #expect(policy.channel == .cloud)
        #expect(policy.connectionSerial == 3, "облако молчало 3 секунды: новое подключение")
    }

    @Test("Молчание облака: паузы растут, лимит подключений к релею не исчерпать")
    func cloudBackoff() {
        var policy = RemoteChannelPolicy(now: start)
        policy.tick(at: at(3))
        #expect(policy.connectionSerial == 1)
        var attempts: [TimeInterval] = []
        var second = 3.0
        var serial = policy.connectionSerial
        while second < 200 {
            second += 0.25
            policy.tick(at: at(second))
            if policy.connectionSerial != serial {
                attempts.append(second)
                serial = policy.connectionSerial
            }
        }
        #expect(Array(attempts.prefix(5)) == [6, 12, 24, 48, 78])
        let gaps = zip(attempts.dropFirst(), attempts).map { $0 - $1 }
        #expect(gaps.allSatisfy { $0 <= RemoteChannelPolicy.cloudRetryLimit })
    }

    @Test("Сигнал из облака сбрасывает паузу")
    func cloudBackoffResets() {
        var policy = RemoteChannelPolicy(now: start)
        policy.tick(at: at(3))
        policy.tick(at: at(6))
        policy.tick(at: at(12))
        let serial = policy.connectionSerial
        policy.heard(on: .cloud, at: at(13))
        policy.tick(at: at(15.9))
        #expect(policy.connectionSerial == serial)
        policy.tick(at: at(16))
        #expect(policy.connectionSerial == serial + 1)
    }
}

@Suite("Пульт: команды в пути")
struct RemotePendingCommandsTests {
    private let start = Date(timeIntervalSince1970: 1_000_000)

    private func envelope(_ id: String) -> RemoteEnvelope {
        RemoteEnvelope(id: id, sentAtMs: 1, command: .stopRecording)
    }

    @Test("Ответ убирает команду, повторный ответ ни на что не влияет")
    func acknowledge() {
        var pending = RemotePendingCommands()
        pending.add(envelope("a"), at: start)
        let first = pending.acknowledge(id: "a")
        let second = pending.acknowledge(id: "a")
        #expect(first)
        #expect(!second)
        #expect(pending.isEmpty)
    }

    @Test("Заново уходят только свежие команды с тем же номером")
    func resend() {
        var pending = RemotePendingCommands()
        pending.add(envelope("old"), at: start)
        pending.add(envelope("new"), at: start.addingTimeInterval(4))
        let later = start.addingTimeInterval(5)
        #expect(pending.resendable(at: later).map(\.id) == ["new"])
    }

    @Test("Просроченная команда считается недошедшей и больше не отправляется")
    func expire() {
        var pending = RemotePendingCommands()
        pending.add(envelope("a"), at: start)
        let early = pending.expire(at: start.addingTimeInterval(4.9))
        let late = pending.expire(at: start.addingTimeInterval(5))
        #expect(early == 0)
        #expect(late == 1)
        #expect(pending.isEmpty)
    }
}
