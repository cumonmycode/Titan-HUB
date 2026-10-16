import SwiftUI
import MafBoardCore

/// «Профиль»: кто вошёл, подключения, настройки ведущего.
struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var isConfirmingSignOut = false

    private static let termsURL = URL(string: "https://mafboard.titanpos.ru/terms")!

    var body: some View {
        NavigationStack {
            List {
                if let account = model.account {
                    Section {
                        ProfileHeader(account: account)
                    }
                    .listRowBackground(Color.clear)

                    Section {
                        NavigationLink {
                            ClubView()
                        } label: {
                            ConnectionRow(
                                title: "Мой клуб",
                                detail: account.goMafia?.club?.title ?? "Нет клуба",
                                isConnected: nil
                            ) {
                                Image(systemName: "person.3.fill").font(.system(size: 13))
                            }
                            .tint(.purple)
                        }
                    }

                    Section("Подключения") {
                        NavigationLink {
                            GoMafiaConnectionView()
                        } label: {
                            ConnectionRow(
                                title: "GoMafia",
                                detail: account.goMafia?.player.nickname ?? "Не подключено",
                                isConnected: account.goMafia != nil
                            ) {
                                Text("GM").font(.system(size: 13, weight: .black))
                            }
                            .tint(.orange)
                        }
                        NavigationLink {
                            TelegramConnectionView()
                        } label: {
                            ConnectionRow(
                                title: "Telegram",
                                detail: account.telegram.username.map { "@\($0)" } ?? account.telegram.displayName,
                                isConnected: true
                            ) {
                                Image(systemName: "paperplane.fill")
                            }
                            .tint(.blue)
                        }
                        NavigationLink {
                            DevicesView()
                        } label: {
                            ConnectionRow(title: "Устройства", detail: devicesDetail, isConnected: nil) {
                                Image(systemName: "laptopcomputer.and.iphone")
                            }
                            .tint(.gray)
                        }
                    }

                    Section("Ведущий") {
                        LabeledContent {
                            Text(account.hostingAccess.allows(.rating) ? "Все режимы" : "Только фанка")
                        } label: {
                            Label("Режимы", systemImage: "theatermasks")
                        }
                        NavigationLink {
                            AppearanceView()
                        } label: {
                            Label("Оформление", systemImage: "paintbrush")
                        }
                    }
                }

                Section {
                    Link(destination: Self.termsURL) {
                        Label("Пользовательское соглашение", systemImage: "doc.text")
                    }
                    LabeledContent {
                        Text(Self.version)
                    } label: {
                        Label("Версия", systemImage: "info.circle")
                    }
                }

                Section {
                    Button("Выйти", role: .destructive) { isConfirmingSignOut = true }
                        .frame(maxWidth: .infinity)
                        .confirmationDialog("Выйти из MafBoard?", isPresented: $isConfirmingSignOut, titleVisibility: .visible) {
                            Button("Выйти", role: .destructive) { Task { await model.signOut() } }
                        }
                }
            }
            .navigationTitle("Профиль")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово", systemImage: "checkmark") { dismiss() }
                }
            }
            .refreshable { await model.refreshAccount() }
            .task { await model.refreshSessions() }
        }
    }

    private var devicesDetail: String {
        if case let .loaded(sessions) = model.sessionList { return "\(sessions.count)" }
        return ""
    }

    private static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(short) (\(build))"
    }
}

private struct ProfileHeader: View {
    let account: UserAccount

    var body: some View {
        let name = account.goMafia?.player.nickname ?? account.telegram.displayName
        VStack(spacing: 8) {
            PlayerAvatar(name: name, url: account.goMafia?.player.avatarURL, size: 92)
            Text(name).font(.title2.weight(.bold))
            Text([account.telegram.username.map { "@\($0)" }, account.goMafia?.club?.title].compactMap { $0 }.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Строка подключения в стиле «Настроек»: цветной значок, название, состояние.
struct ConnectionRow<Icon: View>: View {
    let title: String
    let detail: String
    /// `nil` — без точки состояния.
    let isConnected: Bool?
    @ViewBuilder let icon: Icon

    var body: some View {
        HStack(spacing: 12) {
            icon
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(.tint, in: .rect(cornerRadius: 7))
            Text(title).foregroundStyle(.primary)
            Spacer()
            if let isConnected {
                Circle().fill(isConnected ? Color.green : Color.secondary.opacity(0.4)).frame(width: 8, height: 8)
            }
            Text(detail).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}
