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

/// Таймер речи: кольцо с цифрами (нажатие — пауза, удержание — заново), кнопки старта, сброса и «+30 за фолы».
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

    /// Последние секунды — кольцо и цифры становятся оранжевыми.
    private static let endingSeconds: TimeInterval = 10
    private static let dialSize: CGFloat = 116

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
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .center, spacing: 18) {
                dial
                VStack(spacing: 10) {
                    controls
                    if let offer = game.extraTimeOffer {
                        ExtraTimeButton(offer: offer) { game.takeExtraTime() }
                    }
                }
                .frame(maxWidth: .infinity)
            }
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

    // MARK: Кольцо

    private var dial: some View {
        let fraction = phase == .over ? 1 : timer.fraction(at: now)
        return ZStack {
            Circle().stroke(tint.opacity(0.16), lineWidth: 9)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(tint.gradient, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.2), value: fraction)
            VStack(spacing: 1) {
                Text(format(remaining.rounded(.up)))
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(phase == .running ? AnyShapeStyle(.primary) : AnyShapeStyle(tint))
                    .contentTransition(.numericText(countsDown: true))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(phase == .over ? "стоп" : "из \(format(timer.duration))")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 14)
        }
        .frame(width: Self.dialSize, height: Self.dialSize)
        .background {
            if phase == .over { Circle().fill(Color.red.opacity(0.14)) }
        }
        .modifier(Flashing(isActive: phase == .over))
        .contentShape(.circle)
        .onTapGesture { if phase != .over { game.toggleTimer() } }
        .onLongPressGesture { game.restartTimer() }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(phase == .over ? "Время вышло" : "Осталось \(Int(remaining.rounded(.up))) секунд")
        .accessibilityHint("Нажатие — пауза или старт, удержание — заново")
    }

    // MARK: Кнопки

    private var controls: some View {
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                Button { game.restartTimer() } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.title3.weight(.semibold))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .controlSize(.large)
                .accessibilityLabel("Заново")
                Button { game.toggleTimer() } label: {
                    Image(systemName: timer.isRunning ? "pause.fill" : "play.fill")
                        .font(.title.weight(.bold))
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(timer.isRunning ? "Пауза" : "Старт")
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .tint(timer.isRunning ? .orange : .green)
                .controlSize(.large)
                .disabled(phase == .over)
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

/// «+30 сек · 2 фола»: говорящий берёт время фолами. Неактивна, если фолов стало бы больше лимита.
private struct ExtraTimeButton: View {
    let offer: ExtraTimeOffer
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "plus.circle.fill")
                Text("\(offer.policy.seconds) сек").monospacedDigit()
                Text("· \(offer.policy.fouls) фола").foregroundStyle(.secondary)
            }
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
        .disabled(!offer.isAllowed)
        .accessibilityHint(offer.isAllowed
            ? "Добавит \(offer.policy.seconds) секунд и \(offer.policy.fouls) фола"
            : "Фолов стало бы больше \(offer.policy.maxFouls)")
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
