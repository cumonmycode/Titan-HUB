import SwiftUI
import MafBoardCore

/// «Профиль»: кто вошёл, GoMafia, аккаунт, режимы, оформление.
struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AccentChoice.storageKey) private var accent = AccentChoice.blue
    @AppStorage(AppearanceChoice.storageKey) private var appearance = AppearanceChoice.system
    @State private var goMafiaLogin = ""
    @State private var goMafiaPassword = ""
    @State private var isLinking = false
    @State private var isConfirmingUnlink = false
    @State private var isConfirmingSignOut = false

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
                    SessionsSection()
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
            .refreshable { await model.refreshAccount() }
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
