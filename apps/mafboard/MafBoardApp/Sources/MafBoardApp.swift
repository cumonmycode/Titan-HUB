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
    case home
    case history
    /// Не экран, а действие: открывает лист «Новая игра».
    case new
    case club
    case profile
}

/// Одна стеклянная панель вкладок iOS: Главная, История, Новый, Мой клуб, Профиль.
struct MainTabView: View {
    @Environment(GameLibrary.self) private var library
    @State private var tab = AppTab.home
    @State private var isCreating = false

    var body: some View {
        @Bindable var library = library
        TabView(selection: Binding(get: { tab }, set: { selected in
            if selected == .new { isCreating = true } else { tab = selected }
        })) {
            Tab("Главная", systemImage: "house", value: AppTab.home) {
                HomeView(onNewGame: { isCreating = true }, onOpenProfile: { tab = .profile })
            }
            Tab("История", systemImage: "clock.arrow.circlepath", value: AppTab.history) {
                HistoryView()
            }
            Tab("Новый", systemImage: "plus.circle", value: AppTab.new) {
                Color.clear
            }
            Tab("Мой клуб", systemImage: "person.3", value: AppTab.club) {
                ClubView(onOpenProfile: { tab = .profile })
            }
            Tab("Профиль", systemImage: "person.crop.circle", value: AppTab.profile) {
                ProfileView()
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .sheet(isPresented: $isCreating, onDismiss: library.presentPending) { NewGameView() }
        .fullScreenCover(item: $library.presented, onDismiss: library.reload) { GameScreen(game: $0) }
        .alert("Игры", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(library.errorMessage ?? "")
        }
    }
}
