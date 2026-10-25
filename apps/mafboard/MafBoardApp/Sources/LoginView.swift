import SwiftUI
import MafBoardCore

/// Вход: кнопка → бот в Telegram (соглашение, номер, код) → возврат в приложение.
struct LoginView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var isShowingReviewLogin = false

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            SleepMaskLogo(size: 104)
                // Вход проверяющего App Store — долгое нажатие на логотип (описано в заметках для App Review).
                .onLongPressGesture(minimumDuration: 1) { isShowingReviewLogin = true }
            Text("MafBoard").font(.largeTitle.bold())
            Text("Компаньон ведущего мафии").foregroundStyle(.secondary)
            Spacer()
            content
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { AmbientBackground() }
        .sheet(isPresented: $isShowingReviewLogin) { ReviewLoginSheet() }
        .onChange(of: model.telegramURLToOpen) { _, url in
            guard let url else { return }
            openURL(url)
            model.telegramURLToOpen = nil
        }
        .task(id: model.login.pollingTicketID) {
            // Пока ждём бота — спрашиваем статус каждые 3 с (если пользователь вернулся сам).
            while !Task.isCancelled, model.login.pollingTicketID != nil {
                try? await Task.sleep(for: .seconds(3))
                await model.pollLogin()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.login.state {
        case .idle, .failed:
            if case let .failed(failure) = model.login.state {
                Text(failure.message).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Button {
                model.startLogin()
            } label: {
                Label("Войти через Telegram", systemImage: "paperplane.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.solidProminent)
            .controlSize(.large)
            Text("Нажимая «Войти», вы перейдёте в бота @mafboard_bot.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button("Попробовать без входа") { model.startDemo() }
                .font(.body.weight(.semibold))
                .padding(.top, 4)
        case let .waitingForTelegram(ticket, _, _):
            VStack(spacing: 12) {
                Text("Код подтверждения").foregroundStyle(.secondary)
                Text(ticket.confirmationCode ?? "—")
                    .font(.system(size: 80, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text("В боте примите соглашение, поделитесь номером и нажмите этот код.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Button("Открыть Telegram") { openURL(ticket.deepLink) }
                    .buttonStyle(.solid)
                    .controlSize(.large)
                Button("Отмена", role: .cancel) { model.cancelLogin() }
            }
        case .requestingTicket, .completing, .signedIn:
            ProgressView("Входим…")
        }
    }
}

/// Вход проверяющего App Store по логину и паролю из заметок для App Review.
private struct ReviewLoginSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var login = ""
    @State private var password = ""
    @State private var isSigningIn = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Логин", text: $login)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Пароль", text: $password)
                        .textContentType(.password)
                } footer: {
                    if let errorText {
                        Text(errorText).foregroundStyle(.red)
                    } else {
                        Text("Для проверки приложения в App Store. Ведущие входят через Telegram.")
                    }
                }
                Section {
                    Button {
                        signIn()
                    } label: {
                        Group {
                            if isSigningIn { ProgressView() } else { Text("Войти").fontWeight(.semibold) }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(login.isEmpty || password.isEmpty || isSigningIn)
                }
            }
            .navigationTitle("Вход для проверки")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена", systemImage: "xmark") { dismiss() }
                }
            }
        }
    }

    private func signIn() {
        isSigningIn = true
        errorText = nil
        Task {
            errorText = await model.reviewLogin(login: login.trimmingCharacters(in: .whitespaces), password: password)
            isSigningIn = false
            if errorText == nil { dismiss() }
        }
    }
}
