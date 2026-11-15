import SwiftUI
import MafBoardRemote

/// Оформление эфира с телефона: то же, что в настройках MafBoard Studio. Сохраняется на ноутбуке,
/// а при выходе в эфир студия отправит его на площадки.
struct BroadcastLookScreen: View {
    let link: StudioLink

    @State private var view: RemoteBroadcastView?
    @State private var draft = RemoteBroadcast()
    @State private var tab = "all"
    @State private var problem: String?
    @State private var saving = false
    @State private var picking: PickingCategory?

    private var changed: Bool { view.map { $0.broadcast != draft } ?? false }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let problem {
                    Label(problem, systemImage: "exclamationmark.circle").font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                        .glassEffect(.regular.tint(.orange.opacity(0.25)), in: .rect(cornerRadius: 14))
                }
                if let view {
                    cover(view)
                    tabs
                    if tab == "all" {
                        CommonLookCards(draft: $draft, profile: view.profile, host: view.host) { picking = PickingCategory(platform: $0) }
                    } else {
                        PlatformLookCards(link: link, platform: tab, draft: $draft, account: view.platforms.first { $0.id == tab }?.account) {
                            picking = PickingCategory(platform: tab)
                        }
                    }
                } else if problem == nil {
                    ProgressView("Загружаю оформление…").frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(20)
            .padding(.bottom, 80)
        }
        .scrollDismissesKeyboard(.interactively)
        .background { AmbientBackground() }
        .navigationTitle("Оформление эфира")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if saving {
                    ProgressView()
                } else {
                    Button("Сохранить") { Task { await save() } }.disabled(!changed)
                }
            }
        }
        .sheet(item: $picking) { item in
            CategorySearchSheet(link: link, platform: item.platform, current: draft.category(item.platform)) { category in
                var look = draft.look(item.platform)
                look.category = category
                draft.platforms[item.platform] = look
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func cover(_ view: RemoteBroadcastView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            StudioCoverArt(title: view.profile, host: view.host)
                .overlay(alignment: .topTrailing) {
                    Text(draft.cover.kind == "custom" ? "СВОЯ" : "MBS").font(.caption2.weight(.heavy))
                        .padding(.horizontal, 7).padding(.vertical, 3).background(.black.opacity(0.5), in: .capsule).padding(10)
                        .foregroundStyle(.white)
                }
                .shadow(color: .black.opacity(0.3), radius: 12, y: 6)
            Text(draft.cover.kind == "custom" ? "Своя обложка выбрана на ноутбуке и уйдёт на YouTube." : "Обложку рисует MBS по игре: профиль «\(view.profile)», дата и ведущий. Уходит на YouTube.")
                .font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var tabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                LookTabChip(title: "Для всех", platform: nil, own: false, selected: tab == "all") { tab = "all" }
                ForEach(RemoteBroadcast.lookPlatforms, id: \.self) { id in
                    let look = draft.look(id)
                    LookTabChip(title: StudioPlatform.name(id), platform: id, own: look.title != nil || look.description != nil || look.tags != nil,
                                selected: tab == id) { tab = id }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: tab)
    }

    private func load() async {
        do {
            let loaded = try await link.ask(.getBroadcast)?.decode(as: RemoteBroadcastView.self)
            if let loaded {
                view = loaded
                draft = loaded.broadcast
                problem = nil
            }
        } catch {
            problem = error.localizedDescription
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            if let saved = try await link.ask(.setBroadcast(draft))?.decode(as: RemoteBroadcastView.self) {
                view = saved
                draft = saved.broadcast
            }
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
    }
}

private struct PickingCategory: Identifiable {
    let platform: String
    var id: String { platform }
}

private struct LookTabChip: View {
    let title: String
    let platform: String?
    let own: Bool
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let platform {
                    StudioPlatformBadge(platform: platform, size: 20)
                } else {
                    Image(systemName: "square.stack.3d.up.fill").font(.footnote)
                }
                Text(title).font(.subheadline.weight(.semibold))
                if own { Circle().fill(.orange).frame(width: 6, height: 6) }
            }
            .padding(.horizontal, 12).frame(height: 38)
            .foregroundStyle(selected ? .primary : .secondary)
        }
        .buttonStyle(.plain)
        .glassEffect(selected ? .regular.tint(.white.opacity(0.18)).interactive() : .regular.interactive(), in: .capsule)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Общее для всех площадок: название, описание, теги и категории.
private struct CommonLookCards: View {
    @Binding var draft: RemoteBroadcast
    let profile: String
    let host: String
    let pickCategory: (String) -> Void

    var body: some View {
        StudioCard(title: "Название") {
            TextField("Мафия в клубе · {дата}", text: $draft.title, axis: .vertical)
                .font(.title3.weight(.semibold)).lineLimit(1...3).fieldSurface()
            HStack(spacing: 6) {
                ForEach(["{дата}", "{ведущий}", "{профиль}"], id: \.self) { token in
                    Button(token) { draft.title += (draft.title.isEmpty || draft.title.hasSuffix(" ") ? "" : " ") + token }
                        .font(.caption.monospaced()).buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(.small)
                }
                Spacer()
            }
            LimitRow(text: draft.title)
        }
        StudioCard(title: "Описание", note: "только YouTube") {
            TextField("О чём эфир: состав, турнир, ссылки", text: $draft.description, axis: .vertical)
                .lineLimit(3...8).fieldSurface()
        }
        StudioCard(title: "Теги", note: "YouTube и Twitch") {
            PhoneTagEditor(tags: $draft.tags)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(PhoneTagEditor.sets, id: \.0) { set in
                        Button { draft.tags = set.1 } label: { Label(set.0, systemImage: "wand.and.stars") }
                            .font(.caption.weight(.medium)).buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(.small)
                    }
                }
            }
        }
        StudioCard(title: "Категории") {
            ForEach(RemoteBroadcast.lookPlatforms, id: \.self) { id in
                CategoryRow(platform: id, category: draft.category(id), chosen: draft.look(id).category != nil) { pickCategory(id) }
            }
        }
    }
}

