import SwiftUI
import MafBoardCore

// MARK: - Настройки и сохранение таймера

/// Настройки таймера ведущего — общие для всех игр на телефоне.
enum TimerSettings {
    /// Пауза после конца времени перед автопереходом: игрок успевает сказать «Спасибо».
    static let advanceGrace: TimeInterval = 2

    private static let autoStartKey = "timer.autoStart"
    private static let autoAdvanceKey = "timer.autoAdvance"

    /// Таймер запускается сам на каждой речи. По умолчанию — да.
    static var autoStart: Bool {
        get { UserDefaults.standard.object(forKey: autoStartKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: autoStartKey) }
    }

    /// Время вышло — следующая речь сама. По умолчанию — нет.
    static var autoAdvance: Bool {
        get { UserDefaults.standard.bool(forKey: autoAdvanceKey) }
        set { UserDefaults.standard.set(newValue, forKey: autoAdvanceKey) }
    }
}

/// Время текущей речи переживает закрытие экрана игры и перезапуск приложения.
/// Таймер считается от дат, поэтому сохранённый «идёт с 12:03» после перезапуска показывает верный остаток.
enum TimerStore {
    private struct Saved: Codable {
        let step: String
        let countdown: Countdown
    }

    private static func key(_ gameID: GameID) -> String { "timer.\(gameID)" }

    static func save(_ countdown: Countdown, gameID: GameID, step: String) {
        guard let data = try? JSONEncoder().encode(Saved(step: step, countdown: countdown)) else { return }
        UserDefaults.standard.set(data, forKey: key(gameID))
    }

    /// Время этого же шага; другой шаг — `nil` (таймер начнётся заново).
    static func load(gameID: GameID, step: String) -> Countdown? {
        guard let data = UserDefaults.standard.data(forKey: key(gameID)),
              let saved = try? JSONDecoder().decode(Saved.self, from: data),
              saved.step == step
        else { return nil }
        return saved.countdown
    }

    static func clear(gameID: GameID) {
        UserDefaults.standard.removeObject(forKey: key(gameID))
    }
}

// MARK: - Таймер речи

/// Таймер речи: крупные цифры (нажатие — пауза, удержание — заново), шкала и ряд кнопок «Заново», «Старт», «+30 за фолы».
/// Время вышло — таймер стоит на нуле и мигает красным.
struct TimerView: View {
    let game: GameController

    var body: some View {
        if let timer = game.countdown {
            TimelineView(.periodic(from: .now, by: 0.2)) { context in
                TimerFace(game: game, timer: timer, now: context.date)
            }
        }
    }
}

private struct TimerFace: View {
    let game: GameController
    let timer: Countdown
    let now: Date

    private enum Phase {
        case paused
        case running
        case ending
        case over
    }

    /// Последние секунды — шкала и цифры становятся оранжевыми.
    private static let endingSeconds: TimeInterval = 10

    private var remaining: TimeInterval { timer.remaining(at: now) }

    private var phase: Phase {
        if timer.isExpired(at: now) { return .over }
        if !timer.isRunning { return .paused }
        return remaining <= Self.endingSeconds ? .ending : .running
    }

    private var tint: Color {
        switch phase {
        case .paused: .secondary
        case .running: .accentColor
        case .ending: .orange
        case .over: .red
        }
    }

    /// Вибро: 1 — последние секунды, 2 — время вышло.
    private var hapticStage: Int {
        switch phase {
        case .ending where timer.isRunning: 1
        case .over: 2
        default: 0
        }
    }

