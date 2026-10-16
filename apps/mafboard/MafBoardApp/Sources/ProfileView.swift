import SwiftUI
import MafBoardCore

/// «Профиль»: кто вошёл, GoMafia, аккаунт, сессии, режимы, оформление.
struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AccentChoice.storageKey) private var accent = AccentChoice.blue
    @AppStorage(AppearanceChoice.storageKey) private var appearance = AppearanceChoice.system
    @State private var goMafiaLogin = ""
    @State private var goMafiaPassword = ""
    @State private var isLinking = false
    @State private var isConfirmingUnlink = false
    @State private var isConfirmingSignOut = false
    @State private var sessionToRevoke: DeviceSession?

    var body: some View {
        NavigationStack {
            Form {
                if let account = model.account {
                    Section { header(account) }
                    goMafiaSection(account)
                    Section("Аккаунт") {
                        LabeledContent {
                            Text(account.telegram.username.map { "@\($0)" } ?? account.telegram.displayName)
                        } label: {
                            Label("Telegram", systemImage: "paperplane.fill")
                        }
                        LabeledContent {
                            Text(account.maskedPhone ?? "Не указан")
                        } label: {
                            Label("Телефон", systemImage: "phone.fill")
                        }
                    }
                    sessionsSection
                    formatsSection(account.hostingAccess, isLinked: account.goMafia != nil)
                }
                Section("Оформление") {
                    Picker(selection: $appearance) {
                        ForEach(AppearanceChoice.allCases) { Text($0.title).tag($0) }
                    } label: {
                        Label("Тема", systemImage: "circle.lefthalf.filled")
                    }
                    Picker(selection: $accent) {
                        ForEach(AccentChoice.allCases) { choice in
                            Label {
                                Text(choice.title)
                            } icon: {
                                Image(systemName: "circle.fill").foregroundStyle(choice.color)
                            }
                            .tag(choice)
                        }
                    } label: {
                        Label("Акцент", systemImage: "paintpalette")
                    }
                    .pickerStyle(.navigationLink)
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
            .task { await model.refreshSessions() }
            .refreshable {
                async let account: Void = model.refreshAccount()
                async let sessions: Void = model.refreshSessions()
                _ = await (account, sessions)
            }
            .confirmationDialog(
                sessionToRevoke.map { "Выйти на «\($0.displayName)»?" } ?? "",
                isPresented: Binding(get: { sessionToRevoke != nil }, set: { if !$0 { sessionToRevoke = nil } }),
                titleVisibility: .visible,
                presenting: sessionToRevoke
            ) { session in
                Button("Выйти", role: .destructive) { Task { await model.revokeSession(session) } }
            } message: { _ in
                Text("На этом устройстве MafBoard закроется, для входа снова понадобится Telegram.")
            }
        }
    }

    // MARK: Шапка

    private func header(_ account: UserAccount) -> some View {
        let nickname = account.goMafia?.player.nickname ?? account.telegram.displayName
        return HStack(spacing: 14) {
            PlayerAvatar(name: nickname, url: account.goMafia?.player.avatarURL, size: 60)
            VStack(alignment: .leading, spacing: 2) {
                Text(nickname).font(.title3.weight(.semibold)).lineLimit(1)
                Text(account.goMafia?.club?.title ?? "Ведущий")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: GoMafia

    @ViewBuilder
    private func goMafiaSection(_ account: UserAccount) -> some View {
        if let link = account.goMafia {
            Section {
                HStack(spacing: 12) {
                    PlayerAvatar(name: link.player.nickname, url: link.player.avatarURL, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(link.player.nickname)
                        if let elo = link.player.elo {
                            Text("ELO \(elo.formatted(.number.precision(.fractionLength(0))))")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                    }
                    Spacer()
                    Label("Привязан", systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.green)
                }
                LabeledContent("Клуб", value: link.club?.title ?? "Без клуба")
                Button("Обновить профиль", systemImage: "arrow.clockwise") { Task { await model.refreshAccount() } }
                Button("Отвязать GoMafia", systemImage: "link.badge.minus", role: .destructive) { isConfirmingUnlink = true }
                    .confirmationDialog("Отвязать GoMafia?", isPresented: $isConfirmingUnlink, titleVisibility: .visible) {
                        Button("Отвязать", role: .destructive) { Task { await model.unlinkGoMafia() } }
                    } message: {
                        Text("Останутся только фанки.")
                    }
            } header: {
                Text("GoMafia")
            } footer: {
                Text("Профиль и клуб подтягиваются из GoMafia.")
            }
        } else {
            Section {
                TextField("Никнейм", text: $goMafiaLogin)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Пароль", text: $goMafiaPassword)
                    .textContentType(.password)
                Button {
                    Task {
                        isLinking = true
                        if await model.linkGoMafia(login: goMafiaLogin.trimmingCharacters(in: .whitespaces), password: goMafiaPassword) {
                            goMafiaPassword = ""
                        }
                        isLinking = false
                    }
                } label: {
                    if isLinking {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("Привязать").frame(maxWidth: .infinity)
                    }
                }
                .disabled(goMafiaLogin.isEmpty || goMafiaPassword.isEmpty || isLinking)
            } header: {
                Text("GoMafia")
            } footer: {
                Text("Как на gomafia.pro: никнейм (не почта и не телефон) и пароль. Пароль проверяется на сервере и не сохраняется.")
            }
        }
    }

    // MARK: Сессии

    /// Устройства, где выполнен вход. Пока список не загружен (или сервер его не знает) — секции нет.
    @ViewBuilder
    private var sessionsSection: some View {
        if let sessions = model.sessions, !sessions.isEmpty {
            Section {
                ForEach(sessions) { sessionRow($0) }
            } header: {
                Text("Сессии")
            } footer: {
                Text("Устройства, где выполнен вход в ваш аккаунт.")
            }
        }
    }

    private func sessionRow(_ session: DeviceSession) -> some View {
        HStack(spacing: 12) {
            Image(systemName: session.systemImage)
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(session.displayName).lineLimit(1)
                Text(session.isCurrent ? "Текущее" : session.lastSeen(relativeTo: .now))
                    .font(.subheadline)
                    .foregroundStyle(session.isCurrent ? AnyShapeStyle(.green) : AnyShapeStyle(.secondary))
            }
            Spacer()
            if !session.isCurrent {
                Button("Выйти", role: .destructive) { sessionToRevoke = session }
                    .buttonStyle(.borderless)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.red)
            }
        }
    }

    private func formatsSection(_ access: HostingAccess, isLinked: Bool) -> some View {
        Section {
            ForEach(CompetitionFormat.allCases, id: \.self) { format in
                LabeledContent(format.displayName) {
                    Image(systemName: access.allows(format) ? "checkmark" : "lock.fill")
                        .foregroundStyle(access.allows(format) ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                }
            }
        } header: {
            Text("Режимы")
        } footer: {
            if !isLinked {
                Text("Без GoMafia доступны только фанки.")
            }
        }
    }
}

private extension DeviceSession {
    /// Значок по платформе: телефон (iPad — по имени) или компьютер для остального.
    var systemImage: String {
        switch platform {
        case "ios": displayName.localizedCaseInsensitiveContains("ipad") ? "ipad" : "iphone"
        case "android": "smartphone"
        default: "desktopcomputer"
        }
    }
}
