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
    /// Не экран, а действие: открывает «Новую игру».
    case new
    case club
    case profile
}

/// Запрос на новую игру: с нуля или следующей игрой вечера.
struct NewGameRequest: Identifiable {
    let id = UUID()
    var evening: Evening?
}

/// Одна стеклянная панель вкладок iOS: Игры, Рейтинг, Новая, Клуб, Профиль.
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
            Tab("Новая", systemImage: "plus.circle.fill", value: AppTab.new) {
                Color.clear
            }
            Tab("Клуб", systemImage: "person.3", value: AppTab.club) {
                ClubView(onOpenProfile: { tab = .profile })
            }
            Tab("Профиль", systemImage: "person.crop.circle", value: AppTab.profile) {
                ProfileView()
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