    var body: some View {
        VStack(spacing: 12) {
            VStack(spacing: 8) {
                time
                ProgressCapsule(fraction: phase == .over ? 1 : timer.fraction(at: now), tint: tint)
            }
            .modifier(Flashing(isActive: phase == .over))
            controls
            HStack(spacing: 8) {
                Label(statusText, systemImage: statusIcon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
                    .contentTransition(.opacity)
                Spacer(minLength: 4)
                autoMenu
            }
        }
        .sensoryFeedback(trigger: hapticStage) { _, stage in
            switch stage {
            case 1: .warning
            case 2: .error
            default: nil
            }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: timer.isRunning)
    }

    private var time: some View {
        Text(format(remaining.rounded(.up)))
            .font(.system(size: 56, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(phase == .running ? AnyShapeStyle(.primary) : AnyShapeStyle(tint))
            .contentTransition(.numericText(countsDown: true))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
            .onTapGesture { if phase != .over { game.toggleTimer() } }
            .onLongPressGesture { game.restartTimer() }
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel(phase == .over ? "Время вышло" : "Осталось \(Int(remaining.rounded(.up))) секунд из \(Int(timer.duration))")
            .accessibilityHint("Нажатие — пауза или старт, удержание — заново")
    }

    // MARK: Кнопки

    /// Три равные кнопки: заново, старт или пауза, +30 за фолы (только у говорящего).
    private var controls: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                Button { game.restartTimer() } label: {
                    TimerButtonLabel(icon: "arrow.counterclockwise", title: "Заново")
                }
                .buttonStyle(.glass)

                Button { game.toggleTimer() } label: {
                    TimerButtonLabel(icon: timer.isRunning ? "pause.fill" : "play.fill", title: timer.isRunning ? "Пауза" : "Старт")
                }
                .buttonStyle(.glassProminent)
                .tint(timer.isRunning ? .orange : .green)
                .disabled(phase == .over)

                if let offer = game.extraTimeOffer {
                    Button { game.takeExtraTime() } label: {
                        TimerButtonLabel(title: "+\(offer.policy.seconds)", caption: "\(offer.policy.fouls) фола")
                    }
                    .buttonStyle(.glass)
                    .disabled(!offer.isAllowed)
                    .accessibilityLabel("Плюс \(offer.policy.seconds) секунд за \(offer.policy.fouls) фола")
                    .accessibilityHint(offer.isAllowed ? "" : "Фолов стало бы больше \(offer.policy.maxFouls)")
                }
            }
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .controlSize(.large)
        }
    }

    private var autoMenu: some View {
        Menu {
            Toggle(isOn: Binding(get: { game.autoStartsTimer }, set: { game.setAutoStart($0) })) {
                Label("Запускать сам", systemImage: "play.circle")
            }
            Toggle(isOn: Binding(get: { game.autoAdvances }, set: { game.setAutoAdvance($0) })) {
                Label("Дальше по окончании", systemImage: "forward.end")
            }
        } label: {
            Label(autoTitle, systemImage: game.autoStartsTimer || game.autoAdvances ? "bolt.fill" : "bolt.slash")
                .font(.caption.weight(.semibold))
        }
        .buttonStyle(.glass)
        .controlSize(.small)
    }

    private var autoTitle: String {
        if game.autoAdvances { return "Авто: дальше сам" }
        return game.autoStartsTimer ? "Авто" : "Вручную"
    }

    private var statusText: String {
        switch phase {
        case .paused: timer.elapsed(at: now) == 0 ? "Ждёт старта" : "Пауза"
        case .running: "Идёт · из \(format(timer.duration))"
        case .ending: "Последние секунды"
        case .over: game.autoAdvances ? "Время вышло — дальше…" : "Время вышло"
        }
    }

    private var statusIcon: String {
        switch phase {
        case .paused: "pause.circle"
        case .running: "timer"
        case .ending: "exclamationmark.circle"
        case .over: "bell.fill"
        }
    }

    private func format(_ seconds: TimeInterval) -> String {
        Duration.seconds(seconds).formatted(.time(pattern: .minuteSecond))
    }
}

/// Подпись кнопки таймера: значок или крупный текст сверху, подпись снизу. Кнопки одной высоты и ширины.
private struct TimerButtonLabel: View {
    var icon: String?
    let title: String
    var caption: String?

    var body: some View {
        VStack(spacing: 2) {
            if let icon {
                Image(systemName: icon).font(.title3.weight(.bold)).contentTransition(.symbolEffect(.replace))
                Text(title).font(.caption.weight(.semibold))
            } else {
                Text(title).font(.title3.weight(.bold)).monospacedDigit()
                Text(caption ?? "").font(.caption.weight(.semibold))
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: .infinity, minHeight: 44)
    }
}

/// Шкала времени: заполненная часть — сколько осталось.
private struct ProgressCapsule: View {
    let fraction: Double
    let tint: Color

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(tint.opacity(0.15))
                Capsule()
                    .fill(tint.gradient)
                    .frame(width: max(8, proxy.size.width * min(max(fraction, 0), 1)))
            }
        }
        .frame(height: 8)
        .animation(.linear(duration: 0.2), value: fraction)
        .accessibilityHidden(true)
    }
}

/// Мигание, пока время вышло.
private struct Flashing: ViewModifier {
    let isActive: Bool

    func body(content: Content) -> some View {
        if isActive {
            content.phaseAnimator([1.0, 0.25]) { view, opacity in
                view.opacity(opacity)
            } animation: { _ in
                .easeInOut(duration: 0.5)
            }
        } else {
            content
        }
    }
}
