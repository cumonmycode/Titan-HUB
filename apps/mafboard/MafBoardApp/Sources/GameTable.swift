import SwiftUI
import MafBoardCore

// MARK: - iPad: сверху наблюдение, снизу действия

/// Экран игры на iPad. Сверху — то, за чем ведущий следит: шаг, крупный таймер и стол — большие карточки игроков
/// в две колонки (1–5 слева, 6–10 справа) со свайпами фола и МТФ, как на iPhone. Снизу — панель действий:
/// кнопки таймера, выставление, голосование или ночь, нарушения выбранного игрока и «Назад» / «Далее».
struct TabletGameLayout: View {
    let game: GameController
    @Binding var focusedSeat: Seat?
    let onBestMove: (Seat) -> Void
    let onProtocol: (Seat) -> Void
    /// «Ещё одна игра» с экрана итогов (уже закрывает экран игры).
    let onNextGame: (() -> Void)?
    let onFinish: () -> Void

    private var state: GameState { game.state }

    private var isNight: Bool {
        switch state.phase {
        case .night, .nightZero: true
        default: false
        }
    }

    /// Тот, кто сейчас на шаге: говорящий или выбывший на заключительной минуте.
    private var currentSeat: Seat? { state.currentSpeaker ?? state.currentStep.farewellSeat }

    /// Игрок, чьи нарушения в панели: выбранный касанием, иначе тот, кто на шаге. Ночью и после игры — никто.
    private var focusTarget: Seat? {
        guard !isNight, !state.isFinished else { return nil }
        return focusedSeat ?? currentSeat
    }

    var body: some View {
        GeometryReader { proxy in
            let isLandscape = proxy.size.width > proxy.size.height
            ScrollView {
                observation(isLandscape: isLandscape)
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
                    .padding(.bottom, 16)
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                actionDock(isLandscape: isLandscape)
            }
        }
        // Всё крупнее, чем на телефоне: экран стоит на столе, ведущий смотрит на него издалека.
        .dynamicTypeSize(.xLarge...)
    }

    // MARK: Наблюдение

    /// Портрет: шаг и табло таймера сверху, стол под ними. Ландшафт: стол слева, шаг и табло колонкой справа —
    /// по высоте помещаются все пять рядов игроков, ничего не уходит под панель действий.
    @ViewBuilder
    private func observation(isLandscape: Bool) -> some View {
        if state.isFinished {
            VStack(spacing: 18) {
                PhaseHeader(game: game, onBestMove: onBestMove)
                if let record = game.record {
                    ResultsCard(game: game, record: record, onBestMove: onBestMove, onProtocol: onProtocol, onNextGame: onNextGame)
                }
            }
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
        } else if isLandscape {
            HStack(alignment: .top, spacing: 20) {
                seats
                VStack(alignment: .leading, spacing: 16) {
                    PhaseHeader(game: game, onBestMove: onBestMove)
                    timerDisplay
                }
                .frame(width: 420)
            }
        } else {
            VStack(spacing: 18) {
                HStack(alignment: .top, spacing: 18) {
                    PhaseHeader(game: game, onBestMove: onBestMove)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    timerDisplay.frame(width: 400)
                }
                seats
            }
        }
    }

    @ViewBuilder
    private var timerDisplay: some View {
        if game.countdown != nil {
            TimerDisplay(game: game).gameCard()
        }
    }

    private var seats: some View {
        SeatColumns(game: game, selected: focusTarget) { seat in
            // Касание того, кто на шаге, или повторное касание выбранного — панель снова у того, кто на шаге.
            focusedSeat = seat == currentSeat || focusTarget == seat ? nil : seat
        }
    }

    // MARK: Действия

    /// Панель внизу: в ландшафте действия шага слева, нарушения выбранного справа; в портрете — друг под другом.
    private func actionDock(isLandscape: Bool) -> some View {
        VStack(spacing: 16) {
            if isLandscape {
                HStack(alignment: .top, spacing: 24) {
                    stepActions.frame(maxWidth: .infinity, alignment: .topLeading)
                    if focusTarget != nil {
                        playerActions.frame(width: 470)
                    }
                }
            } else {
                stepActions
                playerActions
            }
            StepBar(game: game, isDocked: true, onFinish: onFinish)
        }
        .environment(\.isInActionDock, true)
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .background {
            UnevenRoundedRectangle(topLeadingRadius: 32, topTrailingRadius: 32, style: .continuous)
                .fill(.regularMaterial)
                .shadow(color: .black.opacity(0.18), radius: 16, y: -2)
                .ignoresSafeArea(edges: .bottom)
        }
    }

