import SwiftUI
import MafBoardRemote

/// Своё у площадки: любое общее поле можно заменить, плюс то, что есть только у неё.
struct PlatformLookCards: View {
    let link: StudioLink
    let platform: String
    @Binding var draft: RemoteBroadcast
    let account: String?
    let pickCategory: () -> Void

    @State private var upcoming: [RemoteUpcoming] = []
    @State private var upcomingProblem: String?

    private var look: Binding<RemoteBroadcast.Look> {
        Binding { draft.look(platform) } set: { draft.platforms[platform] = $0 }
    }

    var body: some View {
        if account == nil {
            Label("Без входа в \(StudioPlatform.name(platform)) оформление не уйдёт: войдите на ноутбуке в настройках «Эфир».", systemImage: "person.crop.circle.badge.exclamationmark")
                .font(.footnote).foregroundStyle(.orange)
        }
        if platform == "youtube" { youtubeTarget }
        StudioCard {
            OverrideText(title: "Название", own: look.title, common: draft.title, multiline: false)
            if look.wrappedValue.title != nil { LimitRow(text: look.wrappedValue.title ?? "", only: platform) }
        }
        if platform == "youtube" {
            StudioCard { OverrideText(title: "Описание", own: look.description, common: draft.description, multiline: true) }
        }
        if platform != "vk" {
            StudioCard { overrideTags }
        }
        StudioCard(title: "Категория") {
            CategoryRow(platform: platform, category: draft.category(platform), chosen: look.wrappedValue.category != nil, action: pickCategory)
        }
        if platform == "youtube" { youtubeExtras }
        if platform == "twitch" { twitchExtras }
        if platform == "vk" {
            Text("Описание, теги и обложку VK через API не принимает.").font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var youtubeTarget: some View {
        StudioCard(title: "Куда вести эфир") {
            TargetRow(title: "Новая трансляция", hint: "YouTube заведёт её сам", selected: look.wrappedValue.target.kind == "new") {
                look.wrappedValue.target = .init(kind: "new")
            }
            TargetRow(title: "Ближайшая запланированная", hint: "из YouTube Studio, на момент начала", selected: look.wrappedValue.target.kind == "nextScheduled") {
                look.wrappedValue.target = .init(kind: "nextScheduled")
            }
            ForEach(upcoming) { item in
                let target = look.wrappedValue.target
                TargetRow(title: item.title, hint: Self.startsText(item.starts), selected: target.kind == "scheduled" && target.id == item.id) {
                    look.wrappedValue.target = .init(kind: "scheduled", id: item.id, title: item.title)
                }
            }
            if let upcomingProblem { Text(upcomingProblem).font(.caption).foregroundStyle(.orange) }
        }
        .task(id: account) { await loadUpcoming() }
    }

    private var overrideTags: some View {
        VStack(alignment: .leading, spacing: 10) {
            OverrideHeader(title: "Теги", own: look.wrappedValue.tags != nil) {
                look.wrappedValue.tags = look.wrappedValue.tags == nil ? draft.tags : nil
            }
            if let binding = Binding(look.tags) {
                PhoneTagEditor(tags: binding)
            } else {
                Text(draft.tags.isEmpty ? "—" : draft.tags.map { "#\($0)" }.joined(separator: " ")).foregroundStyle(.secondary)
            }
            if platform == "twitch" {
                let sent = RemoteBroadcast.twitchTags(look.wrappedValue.tags ?? draft.tags)
                Text("Уйдут так: \(sent.isEmpty ? "—" : sent.joined(separator: " · ")) (\(sent.count) из 10)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var youtubeExtras: some View {
        StudioCard(title: "Доступ") {
            Picker("Доступ", selection: look.privacy) {
                Text("Открытый").tag("public")
                Text("По ссылке").tag("unlisted")
                Text("Закрытый").tag("private")
            }
            .pickerStyle(.segmented)
            Toggle("Для детей", isOn: look.madeForKids)
        }
    }

    @ViewBuilder private var twitchExtras: some View {
        StudioCard {
            Picker("Язык эфира", selection: Binding { look.wrappedValue.language ?? "ru" } set: { look.wrappedValue.language = $0 }) {
                Text("Русский").tag("ru")
                Text("English").tag("en")
                Text("Українська").tag("uk")
            }
            Toggle(isOn: look.branded) {
                VStack(alignment: .leading) {
                    Text("Реклама в эфире")
                    Text("спонсорская интеграция").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func loadUpcoming() async {
        guard account != nil else {
            upcomingProblem = "Войдите в YouTube на ноутбуке, чтобы видеть запланированные эфиры"
            return
        }
        do {
            upcoming = try await link.ask(.youtubeUpcoming)?.decode(as: [RemoteUpcoming].self) ?? []
            upcomingProblem = nil
        } catch {
            upcomingProblem = error.localizedDescription
        }
    }

    private static func startsText(_ starts: String?) -> String {
        guard let starts, let date = try? Date(starts, strategy: .iso8601) else { return "запланирован" }
        return date.formatted(.dateTime.day().month(.wide).hour().minute().locale(Locale(identifier: "ru_RU")))
    }
}

private struct TargetRow: View {
    let title: String
    let hint: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.subheadline.weight(.semibold)).lineLimit(2)
                    Text(hint).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: selected ? "checkmark.circle.fill" : "circle").font(.title3)
                    .foregroundStyle(selected ? AnyShapeStyle(StudioPlatform.tint("youtube")) : AnyShapeStyle(.tertiary))
            }
            .padding(10)
            .background(selected ? StudioPlatform.tint("youtube").opacity(0.12) : Color.black.opacity(0.15), in: .rect(cornerRadius: 12))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: selected)
    }
}

private struct OverrideHeader: View {
    let title: String
    let own: Bool
    let toggle: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold))
            Text(own ? "своё" : "как для всех").font(.caption2.weight(.semibold))
                .padding(.horizontal, 7).padding(.vertical, 2)
                .background((own ? Color.orange : Color.blue).opacity(0.18), in: .capsule)
                .foregroundStyle(own ? .orange : .blue)
            Spacer()
            Button(own ? "Как для всех" : "Своё", systemImage: own ? "arrow.uturn.backward" : "pencil", action: toggle)
                .font(.caption.weight(.semibold)).buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(.small)
        }
    }
}

