import SwiftUI

@main
struct MafBoardApp: App {
    @State private var model: AppModel
    @State private var library: GameLibrary
    @State private var sync: GameSync
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let model = AppModel()
        let library = GameLibrary()
        _model = State(initialValue: model)
        _library = State(initialValue: library)
        _sync = State(initialValue: GameSync(library: library, model: model))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(library)
                .environment(sync)
                .task {
                    library.uploader = { [model] record in await model.uploadGame(record) }
                    library.onActiveChanged = { [sync] in sync.activeChanged() }
                    await model.bootstrap()
                }
                .onOpenURL { model.handle(url: $0) }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task {
                await model.pollLogin()
                await sync.refresh()
            }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(GameLibrary.self) private var library
    @Environment(GameSync.self) private var sync
    @AppStorage(AccentChoice.storageKey) private var accent = AccentChoice.blue
    @AppStorage(AppearanceChoice.storageKey) private var appearance = AppearanceChoice.system

    var body: some View {
        Group {
            switch model.phase {
            case .loading: ProgressView()
            case .signedOut: LoginView()
            case .signedIn: MainTabView()
            }
        }
        .tint(accent.color)
        .preferredColorScheme(appearance.colorScheme)
        .connectionIndicator()
        .task(id: model.account?.id) {
            // Игры — только вошедшего ведущего; идущая игра подтягивается с сервера.
            library.switchUser(model.account?.id)
            await sync.refresh()
        }
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
    case games
    case standings
    /// Не экран, а действие: открывает «Новую игру». Стоит справа отдельно — как поиск в App Store.
    case new
}

/// Запрос на новую игру: с нуля или следующей игрой вечера.
struct NewGameRequest: Identifiable {
    let id = UUID()
    var evening: Evening?
}

/// Стеклянная панель вкладок: «Игры» и «Рейтинг», справа отдельной кнопкой — «Новая».
/// Профиль — аватар в правом верхнем углу, как в App Store.
struct MainTabView: View {
    @Environment(GameLibrary.self) private var library
    @State private var tab = AppTab.games
    @State private var newGame: NewGameRequest?

    var body: some View {
        @Bindable var library = library
        TabView(selection: Binding(get: { tab }, set: { selected in
            if selected == .new { newGame = NewGameRequest() } else { tab = selected }
        })) {
            Tab("Игры", systemImage: "theatermasks", value: AppTab.games) {
                GamesView(onNewGame: { newGame = NewGameRequest(evening: $0) })
            }
            Tab("Рейтинг", systemImage: "trophy", value: AppTab.standings) {
                StandingsView()
            }
            Tab("Новая", systemImage: "plus", value: AppTab.new, role: .search) {
                Color.clear
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .sheet(item: $newGame, onDismiss: library.presentPending) { NewGameFlow(evening: $0.evening) }
        .fullScreenCover(item: $library.presented, onDismiss: library.reload) { GameScreen(game: $0) }
        .alert("Игры", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(library.errorMessage ?? "")
        }
    }
}

// MARK: - Профиль в углу

extension View {
    /// Аватар ведущего в правом верхнем углу — открывает профиль, как в App Store.
    func profileButton() -> some View {
        modifier(ProfileButton())
    }
}

private struct ProfileButton: ViewModifier {
    @Environment(AppModel.self) private var model
    @State private var isShowingProfile = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingProfile = true
                    } label: {
                        let name = model.account?.goMafia?.player.nickname ?? model.account?.telegram.displayName ?? "?"
                        PlayerAvatar(name: name, url: model.account?.goMafia?.player.avatarURL, size: 34)
                    }
                    .accessibilityLabel("Профиль")
                }
                .sharedBackgroundVisibility(.hidden)
            }
            .sheet(isPresented: $isShowingProfile) { ProfileView() }
    }
}
