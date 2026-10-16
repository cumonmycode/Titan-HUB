import SwiftUI
import MafBoardCore

/// Профиль: кто вошёл, GoMafia, Telegram, доступные режимы.
struct ProfileView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(AppTheme.storageKey) private var theme = AppTheme.midnight
    @State private var goMafiaLogin = ""
    @State private var goMafiaPassword = ""
    @State private var isLinking = false
    @State private var isConfirmingUnlink = false
    @State private var isConfirmingSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let account = model.account {
                        identityCard(account)
                        goMafiaCard(account)
                        HStack(spacing: 12) {
                            tile(icon: "paperplane.fill", color: .blue, title: "Telegram",
                                 subtitle: account.telegram.username.map { "@\($0)" } ?? account.telegram.displayName, dot: .green)
                            tile(icon: "phone.fill", color: .green, title: "Телефон",
                                 subtitle: account.maskedPhone ?? "не указан", dot: account.maskedPhone == nil ? nil : theme.accent)
                        }
                        formatsCard(account.hostingAccess)
                    }
                    Button("Выйти", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                        isConfirmingSignOut = true
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                    .confirmationDialog("Выйти из MafBoard?", isPresented: $isConfirmingSignOut, titleVisibility: .visible) {
                        Button("Выйти", role: .destructive) { Task { await model.signOut() } }
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .appBackground()
            .navigationTitle("Профиль")
            .refreshable { await model.refreshAccount() }
        }
    }

    // MARK: Кто вошёл

    private func identityCard(_ account: UserAccount) -> some View {
        let nickname = account.goMafia?.player.nickname ?? account.telegram.displayName
        return HStack(spacing: 16) {
            PlayerAvatar(name: nickname, url: account.goMafia?.player.avatarURL, size: 84)
                .padding(4)
                .overlay(RoundedRectangle(cornerRadius: 30, style: .continuous).stroke(theme.accent, lineWidth: 2.5))
            VStack(alignment: .leading, spacing: 8) {
                CapsLabel(text: "Никнейм")
                Text(nickname)
                    .font(.title2.bold())
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.white.opacity(0.07), in: .rect(cornerRadius: 16))
                if let club = account.goMafia?.club {
                    Label(club.title, systemImage: "building.2").font(.subheadline).foregroundStyle(.secondary)
                }
            }
        }
        .glassCard()
    }

    // MARK: GoMafia

    private func goMafiaCard(_ account: UserAccount) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text("GM")
                    .font(.headline.weight(.black))
                    .foregroundStyle(theme.accent)
                    .frame(width: 52, height: 52)
                    .background(.white.opacity(0.07), in: .rect(cornerRadius: 16))
                VStack(alignment: .leading, spacing: 4) {
                    Text("GoMafia").font(.headline)
                    CapsLabel(text: account.goMafia == nil ? "Не подключено" : "Подключено", color: account.goMafia == nil ? .secondary : .green)
                }
                Spacer()
                if account.goMafia != nil {
                    Button("Обновить", systemImage: "arrow.triangle.2.circlepath") { Task { await model.refreshAccount() } }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                    Button("Отвязать", systemImage: "xmark") { isConfirmingUnlink = true }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .tint(.red)
                        .confirmationDialog("Отвязать GoMafia?", isPresented: $isConfirmingUnlink, titleVisibility: .visible) {
                            Button("Отвязать", role: .destructive) { Task { await model.unlinkGoMafia() } }
                        } message: {
                            Text("Останутся только фанки.")
                        }
                }
            }
            if let link = account.goMafia {
                linkedRows(link)
            } else {
                linkForm
            }
        }
        .glassCard()
    }

    private func linkedRows(_ link: GoMafiaLink) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                PlayerAvatar(name: link.player.nickname, url: link.player.avatarURL, size: 36)
                Text(link.player.nickname).font(.headline)
                Spacer()
                if let elo = link.player.elo {
                    Text("ELO \(elo.formatted(.number.precision(.fractionLength(0))))").monospacedDigit().foregroundStyle(.secondary)
                }
            }
            .innerRow()
            HStack {
                Text("Авторизация").foregroundStyle(.secondary)
                Spacer()
                Label("Привязан", systemImage: "checkmark")
                    .font(.subheadline.bold())
                    .foregroundStyle(.green)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.green.opacity(0.15), in: .capsule)
            }
            .innerRow()
        }
    }

    private var linkForm: some View {
        VStack(spacing: 10) {
            TextField("Никнейм в GoMafia", text: $goMafiaLogin)
                .textContentType(.username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .innerRow()
            SecureField("Пароль", text: $goMafiaPassword)
                .textContentType(.password)
                .innerRow()
            Button {
                Task {
                    isLinking = true
                    if await model.linkGoMafia(login: goMafiaLogin.trimmingCharacters(in: .whitespaces), password: goMafiaPassword) {
                        goMafiaPassword = ""
                    }
                    isLinking = false
                }
            } label: {
                Label(isLinking ? "Проверяем…" : "Привязать", systemImage: "link").frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(goMafiaLogin.isEmpty || goMafiaPassword.isEmpty || isLinking)
            Text("Как на gomafia.pro: никнейм (не почта и не телефон) и пароль. Пароль проверяется на сервере и не сохраняется. Без GoMafia доступны только фанки.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Плитки и режимы

    private func tile(icon: String, color: Color, title: String, subtitle: String, dot: Color?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Image(systemName: icon)
                    .font(.title3)
                    .foregroundStyle(color)
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.07), in: .rect(cornerRadius: 14))
                Spacer()
                if let dot { Circle().fill(dot).frame(width: 9, height: 9) }
            }
            Text(title).font(.headline)
            Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
        }
        .glassCard(cornerRadius: 24)
    }

    private func formatsCard(_ access: HostingAccess) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            CapsLabel(text: "Режимы")
            ForEach(CompetitionFormat.allCases, id: \.self) { format in
                HStack {
                    Text(format.displayName)
                    Spacer()
                    Image(systemName: access.allows(format) ? "checkmark.circle.fill" : "lock.fill")
                        .foregroundStyle(access.allows(format) ? AnyShapeStyle(.green) : AnyShapeStyle(.secondary))
                }
                .innerRow()
            }
        }
        .glassCard()
    }
}

private extension View {
    /// Строка внутри стеклянной карточки — без второго слоя стекла.
    func innerRow() -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.06), in: .rect(cornerRadius: 16))
    }
}
