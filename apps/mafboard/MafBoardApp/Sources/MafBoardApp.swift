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

enum AppTab: Hashable, CaseIterable {
    case games
    case standings

    var title: String {
        switch self {
        case .games: "Игры"
        case .standings: "Рейтинг"
        }
    }

    var icon: String {
        switch self {
        case .games: "theatermasks"
        case .standings: "trophy"
        }
    }
}

/// Запрос на новую игру: с нуля или следующей игрой вечера.
struct NewGameRequest: Identifiable {
    let id = UUID()
    var evening: Evening?
}

/// Экраны «Игры» и «Рейтинг» и стеклянная панель снизу: слева переключатель экранов,
/// справа — отдельная круглая кнопка «Новая игра». Профиль — аватар в правом верхнем углу.
struct MainTabView: View {
    @Environment(GameLibrary.self) private var library
    @State private var tab = AppTab.games
    @State private var newGame: NewGameRequest?

    var body: some View {
        @Bindable var library = library
        // Оба экрана живут всё время: переключение не сбрасывает прокрутку и навигацию.
        ZStack {
            screen(.games) { GamesView(onNewGame: { newGame = NewGameRequest(evening: $0) }) }
            screen(.standings) { StandingsView() }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            BottomBar(selection: $tab) { newGame = NewGameRequest() }
        }
        .sheet(item: $newGame, onDismiss: library.presentPending) { NewGameFlow(evening: $0.evening) }
        .fullScreenCover(item: $library.presented, onDismiss: {
            // Вышли из игры — к списку игр, где она ждёт в «Продолжить игру».
            tab = .games
        }) { GameScreen(game: $0) }
        .alert("Игры", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(library.errorMessage ?? "")
        }
    }

    private func screen(_ which: AppTab, @ViewBuilder content: () -> some View) -> some View {
        content()
            .opacity(tab == which ? 1 : 0)
            .allowsHitTesting(tab == which)
            .accessibilityHidden(tab != which)
    }
}

/// Стеклянная панель: капсула с экранами слева и круглая «Новая игра» справа — отдельно друг от друга.
private struct BottomBar: View {
    @Binding var selection: AppTab
    let onNewGame: () -> Void
    @Namespace private var highlight

    var body: some View {
        GlassEffectContainer(spacing: 14) {
            HStack(spacing: 14) {
                HStack(spacing: 2) {
                    ForEach(AppTab.allCases, id: \.self) { item($0) }
                }
                .padding(4)
                .glassEffect(.regular.interactive(), in: .capsule)

                Spacer(minLength: 0)

                Button(action: onNewGame) {
                    Image(systemName: "plus")
                        .font(.title2.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Новая игра")
            }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 4)
    }

    private func item(_ tab: AppTab) -> some View {
        Button {
            withAnimation(.snappy) { selection = tab }
        } label: {
            VStack(spacing: 2) {
                Image(systemName: tab.icon).font(.system(size: 18, weight: .semibold))
                Text(tab.title).font(.caption2.weight(.semibold))
            }
            .foregroundStyle(selection == tab ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
            .frame(width: 88, height: 48)
            .background {
                if selection == tab {
                    Capsule()
                        .fill(Color.primary.opacity(0.1))
                        .matchedGeometryEffect(id: "selected", in: highlight)
                }
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selection == tab ? .isSelected : [])
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
