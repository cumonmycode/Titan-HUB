import SwiftUI
import MafBoardCore

/// Секция «Сессии» профиля: устройства, где выполнен вход, и выход на других устройствах.
struct SessionsSection: View {
    @Environment(AppModel.self) private var model
    @State private var sessionToRevoke: DeviceSession?

    var body: some View {
        if model.sessionList != .unsupported {
            Section {
                switch model.sessionList {
                case let .loaded(sessions):
                    ForEach(sessions) { row($0) }
                case .failed:
                    Button("Не удалось загрузить — повторить", systemImage: "arrow.clockwise") {
                        Task { await model.refreshSessions() }
                    }
                case .loading, .unsupported:
                    ProgressView().frame(maxWidth: .infinity)
                }
            } header: {
                // Заголовок появляется при каждом показе профиля — тогда и обновляем список.
                Text("Сессии").task { await model.refreshSessions() }
            } footer: {
                Text("Устройства, где выполнен вход в ваш аккаунт.")
            }
        }
    }

    private func row(_ session: DeviceSession) -> some View {
        HStack {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.displayName).lineLimit(1)
                    Text(session.isCurrent ? "Текущее" : session.lastSeen(relativeTo: .now))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: session.systemImage)
            }
            Spacer()
            if !session.isCurrent {
                Button("Выйти", role: .destructive) { sessionToRevoke = session }
                    .buttonStyle(.borderless)
                    .confirmationDialog(
                        "Выйти на «\(session.displayName)»?",
                        isPresented: isConfirmingRevoke(of: session),
                        titleVisibility: .visible
                    ) {
                        Button("Выйти", role: .destructive) { Task { await model.revokeSession(session) } }
                    } message: {
                        Text("На нём придётся заново войти через Telegram.")
                    }
            }
        }
    }

    private func isConfirmingRevoke(of session: DeviceSession) -> Binding<Bool> {
        Binding(
            get: { sessionToRevoke?.id == session.id },
            set: { if !$0 { sessionToRevoke = nil } }
        )
    }
}

private extension DeviceSession {
    /// Значок по платформе: iPhone (iPad — по имени), Android или компьютер для остального.
    var systemImage: String {
        switch platform {
        case "ios": displayName.localizedCaseInsensitiveContains("ipad") ? "ipad" : "iphone"
        case "android": "smartphone"
        default: "desktopcomputer"
        }
    }
}
