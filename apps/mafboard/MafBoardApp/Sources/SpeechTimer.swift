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
/// Тикают только цифры, шкала и строка статуса; кнопки перестраиваются, лишь когда таймер запускают или останавливают.
struct TimerView: View {
    let game: GameController
    /// Крупные цифры — на широком экране (iPad).
    var isLarge = false

    var body: some View {
        if let timer = game.countdown {
            VStack(spacing: 12) {
                TimelineView(.timerTick(timer)) { context in
                    TimerDial(game: game, timer: timer, now: context.date, isLarge: isLarge)
                }
                TimerControls(game: game, timer: timer)
                HStack(spacing: 8) {
                    TimelineView(.timerTick(timer)) { context in
                        TimerStatus(timer: timer, now: context.date, autoAdvances: game.autoAdvances)
                    }
                    Spacer(minLength: 4)
                    TimerAutoMenu(game: game)
                }
            }
        }
    }
}

extension TimelineSchedule where Self == AnimationTimelineSchedule {
    /// Тик таймера: пока идёт — пять раз в секунду, на паузе и после конца — ни одного.
    static func timerTick(_ timer: Countdown) -> AnimationTimelineSchedule {
        .animation(minimumInterval: 0.2, paused: !timer.isRunning)
    }
}

/// Что сейчас с таймером: на паузе, идёт, последние секунды, время вышло.
private enum TimerPhase {
    case paused
    case running
    case ending
    case over

    /// Последние секунды — шкала и цифры становятся оранжевыми.
    private static let endingSeconds: TimeInterval = 10

    init(_ timer: Countdown, at now: Date) {
        if timer.isExpired(at: now) {
            self = .over
        } else if !timer.isRunning {
            self = .paused
        } else {
            self = timer.remaining(at: now) <= Self.endingSeconds ? .ending : .running
        }
    }

    var tint: Color {
        switch self {
        case .paused: .secondary
        case .running: .accentColor
        case .ending: .orange
        case .over: .red
        }
    }
}

private func timerText(_ seconds: TimeInterval) -> String {
    Duration.seconds(seconds).formatted(.time(pattern: .minuteSecond))
}

/// Цифры и шкала.
private struct TimerDial: View {
    let game: GameController
    let timer: Countdown
    let now: Date
    let isLarge: Bool

    private var remaining: TimeInterval { timer.remaining(at: now) }

    /// Вибро: 1 — последние секунды, 2 — время вышло.
    private var hapticStage: Int {
        switch TimerPhase(timer, at: now) {
        case .ending where timer.isRunning: 1
        case .over: 2
        default: 0
        }
    }

    var body: some View {
        let phase = TimerPhase(timer, at: now)
        VStack(spacing: 8) {
            Text(timerText(remaining.rounded(.up)))
                .font(.system(size: isLarge ? 96 : 56, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(phase == .running ? AnyShapeStyle(.primary) : AnyShapeStyle(phase.tint))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(maxWidth: .infinity)
                .contentShape(.rect)
                .onTapGesture { if phase != .over { game.toggleTimer() } }
                .onLongPressGesture { game.restartTimer() }
                .accessibilityAddTraits(.isButton)
                .accessibilityLabel(phase == .over ? "Время вышло" : "Осталось \(Int(remaining.rounded(.up))) секунд из \(Int(timer.duration))")
                .accessibilityHint("Нажатие — пауза или старт, удержание — заново")
            ProgressCapsule(fraction: phase == .over ? 1 : timer.fraction(at: now), tint: phase.tint, isRunning: timer.isRunning)
        }
        .modifier(Flashing(isActive: phase == .over))
        .sensoryFeedback(trigger: hapticStage) { _, stage in
            switch stage {
            case 1: .warning
            case 2: .error
            default: nil
            }
        }
    }
}

/// Строка статуса: «Идёт · из 1:00», «Пауза», «Время вышло».
private struct TimerStatus: View {
    let timer: Countdown
    let now: Date
    let autoAdvances: Bool

    var body: some View {
        let phase = TimerPhase(timer, at: now)
        Label(text(phase), systemImage: icon(phase))
            .font(.caption.weight(.semibold))
            .foregroundStyle(phase.tint)
    }

    private func text(_ phase: TimerPhase) -> String {
        switch phase {
        case .paused: timer.elapsed(at: now) == 0 ? "Ждёт старта" : "Пауза"
        case .running: "Идёт · из \(timerText(timer.duration))"
        case .ending: "Последние секунды"
        case .over: autoAdvances ? "Время вышло — дальше…" : "Время вышло"
        }
    }

    private func icon(_ phase: TimerPhase) -> String {
        switch phase {
        case .paused: "pause.circle"
        case .running: "timer"
        case .ending: "exclamationmark.circle"
        case .over: "bell.fill"
        }
    }
}

// MARK: Кнопки

/// Три равные кнопки: заново, старт или пауза, +30 за фолы (только у говорящего).
private struct TimerControls: View {
    let game: GameController
    let timer: Countdown

    var body: some View {
        let isOver = timer.isExpired(at: .now)
        HStack(spacing: 8) {
            Button { game.restartTimer() } label: {
                TimerButtonLabel(icon: "arrow.counterclockwise", title: "Заново")
            }
            .buttonStyle(.solid)

            Button { game.toggleTimer() } label: {
                TimerButtonLabel(icon: timer.isRunning ? "pause.fill" : "play.fill", title: timer.isRunning ? "Пауза" : "Старт")
            }
            .buttonStyle(.solidProminent)
            .tint(timer.isRunning ? .orange : .green)
            .disabled(isOver)

            if let offer = game.extraTimeOffer {
                Button { game.takeExtraTime() } label: {
                    TimerButtonLabel(title: "+\(offer.policy.seconds)", caption: "\(offer.policy.fouls) фола")
                }
                .buttonStyle(.solid)
                .disabled(!offer.isAllowed)
                .accessibilityLabel("Плюс \(offer.policy.seconds) секунд за \(offer.policy.fouls) фола")
                .accessibilityHint(offer.isAllowed ? "" : "Фолов стало бы больше \(offer.policy.maxFouls)")
            }
        }
        .controlSize(.large)
        .sensoryFeedback(.impact(weight: .medium), trigger: timer.isRunning)
    }
}

/// «Авто»: запускать таймер самому и переходить дальше по окончании.
private struct TimerAutoMenu: View {
    let game: GameController

    var body: some View {
        Menu {
            Toggle(isOn: Binding(get: { game.autoStartsTimer }, set: { game.setAutoStart($0) })) {
                Label("Запускать сам", systemImage: "play.circle")
            }
            Toggle(isOn: Binding(get: { game.autoAdvances }, set: { game.setAutoAdvance($0) })) {
                Label("Дальше по окончании", systemImage: "forward.end")
            }
        } label: {
            Label(title, systemImage: game.autoStartsTimer || game.autoAdvances ? "bolt.fill" : "bolt.slash")
                .font(.caption.weight(.semibold))
        }
        .buttonStyle(.solid(.capsule))
        .controlSize(.small)
    }

    private var title: String {
        if game.autoAdvances { return "Авто: дальше сам" }
        return game.autoStartsTimer ? "Авто" : "Вручную"
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
    /// Идёт — шкала тает плавно; запуск заново и конец — быстрый переход без тягучести.
    let isRunning: Bool

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
        .animation(isRunning ? .linear(duration: 0.2) : .snappy(duration: 0.2), value: fraction)
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
