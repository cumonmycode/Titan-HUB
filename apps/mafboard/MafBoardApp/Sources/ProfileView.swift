import SwiftUI
import MafBoardCore

/// Профиль: Telegram, привязка GoMafia и доступные режимы.
struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @State private var goMafiaLogin = ""
    @State private var goMafiaPassword = ""
    @State private var isLinking = false

    var body: some View {
        NavigationStack {
            Form {
                if let account = model.account {
                    telegramSection(account)
                    goMafiaSection(account)
                    formatsSection(account.hostingAccess)
                }
                Section {
                    Button("Выйти", role: .destructive) { Task { await model.signOut() } }
                }
            }
            .navigationTitle("Профиль")
            .refreshable { await model.refreshAccount() }
        }
    }

    private func telegramSection(_ account: UserAccount) -> some View {
        Section("Telegram") {
            LabeledContent("Имя", value: account.telegram.displayName)
            if let username = account.telegram.username {
                LabeledContent("Username", value: "@\(username)")
            }
            if let phone = account.maskedPhone {
                LabeledContent("Телефон", value: phone)
            }
        }
    }

    @ViewBuilder
    private func goMafiaSection(_ account: UserAccount) -> some View {
        Section {
            if let link = account.goMafia {
                LabeledContent("Игрок", value: link.player.nickname)
                LabeledContent("Клуб", value: link.club?.title ?? "Без клуба")
                if let elo = link.player.elo {
                    LabeledContent("ELO", value: elo.formatted(.number.precision(.fractionLength(0))))
                }
                Button("Отвязать GoMafia", role: .destructive) { Task { await model.unlinkGoMafia() } }
            } else {
                TextField("Логин GoMafia", text: $goMafiaLogin)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Пароль", text: $goMafiaPassword)
                    .textContentType(.password)
                Button(isLinking ? "Проверяем…" : "Привязать") {
                    Task {
                        isLinking = true
                        if await model.linkGoMafia(login: goMafiaLogin, password: goMafiaPassword) {
                            goMafiaPassword = ""
                        }
                        isLinking = false
                    }
                }
                .disabled(goMafiaLogin.isEmpty || goMafiaPassword.isEmpty || isLinking)
            }
        } header: {
            Text("GoMafia")
        } footer: {
            if account.goMafia == nil {
                Text("Без GoMafia доступны только фанки. Пароль проверяется на сервере и не сохраняется.")
            }
        }
    }

    private func formatsSection(_ access: HostingAccess) -> some View {
        Section("Режимы") {
            ForEach(CompetitionFormat.allCases, id: \.self) { format in
                LabeledContent(format.displayName) {
                    Image(systemName: access.allows(format) ? "checkmark.circle.fill" : "lock.fill")
                        .foregroundStyle(access.allows(format) ? .green : .secondary)
                }
            }
        }
    }
}
