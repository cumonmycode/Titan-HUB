import SwiftUI

@main
struct MafBoardApp: App {
    @State private var model = AppModel()
    @State private var library = GameLibrary()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(library)
                .task {
                    library.uploader = { [model] record in await model.uploadGame(record) }
                    await model.bootstrap()
                    await library.uploadPending()
                }
                .onOpenURL { model.handle(url: $0) }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.pollLogin() } }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppTheme.storageKey) private var theme = AppTheme.midnight

    var body: some View {
        Group {
            switch model.phase {
            case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background { AppBackground() }
            case .signedOut: LoginView()
            case .signedIn: MainTabView()
            }
        }
        .preferredColorScheme(.dark)
        .tint(theme.accent)
        .alert(
            "Ошибка",
            isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.errorMessage ?? "")
        }
    }
}

// MARK: - Вкладки

enum AppTab: Hashable {
    case host
    case players
    case themes
    case profile

    var title: String {
        switch self {
        case .host: "Судья"
        case .players: "Игроки"
        case .themes: "Темы"
        case .profile: "Профиль"
        }
    }

    var icon: String {
        switch self {
        case .host: "play.circle"
        case .players: "person.2"
        case .themes: "paintpalette"
        case .profile: "person.crop.circle"
        }
    }
}

struct MainTabView: View {
    @Environment(GameLibrary.self) private var library
    @State private var tab = AppTab.host
    @State private var isCreating = false

    var body: some View {
        @Bindable var library = library
        Group {
            switch tab {
            case .host: HomeView { isCreating = true }
            case .players: PlayersView()
            case .themes: ThemesView()
            case .profile: ProfileView()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            GlassTabBar(selection: $tab) { isCreating = true }
        }
        .sheet(isPresented: $isCreating, onDismiss: library.presentPending) { NewGameView() }
        .fullScreenCover(item: $library.presented, onDismiss: library.reload) { GameScreen(game: $0) }
        .alert("Игры", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(library.errorMessage ?? "")
        }
    }
}

/// Нижняя панель на Liquid Glass: две группы вкладок и между ними «Новая».
/// Стёкла в одном контейнере перетекают друг в друга, выбранная вкладка подсвечивается.
struct GlassTabBar: View {
    @Binding var selection: AppTab
    let onNew: () -> Void
    @Namespace private var highlight
    @AppStorage(AppTheme.storageKey) private var theme = AppTheme.midnight

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                group([.host, .players])
                newButton
                group([.themes, .profile])
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 2)
    }

    private func group(_ tabs: [AppTab]) -> some View {
        HStack(spacing: 0) {
            ForEach(tabs, id: \.self) { item($0) }
        }
        .padding(5)
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private func item(_ tab: AppTab) -> some View {
        Button {
            withAnimation(.snappy) { selection = tab }
        } label: {
            VStack(spacing: 3) {
                Image(systemName: tab.icon).font(.system(size: 19, weight: .semibold))
                Text(tab.title).font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(selection == tab ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
            .frame(maxWidth: .infinity, minHeight: 50)
            .background {
                if selection == tab {
                    Capsule()
                        .fill(theme.accent.opacity(0.28))
                        .matchedGeometryEffect(id: "selected", in: highlight)
                }
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
    }

    private var newButton: some View {
        Button(action: onNew) {
            VStack(spacing: 2) {
                Image(systemName: "plus").font(.system(size: 22, weight: .bold))
                Text("Новая").font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(.white)
            .frame(width: 66, height: 60)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(theme.accent.opacity(0.85)).interactive(), in: .rect(cornerRadius: 22))
        .shadow(color: theme.accent.opacity(0.55), radius: 14, y: 4)
    }
}
