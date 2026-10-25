import SwiftUI
import MafBoardCore

// MARK: - Стол (iPad)

/// Все игроки сразу, без прокрутки: в ландшафте двумя колонками (1–5 слева, 6–10 справа), как места за столом,
/// в портрете — одной. Нажатие на игрока — он в пульте рядом (ночью — ход роли), фол — кнопкой прямо на плитке.
struct SeatTable: View {
    let game: GameController
    /// Игрок в пульте — его плитка выделена.
    let focused: Seat?
    let columns: Int
    let onSelect: (Seat) -> Void

    var body: some View {
        let seats = game.state.seats
        let perColumn = Int((Double(seats.count) / Double(max(columns, 1))).rounded(.up))
        ScrollView {
            HStack(alignment: .top, spacing: 10) {
                ForEach(0..<max(columns, 1), id: \.self) { column in
                    VStack(spacing: 10) {
                        ForEach(seats.dropFirst(column * perColumn).prefix(perColumn)) { seat in
                            SeatTile(context: SeatContext(game: game, seat: seat), isFocused: focused == seat.seat) {
                                onSelect(seat.seat)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .top)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// Игрок на столе: фото с номером, имя и статус, фолы и техфолы; справа — быстрый «+Фол».
private struct SeatTile: View {
    let context: SeatContext
    let isFocused: Bool
    let onSelect: () -> Void
    @State private var isConfirmingFoul = false

    private var game: GameController { context.game }
    private var seat: SeatState { context.seat }
    private var foulLimit: Int { game.state.ruleset.discipline.foulsToRemoval ?? 4 }

    var body: some View {
        HStack(spacing: 10) {
            PlayerIdentity(context: context, avatarSize: 48)
            Spacer(minLength: 4)
            PenaltyMarks(fouls: seat.fouls, techFouls: seat.techFoulKinds)
            accessory
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(minHeight: 72)
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 20, style: .continuous))
        .overlay {
            if isFocused || context.isSpeaker {
                RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(.tint, lineWidth: isFocused ? 2.5 : 1.5)
            }
        }
        .contentShape(.rect(cornerRadius: 20, style: .continuous))
        .onTapGesture {
            if let action = context.nightAction { game.perform(action) } else { onSelect() }
        }
        .accessibilityAddTraits(.isButton)
        .sensoryFeedback(.impact(weight: .medium), trigger: seat.fouls)
        .confirmationDialog("Удалить №\(seat.seat.number) \(context.name)?", isPresented: $isConfirmingFoul, titleVisibility: .visible) {
            Button("\(foulLimit)-й фол — удалить", role: .destructive) { game.perform(.foul(seat.seat)) }
        } message: {
            Text("\(foulLimit)-й фол удаляет игрока из игры.")
        }
    }

    @ViewBuilder
    private var accessory: some View {
        if context.nightAction != nil {
            Text("Выбрать").font(.subheadline.weight(.semibold)).foregroundStyle(.tint)
        } else if context.isRemoved {
            ReinstateButton(context: context)
        } else if seat.isAlive {
            Button {
                if context.nextFoulRemoves { isConfirmingFoul = true } else { game.perform(.foul(seat.seat)) }
            } label: {
                Text("+Фол").font(.subheadline.weight(.bold)).frame(minHeight: 26)
            }
            .buttonStyle(.solid(.capsule))
            .tint(context.nextFoulRemoves ? .red : .orange)
            .accessibilityLabel("Фол игроку №\(seat.seat.number)")
        }
    }
}