    /// Действия шага: таймер и выставление на речи, голосование, ночь, лучший ход и протокол.
    @ViewBuilder
    private var stepActions: some View {
        switch state.currentStep {
        case let .ballot(candidates, kind):
            Group {
                if state.ruleset.voting.ballotStyle == .handCount {
                    CountVotingPanel(game: game, candidates: candidates, kind: kind)
                } else {
                    VotingPanel(game: game, candidates: candidates, kind: kind)
                }
            }
            .id("\(candidates)|\(kind.rawValue)")
        case let .liftBallot(candidates):
            LiftPanel(game: game, candidates: candidates)
        case let .night(step):
            NightPanel(game: game, step: step)
        case let .farewellBestMove(seat), let .farewellProtocol(seat):
            FarewellActions(game: game, seat: seat, onBestMove: { onBestMove(seat) }, onProtocol: { onProtocol(seat) })
        case .finished, .dusk:
            EmptyView()
        default:
            VStack(alignment: .leading, spacing: 14) {
                TimerButtons(game: game)
                if let speaker = state.currentSpeaker, let seat = state.seat(speaker) {
                    let context = SeatContext(game: game, seat: seat)
                    if context.isFarewell {
                        FarewellActions(game: game, seat: speaker, onBestMove: { onBestMove(speaker) }, onProtocol: { onProtocol(speaker) })
                    }
                    if context.takesNominations {
                        NominationPad(game: game, speaker: speaker)
                    }
                }
            }
        }
    }

    /// Нарушения выбранного игрока (по умолчанию — того, кто на шаге).
    @ViewBuilder
    private var playerActions: some View {
        if let target = focusTarget, let seat = state.seat(target), seat.isAlive {
            VStack(alignment: .leading, spacing: 10) {
                if focusedSeat != nil, let current = currentSeat {
                    Button("К №\(current) \(game.name(of: current))", systemImage: "arrow.uturn.backward") { focusedSeat = nil }
                        .font(.subheadline.weight(.semibold))
                        .buttonStyle(.solid(.capsule))
                        .controlSize(.small)
                }
                DisciplinePanel(game: game, seat: seat, title: "Нарушения · №\(target) \(game.name(of: target))")
            }
            // Свой набор состояний у каждого игрока: вопрос об удалении не переезжает к другому.
            .id(target)
        }
    }
}

// MARK: - Стол

/// Карточки игроков в две колонки: 1–5 слева, 6–10 справа — как места за столом.
private struct SeatColumns: View {
    let game: GameController
    let selected: Seat?
    let onSelect: (Seat) -> Void

    var body: some View {
        let seats = game.state.seats
        let half = Int((Double(seats.count) / 2).rounded(.up))
        HStack(alignment: .top, spacing: 14) {
            column(Array(seats.prefix(half)))
            column(Array(seats.dropFirst(half)))
        }
    }

    private func column(_ seats: [SeatState]) -> some View {
        VStack(spacing: 12) {
            ForEach(seats) { seat in
                TabletSeatCard(context: SeatContext(game: game, seat: seat), isSelected: selected == seat.seat) {
                    onSelect(seat.seat)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }
}

/// Карточка игрока на iPad — как свёрнутая карточка iPhone, только крупнее. Свайп вправо — фол, дальше — МТФ;
/// влево — снять фол, дальше — снять техфол. Касание — игрок в панели нарушений (ночью — ход роли).
private struct TabletSeatCard: View {
    let context: SeatContext
    let isSelected: Bool
    let onSelect: () -> Void

    private static let cornerRadius: CGFloat = 24

    var body: some View {
        let seat = context.seat
        HStack(spacing: 14) {
            PlayerIdentity(context: context, avatarSize: 56, isLarge: true)
            Spacer(minLength: 6)
            PenaltyMarks(fouls: seat.fouls, techFouls: seat.techFoulKinds, dotSize: 10)
            if context.nightAction != nil {
                Text("Выбрать").font(.headline).foregroundStyle(.tint)
            } else if context.isRemoved {
                ReinstateButton(context: context)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(minHeight: 84)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: Self.cornerRadius, style: .continuous))
        .overlay {
            if isSelected || context.isSpeaker {
                RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
                    .stroke(.tint, lineWidth: isSelected ? 3 : 1.5)
            }
        }
        .contentShape(.rect(cornerRadius: Self.cornerRadius, style: .continuous))
        .onTapGesture {
            if let action = context.nightAction { context.game.perform(action) } else { onSelect() }
        }
        .accessibilityAddTraits(.isButton)
        .modifier(PenaltySwipe(game: context.game, seat: seat, isEnabled: seat.isAlive, cornerRadius: Self.cornerRadius))
        .sensoryFeedback(.impact(weight: .medium), trigger: seat.fouls)
    }
}
