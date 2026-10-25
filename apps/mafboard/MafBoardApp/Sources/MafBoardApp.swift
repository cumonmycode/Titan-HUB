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
        LiveGameActivity.shared.installActions()
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
                    // Активности прошлого запуска без открытой игры — закрыть, чтобы не висел застывший таймер.
                    LiveGameActivity.shared.endOrphans()
                }
                .onOpenURL { url in
                    // Касание Live Activity — обратно в игру.
                    if url == GameActivityAttributes.openURL {
                        if library.presented == nil { library.resumeActive() }
                    } else {
                        model.handle(url: url)
                    }
                }
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

    #if DEBUG
    @State private var demoGame = DemoGame.isRequested ? DemoGame.make() : nil
    #endif

    var body: some View {
        Group {
            #if DEBUG
            if let demoGame {
                GameScreen(game: demoGame)
            } else {
                phaseView
            }
            #else
            phaseView
            #endif
        }
        .tint(accent.color)
        .preferredColorScheme(appearance.colorScheme)
        .connectionIndicator()
        .task(id: model.libraryUser) {
            // Игры — только вошедшего ведущего (или демо-режима); идущая игра подтягивается с сервера.
            #if DEBUG
            if model.phase == .demo, let scene = ScreenshotScene.requested, !scene.isGame {
                GameFiles.removeGames(of: AppModel.demoUserID)
                library.switchUser(model.libraryUser)
                scene.seed(library)
                return
            }
            #endif
            library.switchUser(model.libraryUser)
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

    @ViewBuilder
    private var phaseView: some View {
        switch model.phase {
        case .loading: ProgressView()
        case .signedOut: LoginView()
        case .signedIn, .demo: MainTabView()
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

    /// Вкладка при запуске. В отладочной сборке скриншот рейтинга открывает сразу «Рейтинг».
    @MainActor static var initial: AppTab {
        #if DEBUG
        ScreenshotScene.requested == .standings ? .standings : .games
        #else
        .games
        #endif
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
    @State private var tab = AppTab.initial
    @State private var newGame: NewGameRequest?
    /// «Следующая игра» с экрана итогов: откроется, когда игра закроется.
    @State private var nextEvening: Evening?

    var body: some View {
        @Bindable var library = library
        // Оба экрана живут всё время: переключение не сбрасывает прокрутку и навигацию.
        ZStack {
            screen(.games) { GamesView(onNewGame: { newGame = NewGameRequest(evening: $0) }) }
            screen(.standings) { StandingsView() }
        }
        // Панель поверх экранов; место под неё каждый список оставляет сам (`tabBarClearance`).
        .overlay(alignment: .bottom) {
            BottomBar(selection: $tab) { newGame = NewGameRequest() }
        }
        .sheet(item: $newGame, onDismiss: library.presentPending) { NewGameFlow(evening: $0.evening) }
        .fullScreenCover(item: $library.presented, onDismiss: {
            // Вышли из игры — к списку игр, где она ждёт в «Продолжить игру».
            tab = .games
            if let evening = nextEvening {
                nextEvening = nil
                // Свежий вечер: в нём состав только что законченной игры.
                newGame = NewGameRequest(evening: library.evenings.first { $0.id == evening.id } ?? evening)
            }
        }) { game in
            GameScreen(game: game, onNextGame: openEvening(of: game).map { evening in { nextEvening = evening } })
        }
        .alert("Игры", isPresented: Binding(get: { library.errorMessage != nil }, set: { if !$0 { library.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(library.errorMessage ?? "")
        }
    }

    /// Открытый вечер игры — из него можно начать следующую игру тем же составом.
    private func openEvening(of game: GameController) -> Evening? {
        guard let id = game.session.setup.seriesID else { return nil }
        return library.evenings.first { $0.id == id && $0.isOpen }
    }

    private func screen(_ which: AppTab, @ViewBuilder content: () -> some View) -> some View {
        content()
            .opacity(tab == which ? 1 : 0)
            .allowsHitTesting(tab == which)
            .accessibilityHidden(tab != which)
    }
}

/// На широком экране (iPad) содержимое списка — колонкой читаемой ширины по центру, а прокручивается он на всю ширину.
private struct ReadableColumn: ViewModifier {
    let maxWidth: CGFloat
    @State private var width: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .contentMargins(.horizontal, max(0, (width - maxWidth) / 2), for: .scrollContent)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}

extension View {
    /// Лист на пол-экрана — только на телефоне. На iPad лист сразу во всю высоту: клавиатура номеров не обрезана.
    func phoneDetents(_ detents: Set<PresentationDetent>) -> some View {
        presentationDetents(UIDevice.current.userInterfaceIdiom == .pad ? [.large] : detents)
    }

    /// Колонка читаемой ширины для `ScrollView`/`List` на iPad. На телефоне ничего не меняет.
    func readableColumn(maxWidth: CGFloat = 820) -> some View {
        modifier(ReadableColumn(maxWidth: maxWidth))
    }
}

extension View {
    /// Место под нижней панелью вкладок: конец списка не прячется под ней.
    /// Ставится прямо на `ScrollView`/`List` экрана — отступ снаружи `NavigationStack` до списка не доходит.
    func tabBarClearance() -> some View {
        safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear.frame(height: 76).allowsHitTesting(false)
        }
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
        // На iPad панель не растягивается на всю ширину — остаётся под рукой, как на телефоне.
        .frame(maxWidth: 520)
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
                        let name = model.account?.goMafia?.player.nickname ?? model.account?.telegram.displayName
                            ?? (model.phase == .demo ? "Демо" : "?")
                        PlayerAvatar(name: name, url: model.account?.goMafia?.player.avatarURL, size: 34)
                    }
                    .accessibilityLabel("Профиль")
                }
                .sharedBackgroundVisibility(.hidden)
            }
            .sheet(isPresented: $isShowingProfile) { ProfileView() }
    }
}
