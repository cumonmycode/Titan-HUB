import SwiftUI
import MafBoardCore

/// Вход в MafBoard Studio: кто просит вход и три кода на выбор. Настоящий код виден только на ноутбуке.
struct StudioLoginSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AccentChoice.storageKey) private var accent = AccentChoice.blue
    @AppStorage(AppearanceChoice.storageKey) private var appearance = AppearanceChoice.system

    private var state: StudioLoginState? { model.studioLogin?.state }

    private var isDone: Bool {
        if case .done = state { true } else { false }
    }

    var body: some View {
        VStack(spacing: 18) {
            switch state {
            case .choosing(let ticket):
                request(ticket, chosen: nil)
            case .approving(let ticket, let code):
                request(ticket, chosen: code)
            case .done(let deviceName):
                outcome(
                    icon: "checkmark.circle.fill", tint: .green, title: "\(deviceName) вошёл",
                    detail: "Эфиром теперь можно управлять с этого телефона: вкладка «Эфир»."
                )
            case .failed(let failure):
                outcome(icon: "exclamationmark.triangle.fill", tint: .orange, title: failure.title, detail: failure.detail)
            case .loading, nil:
                ProgressView("Проверяю QR-код…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { AmbientBackground() }
        .tint(accent.color)
        .preferredColorScheme(appearance.colorScheme)
        .sensoryFeedback(.success, trigger: isDone)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                model.studioLoginClockTick()
            }
        }
    }

    private func request(_ ticket: StudioLoginTicket, chosen: Int?) -> some View {
        VStack(spacing: 18) {
            Spacer(minLength: 0)
            Image(systemName: ticket.platform == "windows" ? "pc" : "laptopcomputer")
                .font(.system(size: 44, weight: .regular))
                .foregroundStyle(.secondary)
            VStack(spacing: 6) {
                Text(ticket.deviceName).font(.title2.bold()).multilineTextAlignment(.center)
                Text("просит вход в ваш аккаунт для MafBoard Studio")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Text("Какой код на экране ноутбука?").font(.headline).padding(.top, 10)
            HStack(spacing: 10) {
                ForEach(ticket.codes, id: \.self) { code in
                    Button {
                        model.chooseStudioCode(code)
                    } label: {
                        Group {
                            if chosen == code {
                                ProgressView()
                            } else {
                                Text(String(code)).font(.system(size: 34, weight: .bold, design: .rounded)).monospacedDigit()
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 76)
                    }
                    .buttonStyle(.solid)
                    .disabled(chosen != nil)
                    .accessibilityLabel("Код \(code)")
                }
            }
            Text("Подтверждайте, только если этот компьютер перед вами. Если код назвал кто-то другой, нажмите «Это не я». Ошибка закрывает вход.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer(minLength: 0)
            Button("Это не я", role: .destructive) { dismiss() }
                .font(.body.weight(.semibold))
                .disabled(chosen != nil)
        }
    }

    private func outcome(icon: String, tint: Color, title: String, detail: String) -> some View {
        VStack(spacing: 14) {
            Spacer(minLength: 0)
            Image(systemName: icon).font(.system(size: 52)).foregroundStyle(tint)
            Text(title).font(.title2.bold()).multilineTextAlignment(.center)
            Text(detail).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Spacer(minLength: 0)
            Button {
                dismiss()
            } label: {
                Text("Готово").frame(maxWidth: .infinity)
            }
            .buttonStyle(.solidProminent)
            .controlSize(.large)
        }
    }
}

private extension StudioLoginFailure {
    var title: String {
        switch self {
        case .expired: "QR-код устарел"
        case .wrongCode: "Код не совпал"
        case .network: "Нет связи"
        }
    }

    var detail: String {
        switch self {
        case .expired: "На ноутбуке уже новый QR-код. Отсканируйте его."
        case .wrongCode: "Вход отклонён. На ноутбуке появится новый QR-код, отсканируйте его и выберите код с экрана."
        case let .network(message): message
        }
    }
}
