import SwiftUI
import MafBoardCore

/// «Профиль»: кто вошёл, подключения, настройки ведущего.
struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var isConfirmingSignOut = false
    @State private var isConfirmingDeletion = false
    @State private var isDeleting = false

    private static let termsURL = URL(string: "https://mafboard.titanpos.ru/terms")!

    var body: some View {
        NavigationStack {
            List {
                if model.phase == .demo {
                    Section {
                        DemoHeader()
                    }
                    .listRowBackground(Color.clear)

                    Section {
                        Button {
                            model.leaveDemo()
                            dismiss()
                        } label: {
                            Label("Войти через Telegram", systemImage: "paperplane.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.solidProminent)
                        .controlSize(.large)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }

                    Section("Ведущий") {
                        NavigationLink {
                            AppearanceView()
                        } label: {
                            Label("Оформление", systemImage: "paintbrush")
                        }
                    }
                }

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

                if model.account != nil {
                    Section {
                        Button("Выйти", role: .destructive) { isConfirmingSignOut = true }
                            .frame(maxWidth: .infinity)
                            .confirmationDialog("Выйти из MafBoard?", isPresented: $isConfirmingSignOut, titleVisibility: .visible) {
                                Button("Выйти", role: .destructive) { Task { await model.signOut() } }
                            }
                    }

                    Section {
                        Button(role: .destructive) {
                            isConfirmingDeletion = true
                        } label: {
                            if isDeleting { ProgressView() } else { Text("Удалить аккаунт") }
                        }
                        .frame(maxWidth: .infinity)
                        .disabled(isDeleting)
                        .confirmationDialog("Удалить аккаунт?", isPresented: $isConfirmingDeletion, titleVisibility: .visible) {
                            Button("Удалить аккаунт", role: .destructive) { deleteAccount() }
                        } message: {
                            Text("Аккаунт, вход на всех устройствах и привязка GoMafia будут удалены, игры на этом телефоне — тоже. Игры в истории клуба останутся без связи с вами. Отменить удаление нельзя.")
                        }
                    } footer: {
                        Text("Удаление необратимо: войти можно будет снова через Telegram, но уже как новый ведущий.")
                    }
                }
            }
            .ambientBackground()
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

    private func deleteAccount() {
        isDeleting = true
        Task {
            let deleted = await model.deleteAccount()
            isDeleting = false
            if deleted { dismiss() }
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

/// Шапка профиля в демо-режиме: что доступно без входа и что даст вход.
private struct DemoHeader: View {
    var body: some View {
        VStack(spacing: 8) {
            SleepMaskLogo(size: 92)
            Text("Демо-режим").font(.title2.weight(.bold))
            Text("Фанки с гостями, игры хранятся только на этом телефоне. Войдите через Telegram, чтобы сохранять историю и вести рейтинг, миникап и турниры клуба GoMafia.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
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
