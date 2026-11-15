import SwiftUI
import MafBoardRemote

/// Чат всех площадок на телефоне: лента с ноутбука и ответы ведущего в чаты, куда он вошёл.
struct StudioChatScreen: View {
    let link: StudioLink

    @State private var filter = "all"
    @State private var accounts: [RemoteBroadcastView.Platform] = []
    @State private var problem: String?
    @State private var text = ""
    @State private var sending = false
    @FocusState private var composing: Bool

    private var shown: [RemoteChatMessage] {
        filter == "all" ? link.chat : link.chat.filter { $0.platform == filter }
    }

    /// Куда уйдёт сообщение: площадки со входом, по выбранной вкладке.
    private var targets: [String] {
        let signedIn = accounts.filter { $0.account != nil && $0.id != "rutube" }.map(\.id)
        return filter == "all" ? signedIn : signedIn.filter { $0 == filter }
    }

    var body: some View {
        VStack(spacing: 0) {
            filters
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        if shown.isEmpty {
                            ContentUnavailableView("Сообщений пока нет", systemImage: "bubble.left.and.bubble.right",
                                                   description: Text("Здесь появится чат YouTube, Twitch и VK Видео с ноутбука."))
                                .padding(.top, 60)
                        }
                        ForEach(shown) { message in
                            PhoneChatRow(message: message, showPlatform: filter == "all").id(message.id)
                        }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                }
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: shown.last?.id) { _, last in
                    guard let last else { return }
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(.orange).padding(.horizontal, 16).padding(.top, 6)
                    .onTapGesture { self.problem = nil }
            }
            composer
        }
        .background { AmbientBackground() }
        .navigationTitle("Чат")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(title: "Все", platform: nil, count: link.chat.count, selected: filter == "all") { filter = "all" }
                ForEach(["youtube", "twitch", "vk", "rutube"].filter { id in link.chat.contains { $0.platform == id } }, id: \.self) { id in
                    FilterChip(title: StudioPlatform.name(id), platform: id, count: link.chat.filter { $0.platform == id }.count, selected: filter == id) { filter = id }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
        }
        .sensoryFeedback(.selection, trigger: filter)
    }

    private var composer: some View {
        HStack(spacing: 10) {
            HStack(spacing: -6) {
                ForEach(targets, id: \.self) { StudioPlatformBadge(platform: $0, size: 22).overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.black.opacity(0.3))) }
            }
            TextField(targets.isEmpty ? "Войдите в площадку на ноутбуке" : "Написать в чат…", text: $text, axis: .vertical)
                .lineLimit(1...4).focused($composing).submitLabel(.send).onSubmit { Task { await send() } }
                .disabled(targets.isEmpty)
            Button {
                Task { await send() }
            } label: {
                Image(systemName: sending ? "hourglass" : "arrow.up").font(.body.weight(.bold)).frame(width: 34, height: 34)
            }
            .buttonStyle(.solidProminent(.capsule))
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || targets.isEmpty || sending)
            .accessibilityLabel("Отправить")
        }
        .padding(.leading, 14).padding(.trailing, 6).padding(.vertical, 6)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 24))
        .padding(.horizontal, 12).padding(.bottom, 8)
    }

    private func load() async {
        do {
            try await link.loadChat()
            accounts = try await link.ask(.getBroadcast)?.decode(as: RemoteBroadcastView.self).platforms ?? []
        } catch {
            problem = error.localizedDescription
        }
    }

    /// В каждый чат отдельно: ошибка одной площадки не мешает другим.
    private func send() async {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !targets.isEmpty else { return }
        sending = true
        defer { sending = false }
        var failed: [String] = []
        for platform in targets {
            do {
                _ = try await link.ask(.sendChat(platform: platform, text: message))
            } catch {
                failed.append("\(StudioPlatform.name(platform)): \(error.localizedDescription)")
            }
        }
        if failed.isEmpty { text = "" }
        problem = failed.isEmpty ? nil : failed.joined(separator: "\n")
    }
}

private struct FilterChip: View {
    let title: String
    let platform: String?
    let count: Int
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let platform { StudioPlatformBadge(platform: platform, size: 18) }
                Text(title).font(.subheadline.weight(.semibold))
                Text("\(count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12).frame(height: 34)
            .foregroundStyle(selected ? .primary : .secondary)
        }
        .buttonStyle(.plain)
        .glassEffect(selected ? .regular.tint(.white.opacity(0.18)).interactive() : .regular.interactive(), in: .capsule)
    }
}

/// Строка чата: значок площадки, ник цветом площадки, текст. Донат — яркой карточкой с суммой.
private struct PhoneChatRow: View {
    let message: RemoteChatMessage
    let showPlatform: Bool

    var body: some View {
        if let amount = message.amount {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    if showPlatform { StudioPlatformBadge(platform: message.platform, size: 18) }
                    Text(message.author).font(.subheadline.weight(.bold)).lineLimit(1)
                    Spacer(minLength: 6)
                    Label(amount, systemImage: "heart.fill").font(.subheadline.weight(.heavy))
                        .padding(.horizontal, 9).padding(.vertical, 4).background(.black.opacity(0.25), in: .capsule)
                }
                if !message.text.isEmpty { Text(message.text).font(.body) }
            }
            .foregroundStyle(.white)
            .padding(12)
            .background(LinearGradient(colors: [Color(red: 0.95, green: 0.55, blue: 0.1), Color(red: 0.86, green: 0.25, blue: 0.35)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing), in: .rect(cornerRadius: 16))
            .padding(.vertical, 3)
            .accessibilityElement(children: .combine)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if showPlatform {
                    StudioPlatformBadge(platform: message.platform, size: 16)
                        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                }
                line.font(.body).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 3)
            .accessibilityElement(children: .combine)
        }
    }

    private var line: Text {
        let badges = message.badges.compactMap(Self.badge).reduce(Text("")) { Text("\($0)\($1) ") }
        let nick = Text(message.author).fontWeight(.bold).foregroundStyle(StudioPlatform.nick(hex: message.color, platform: message.platform))
        return Text("\(badges)\(nick)  \(message.text)")
    }

    private static func badge(_ badge: String) -> Text? {
        switch badge {
        case "owner": Text(Image(systemName: "crown.fill")).foregroundStyle(.yellow)
        case "moderator": Text(Image(systemName: "shield.fill")).foregroundStyle(.green)
        case "vip": Text(Image(systemName: "diamond.fill")).foregroundStyle(.pink)
        case "verified": Text(Image(systemName: "checkmark.seal.fill")).foregroundStyle(.secondary)
        case "subscriber": Text(Image(systemName: "star.fill")).foregroundStyle(.purple)
        default: nil
        }
    }
}