private struct OverrideText: View {
    let title: String
    @Binding var own: String?
    let common: String
    let multiline: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            OverrideHeader(title: title, own: own != nil) { own = own == nil ? common : nil }
            if let binding = Binding($own) {
                TextField(common, text: binding, axis: .vertical).lineLimit(multiline ? 3...8 : 1...3).fieldSurface()
            } else {
                Text(common.isEmpty ? "—" : common).foregroundStyle(.secondary).lineLimit(3)
            }
        }
    }
}

/// Поиск категории площадки. Поиск идёт через ноутбук: токены площадок только там.
struct CategorySearchSheet: View {
    let link: StudioLink
    let platform: String
    let current: RemoteBroadcast.Category?
    let onPick: (RemoteBroadcast.Category?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var found: [RemoteBroadcast.Category] = []
    @State private var problem: String?
    @State private var searching = false

    var body: some View {
        NavigationStack {
            List {
                if let fallback = RemoteBroadcast.defaultCategory(platform) {
                    Section("По умолчанию") { row(fallback, reset: true) }
                }
                Section {
                    if let problem { Text(problem).foregroundStyle(.orange) }
                    ForEach(found) { row($0, reset: false) }
                } header: {
                    if searching { ProgressView() } else if !found.isEmpty { Text("Найдено") }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Найти в \(StudioPlatform.name(platform))")
            .navigationTitle("Категория")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() } } }
            .task(id: query) { await search() }
        }
        .presentationDetents([.large])
    }

    private func row(_ category: RemoteBroadcast.Category, reset: Bool) -> some View {
        Button {
            onPick(reset ? nil : category)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                AsyncImage(url: category.art.flatMap(URL.init(string:))) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    StudioPlatformBadge(platform: platform, size: 36)
                }
                .frame(width: 36, height: 48).clipShape(.rect(cornerRadius: 6))
                Text(category.name).foregroundStyle(.primary)
                Spacer()
                if category.id == current?.id { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
        }
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else {
            found = []
            return
        }
        // Пока ведущий печатает, запросы не уходят: только после паузы.
        try? await Task.sleep(for: .milliseconds(450))
        guard !Task.isCancelled else { return }
        searching = true
        defer { searching = false }
        do {
            found = try await link.ask(.searchCategories(platform: platform, query: text))?.decode(as: [RemoteBroadcast.Category].self) ?? []
            problem = found.isEmpty ? "Ничего не нашлось" : nil
        } catch {
            problem = error.localizedDescription
        }
    }
}
