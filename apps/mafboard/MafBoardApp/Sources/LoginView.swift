import SwiftUI
import MafBoardCore

/// Вход: кнопка → бот в Telegram (соглашение, номер, код) → возврат в приложение.
struct LoginView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "theatermasks.fill")
                .font(.system(size: 72))
                .foregroundStyle(.red.gradient)
            Text("MafBoard").font(.largeTitle.bold())
            Text("Компаньон ведущего мафии").foregroundStyle(.secondary)
            Spacer()
            content
        }
        .padding(24)
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
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            Text("Нажимая «Войти», вы перейдёте в бота @mafboard_bot.")
                .font(.footnote)
                .foregroundStyle(.secondary)
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
                    .buttonStyle(.glass)
                    .controlSize(.large)
                Button("Отмена", role: .cancel) { model.cancelLogin() }
            }
        case .requestingTicket, .completing, .signedIn:
            ProgressView("Входим…")
        }
    }
}