struct CategoryRow: View {
    let platform: String
    let category: RemoteBroadcast.Category?
    let chosen: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                StudioPlatformBadge(platform: platform, size: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(category?.name ?? "—").font(.body.weight(.semibold)).lineLimit(1)
                    Text(chosen ? "выбрана вами" : "по умолчанию").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .padding(.vertical, 4)
    }
}

/// Сколько символов осталось на каждой площадке: YouTube до 100, Twitch и VK до 140.
struct LimitRow: View {
    let text: String
    var only: String?

    private static let limits = [("youtube", 100), ("twitch", 140), ("vk", 140)]

    var body: some View {
        HStack(spacing: 12) {
            Spacer()
            ForEach(Self.limits.filter { only == nil || $0.0 == only }, id: \.0) { item in
                let over = text.count > item.1
                HStack(spacing: 4) {
                    StudioPlatformBadge(platform: item.0, size: 14)
                    Text(over ? "\(text.count)/\(item.1)" : "\(item.1 - text.count)").font(.caption.weight(.medium).monospacedDigit())
                }
                .foregroundStyle(over ? .red : .secondary)
            }
        }
    }
}

/// Теги плашками: «Готово» на клавиатуре или запятая добавляют тег, крестик убирает.
struct PhoneTagEditor: View {
    @Binding var tags: [String]
    @State private var draft = ""

    static let sets: [(String, [String])] = [
        ("Обычная игра", ["мафия", "спортивная мафия", "ФИИМ", "настольные игры"]),
        ("Турнир", ["мафия", "спортивная мафия", "турнир", "ФИИМ"]),
        ("Обучение", ["мафия", "обучение", "правила мафии", "для новичков"]),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !tags.isEmpty {
                PhoneFlowLayout(spacing: 6) {
                    ForEach(tags, id: \.self) { tag in
                        HStack(spacing: 4) {
                            Text("#").foregroundStyle(.tint)
                            Text(tag)
                            Button { tags.removeAll { $0 == tag } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                                .buttonStyle(.plain).accessibilityLabel("Убрать тег \(tag)")
                        }
                        .font(.subheadline.weight(.medium))
                        .padding(.leading, 10).padding(.trailing, 6).frame(height: 30)
                        .background(.white.opacity(0.1), in: .capsule)
                    }
                }
            }
            TextField("Добавьте тег", text: $draft)
                .submitLabel(.done).onSubmit(add)
                .onChange(of: draft) { if draft.hasSuffix(",") { add() } }
                .fieldSurface()
        }
    }

    private func add() {
        let tag = draft.trimmingCharacters(in: CharacterSet(charactersIn: ",#").union(.whitespaces))
        draft = ""
        guard !tag.isEmpty, !tags.contains(where: { $0.lowercased() == tag.lowercased() }) else { return }
        tags.append(tag)
    }
}

/// Раскладка в строку с переносом: плашки тегов.
struct PhoneFlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width.map { $0.isFinite ? $0 : 320 } ?? 320
        return CGSize(width: width, height: rows(subviews, width: width).last.map { $0.y + $0.height } ?? 0)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in rows(subviews, width: bounds.width) {
            for (index, x) in row.items {
                subviews[index].place(at: CGPoint(x: bounds.minX + x, y: bounds.minY + row.y), proposal: .unspecified)
            }
        }
    }

    private struct Row {
        var y: CGFloat
        var height: CGFloat = 0
        var items: [(Int, CGFloat)] = []
    }

    private func rows(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows = [Row(y: 0)]
        var x: CGFloat = 0
        for (index, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > width, x > 0, let last = rows.last {
                rows.append(Row(y: last.y + last.height + spacing))
                x = 0
            }
            rows[rows.count - 1].items.append((index, x))
            rows[rows.count - 1].height = max(rows[rows.count - 1].height, size.height)
            x += size.width + spacing
        }
        return rows
    }
}

extension View {
    /// Поле ввода на стекле: тёмная подложка, как в студии.
    func fieldSurface() -> some View {
        padding(.horizontal, 12).padding(.vertical, 10)
            .background(.black.opacity(0.22), in: .rect(cornerRadius: 12))
    }
}
