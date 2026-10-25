import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

@main
struct MafBoardWidgets: WidgetBundle {
    var body: some Widget {
        GameLiveActivity()
    }
}

/// Идущая игра на экране блокировки и в Dynamic Island: номер и имя говорящего, отсчёт его речи,
/// кнопки «Пауза» и «Следующий». Касание самой активности — обратно в игру.
struct GameLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GameActivityAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.62))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(GameActivityAttributes.openURL)
        } dynamicIsland: { context in
            let state = context.state
            let tint = context.attributes.tint
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    SeatBadge(state: state, tint: tint, size: 48)
                        .padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TimerLabel(state: state)
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(TimerLabel.color(for: state))
                        .frame(maxWidth: 120, alignment: .trailing)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(state.name ?? state.title).font(.headline).lineLimit(1)
                        Text("\(state.moment) · \(state.title)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 10) {
                        TimerProgress(state: state, tint: tint)
                        ActivityButtons(context: context)
                    }
                    .padding(.horizontal, 6)
                    .padding(.top, 4)
                }
            } compactLeading: {
                if let seat = state.seat {
                    Text("№\(seat)")
                        .font(.system(.body, design: .rounded).weight(.heavy))
                        .foregroundStyle(tint)
                } else {
                    Image(systemName: state.isNight ? "moon.stars.fill" : "theatermasks.fill").foregroundStyle(tint)
                }
            } compactTrailing: {
                TimerLabel(state: state)
                    .font(.system(.body, design: .rounded).weight(.semibold))
                    .foregroundStyle(TimerLabel.color(for: state))
                    .frame(maxWidth: 48)
            } minimal: {
                if let seat = state.seat {
                    Text("\(seat)").font(.system(.body, design: .rounded).weight(.heavy)).foregroundStyle(tint)
                } else {
                    Image(systemName: "timer").foregroundStyle(tint)
                }
            }
            .widgetURL(GameActivityAttributes.openURL)
            .keylineTint(tint)
        }
    }
}

extension GameActivityAttributes {
    var tint: Color { Color(hue: accentHue, saturation: 0.75, brightness: 1) }
}

// MARK: - Экран блокировки

private struct LockScreenView: View {
    let context: ActivityViewContext<GameActivityAttributes>

    var body: some View {
        let state = context.state
        let tint = context.attributes.tint
        VStack(spacing: 12) {
            HStack(spacing: 14) {
                SeatBadge(state: state, tint: tint, size: 56)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(state.moment) · \(state.title)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.7))
                        .lineLimit(1)
                    Text(state.name ?? state.title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                TimerLabel(state: state)
                    .font(.system(size: 42, weight: .bold, design: .rounded))
                    .foregroundStyle(TimerLabel.color(for: state, base: .white))
                    .frame(maxWidth: 130, alignment: .trailing)
            }
            TimerProgress(state: state, tint: tint)
            ActivityButtons(context: context)
        }
        .padding(16)
    }
}

// MARK: - Части

/// Номер говорящего в круге цвета акцента. Без говорящего — день или ночь.
private struct SeatBadge: View {
    let state: GameActivityAttributes.ContentState
    let tint: Color
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(tint.gradient)
            if let seat = state.seat {
                Text("\(seat)")
                    .font(.system(size: size * 0.48, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
            } else {
                Image(systemName: state.isNight ? "moon.stars.fill" : "sun.max.fill")
                    .font(.system(size: size * 0.4, weight: .semibold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: size, height: size)
    }
}

/// Отсчёт: пока идёт — его ведёт сама система, на паузе — застывшее время, без таймера — ничего.
private struct TimerLabel: View {
    let state: GameActivityAttributes.ContentState

    var body: some View {
        if let end = state.endsAt {
            // Нижняя граница не позже верхней: время могло уже выйти — тогда стоит 0:00.
            Text(timerInterval: min(Date.now, end)...end, countsDown: true)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
        } else if let remaining = state.remaining {
            Text(Duration.seconds(remaining.rounded(.up)).formatted(.time(pattern: .minuteSecond)))
                .monospacedDigit()
        } else {
            Text("")
        }
    }

    /// На паузе цифры приглушены.
    static func color(for state: GameActivityAttributes.ContentState, base: Color = .primary) -> Color {
        state.endsAt == nil ? base.opacity(0.55) : base
    }
}

/// Шкала времени речи: идёт — тает сама, на паузе — стоит.
private struct TimerProgress: View {
    let state: GameActivityAttributes.ContentState
    let tint: Color

    var body: some View {
        if let end = state.endsAt, let duration = state.duration {
            ProgressView(timerInterval: end.addingTimeInterval(-duration)...end, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .tint(tint)
        } else if let remaining = state.remaining, let duration = state.duration, duration > 0 {
            ProgressView(value: min(max(remaining, 0), duration), total: duration)
                .tint(tint.opacity(0.6))
        }
    }
}

/// «Пауза» / «Старт» и «Следующий» — работают, не открывая приложение.
private struct ActivityButtons: View {
    let context: ActivityViewContext<GameActivityAttributes>

    var body: some View {
        let state = context.state
        let gameID = context.attributes.gameID
        let tint = context.attributes.tint
        HStack(spacing: 10) {
            if state.duration != nil {
                Button(intent: ToggleTimerIntent(gameID: gameID)) {
                    Label(state.endsAt == nil ? "Старт" : "Пауза", systemImage: state.endsAt == nil ? "play.fill" : "pause.fill")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(.white.opacity(0.16), in: .capsule)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
            }
            Button(intent: NextStepIntent(gameID: gameID)) {
                HStack(spacing: 6) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Следующий").font(.subheadline.weight(.bold))
                        Text(state.next).font(.caption2).opacity(0.85).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "forward.end.fill").font(.subheadline.weight(.bold))
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(tint.gradient, in: .capsule)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
            .disabled(!state.canAdvance)
            .opacity(state.canAdvance ? 1 : 0.5)
        }
    }
}
