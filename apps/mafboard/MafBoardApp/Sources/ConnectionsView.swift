import SwiftUI
import MafBoardCore

// MARK: - GoMafia

/// Подключение GoMafia: что даёт, вход по никнейму, данные игрока и клуба.
struct GoMafiaConnectionView: View {
    @Environment(AppModel.self) private var model
    @State private var nickname = ""
    @State private var password = ""
    @State private var isLinking = false
    @State private var isConfirmingUnlink = false

    var body: some View {
        List {
            if let link = model.account?.goMafia {
                connected(link)
            } else {
                benefits
                loginForm
            }
        }
        .ambientBackground()
        .navigationTitle("GoMafia")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: Подключено

    @ViewBuilder
    private func connected(_ link: GoMafiaLink) -> some View {
        Section {
            HStack(spacing: 14) {
                PlayerAvatar(name: link.player.nickname, url: link.player.avatarURL, size: 60)
                VStack(alignment: .leading, spacing: 3) {
                    Text(link.player.nickname).font(.title3.weight(.semibold))
                    Label("Подключено", systemImage: "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.green)
                }
            }
            .padding(.vertical, 4)
            if let elo = link.player.elo {
                LabeledContent("ELO", value: elo.formatted(.number.precision(.fractionLength(0))))
            }
            if let tournaments = link.player.tournamentsPlayed {
                LabeledContent("Турниров", value: "\(tournaments)")
            }
        }
        Section("Клуб") {
            if let club = link.club {
                LabeledContent("Название", value: club.title)
                LabeledContent("Город", value: club.city ?? "—")
            } else {
                Text("Вы не состоите в клубе GoMafia — доступны только фанки.").foregroundStyle(.secondary)
            }
        }
        Section {
            LabeledContent("Подключено", value: link.linkedAt.formatted(date: .abbreviated, time: .omitted))
            LabeledContent("Обновлено", value: link.syncedAt.formatted(date: .abbreviated, time: .shortened))
            Button("Обновить данные", systemImage: "arrow.clockwise") { Task { await model.refreshAccount() } }
        } footer: {
            Text("Профиль и клуб подтягиваются из GoMafia раз в сутки.")
        }
        Section {
            Button("Отключить GoMafia", role: .destructive) { isConfirmingUnlink = true }
                .frame(maxWidth: .infinity)
                .confirmationDialog("Отключить GoMafia?", isPresented: $isConfirmingUnlink, titleVisibility: .visible) {
                    Button("Отключить", role: .destructive) { Task { await model.unlinkGoMafia() } }
                } message: {
                    Text("Останутся только фанки. Прошлые игры не пропадут.")
                }
        }
    }

    // MARK: Не подключено

    private var benefits: some View {
        Section {
            Benefit(icon: "trophy.fill", color: .orange, title: "Рейтинг, миникап и турнир", text: "Режимы с таблицами для ведущего клуба.")
            Benefit(icon: "person.3.fill", color: .blue, title: "Игроки из GoMafia", text: "Состав вашего клуба и поиск по всем игрокам.")
            Benefit(icon: "building.columns.fill", color: .purple, title: "История клуба", text: "Ваши игры сохраняются в истории клуба.")
        }
    }

    private var loginForm: some View {
        Group {
            Section {
                TextField("Никнейм", text: $nickname)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Пароль", text: $password)
                    .textContentType(.password)
            } header: {
                Text("Вход в GoMafia")
            } footer: {
                Text("Как на gomafia.pro: никнейм, а не почта или телефон. Пароль проверяется на сервере и не сохраняется.")
            }
            Section {
                Button {
                    Task {
                        isLinking = true
                        if await model.linkGoMafia(login: nickname.trimmingCharacters(in: .whitespaces), password: password) {
                            password = ""
                        }
                        isLinking = false
                    }
                } label: {
                    Group {
                        if isLinking { ProgressView() } else { Text("Подключить").fontWeight(.semibold) }
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(nickname.isEmpty || password.isEmpty || isLinking)
            }
        }
    }
}

private struct Benefit: View {
    let icon: String
    let color: Color
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(color)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Telegram

struct TelegramConnectionView: View {
    @Environment(AppModel.self) private var model

    private static let botURL = URL(string: "https://t.me/mafboard_bot")!

    var body: some View {
        List {
            if let account = model.account {
                Section {
                    LabeledContent("Имя", value: account.telegram.displayName)
                    if let username = account.telegram.username {
                        LabeledContent("Username", value: "@\(username)")
                    }
                    LabeledContent("Телефон", value: account.maskedPhone ?? "Не указан")
                    if let version = account.acceptedTermsVersion {
                        LabeledContent("Соглашение", value: "редакция \(version)")
                    }
                } footer: {
                    Text("Вход в MafBoard — через бота @mafboard_bot. Полный номер телефона хранится только на сервере.")
                }
            }
            Section {
                Link(destination: Self.botURL) {
                    Label("Открыть бота", systemImage: "paperplane")
                }
            }
        }
        .ambientBackground()
        .navigationTitle("Telegram")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Устройства

struct DevicesView: View {
    var body: some View {
        List {
            SessionsSection()
        }
        .ambientBackground()
        .navigationTitle("Устройства")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Оформление

struct AppearanceView: View {
    @AppStorage(AccentChoice.storageKey) private var accent = AccentChoice.blue
    @AppStorage(AppearanceChoice.storageKey) private var appearance = AppearanceChoice.system

    var body: some View {
        List {
            Section("Тема") {
                Picker("Тема", selection: $appearance) {
                    ForEach(AppearanceChoice.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section("Акцентный цвет") {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 4), spacing: 16) {
                    ForEach(AccentChoice.allCases) { choice in
                        Button {
                            accent = choice
                        } label: {
                            Circle()
                                .fill(choice.color)
                                .frame(width: 44, height: 44)
                                .overlay {
                                    if accent == choice {
                                        Image(systemName: "checkmark").font(.headline.bold()).foregroundStyle(.white)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(choice.title)
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .ambientBackground()
        .navigationTitle("Оформление")
        .navigationBarTitleDisplayMode(.inline)
    }
}
