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

/// Таймер речи: крупные цифры (нажатие — пауза, удержание — заново), цветная шкала и стеклянные кнопки.
/// После нуля время идёт дальше красным «+0:05» — ведущий видит перебор.
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
    private var overtime: TimeInterval { timer.overtime(at: now) }

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

    /// Вибро только у идущего таймера: 1 — последние секунды, 2 — время вышло.
    private var hapticStage: Int {
        guard timer.isRunning else { return 0 }
        switch phase {
        case .ending: return 1
        case .over: return 2
        case .paused, .running: return 0
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                time
                Spacer(minLength: 4)
                controls
            }
            ProgressCapsule(fraction: phase == .over ? 1 : timer.fraction(at: now), tint: tint)
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
        Text(overtime > 0 ? "+" + format(overtime) : format(remaining.rounded(.up)))
            .font(.system(size: 50, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(phase == .running ? AnyShapeStyle(.primary) : AnyShapeStyle(tint))
            .contentTransition(.numericText(countsDown: true))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .contentShape(.rect)
            .onTapGesture { game.toggleTimer() }
            .onLongPressGesture { game.restartTimer() }
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel("Осталось \(Int(remaining.rounded(.up))) секунд")
            .accessibilityHint("Нажатие — пауза или старт, удержание — заново")
    }

    private var controls: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                Button("Заново", systemImage: "arrow.counterclockwise") { game.restartTimer() }
                    .labelStyle(.iconOnly)
                    .font(.body.weight(.semibold))
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                Button { game.extendTimer() } label: {
                    Text("+30").font(.subheadline.weight(.bold)).monospacedDigit()
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.capsule)
                Button(timer.isRunning ? "Пауза" : "Старт", systemImage: timer.isRunning ? "pause.fill" : "play.fill") {
                    game.toggleTimer()
                }
                .labelStyle(.iconOnly)
                .font(.title3.weight(.bold))
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .tint(timer.isRunning ? .orange : .green)
                .controlSize(.large)
                .disabled(phase == .over && !timer.isRunning)
            }
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
        case .running: "Идёт"
        case .ending: "Последние секунды"
        case .over: game.autoAdvances && timer.isRunning ? "Время вышло — дальше…" : "Время вышло"
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

/// Шкала времени: заполненная часть — сколько осталось.
private struct ProgressCapsule: View {
    let fraction: Double
    let tint: Color

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.08))
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
