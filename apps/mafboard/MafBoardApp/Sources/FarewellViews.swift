import SwiftUI
import MafBoardCore

// MARK: - Заключительная речь: лучший ход и протокол

/// Игрок, для которого открыт лист (лучший ход, протокол).
struct SeatPick: Identifiable, Equatable {
    let seat: Seat
    var id: Int { seat.number }
}

extension GameState {
    /// Протокол оставляет убитый ночью или заголосованный (ФСМ 4.8.4). Удалённые — нет.
    func mayLeaveProtocol(_ seat: Seat) -> Bool {
        switch self.seat(seat)?.elimination?.cause {
        case .killed, .votedOut: true
        default: false
        }
    }

    func colorProtocol(by seat: Seat) -> ColorProtocol? {
        protocols.first { $0.author == seat }
    }

    /// Игроки с правом лучшего хода, который ещё не записан.
    var pendingBestMoveAuthors: [Seat] {
        bestMoveAuthors.filter(awaitsBestMove)
    }
}

/// Кнопки в карточке говорящего на заключительной речи: лучший ход — до речи, протокол — после.
struct FarewellActions: View {
    let game: GameController
    let seat: Seat
    let onBestMove: () -> Void
    let onProtocol: () -> Void

    var body: some View {
        let state = game.state
        VStack(alignment: .leading, spacing: 8) {
            if state.bestMoveAuthors.contains(seat) {
                if let move = state.bestMove(by: seat) {
                    Button(action: onBestMove) {
                        Label("ЛХ: " + move.seats.map { "№\($0)" }.joined(separator: ", "), systemImage: "star.fill")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.orange)
                } else {
                    Button(action: onBestMove) {
                        Label("Лучший ход", systemImage: "star.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(.orange)
                    .controlSize(.large)
                }
            }
            if state.mayLeaveProtocol(seat) {
                let proto = state.colorProtocol(by: seat)
                Button(action: onProtocol) {
                    Label(proto == nil ? "Протокол" : "Изменить протокол", systemImage: "list.clipboard")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
                if let proto {
                    Text(proto.summary).font(.caption).foregroundStyle(.secondary)
                } else if state.seat(seat)?.elimination?.cause == .votedOut {
                    Text("Заголосованный оставляет протокол, только если к голосованию он был достоверно красным.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: - Лучший ход

/// Лучший ход (ФСМ 4.8.2): ночью, не снимая маски, за 20 секунд — до трёх номеров, кого игрок считает чёрными.
struct BestMoveSheet: View {
    let game: GameController
    let author: Seat
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<Seat> = []

    private var limit: Int { game.state.ruleset.bestMove.maxSeats(playerCount: game.state.seats.count) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("№\(author) \(game.name(of: author)) называет до \(limit) номеров, кого считает чёрными. Названные номера по правилам не меняются — правка здесь только для ошибки ввода.")
                    .foregroundStyle(.secondary)
                Keypad(count: game.state.seats.count) { number in
                    let seat = Seat(number)
                    let style: KeypadKey.Style = seat == author ? .disabled : (selected.contains(seat) ? .selected : .normal)
                    KeypadKey(number: number, style: style) {
                        if selected.contains(seat) {
                            selected.remove(seat)
                        } else if selected.count < limit {
                            selected.insert(seat)
                        }
                    }
                }
                Spacer()
            }
            .padding()
            .background { AmbientBackground() }
            .navigationTitle("Лучший ход №\(author)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Принято", systemImage: "checkmark") {
                        if game.perform(.recordBestMoveBy(author: author, seats: selected.sorted())) { dismiss() }
                    }
                    .disabled(selected.isEmpty)
                }
            }
            .onAppear { selected = Set(game.state.bestMove(by: author)?.seats ?? []) }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Протокол

/// Протокол после заключительной речи (ФСМ 4.8.4–4.8.7): только цвета и роли.
/// Нажатие на номер: чёрный → красный → (у ПУ) шериф по версии → снять.
struct ProtocolSheet: View {
    let game: GameController
    let author: Seat
    @Environment(\.dismiss) private var dismiss
    @State private var marks: [Seat: Mark] = [:]
    @State private var versionValue = 40

    enum Mark {
        case black
        case red
        case sheriff

        var caption: String {
            switch self {
            case .black: "чёрный"
            case .red: "красный"
            case .sheriff: "шериф"
            }
        }

        var tint: Color {
            switch self {
            case .black: Team.black.tint
            case .red: Team.red.tint
            case .sheriff: .orange
            }
        }
    }

    /// Цена версии (ФСМ 8.3.9.10), в сотых.
    private static let versionValues = [40, 20, 0]

    private var state: GameState { game.state }
    private var isFirstKilled: Bool { state.firstKilled == author }

    private var draft: ColorProtocol {
        func seats(_ mark: Mark) -> [Seat] { marks.filter { $0.value == mark }.map(\.key).sorted() }
        return ColorProtocol(
            author: author, blacks: seats(.black), reds: seats(.red),
            version: seats(.sheriff).first.map { SheriffVersion(sheriff: $0, value: Points(hundredths: versionValue)) }
        )
    }

    /// Оценку видно, только когда роли открыты: экран ведущего могут увидеть игроки.
    private var preview: Points? {
        guard game.showsRoles || state.isFinished, !marks.isEmpty else { return nil }
        return GameScorer.protocolPoints(draft, seats: state.seats, nights: state.nights, policy: state.setup.scoring)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(isFirstKilled
                         ? "Протокол ПУ: чёрные, красные и версия на шерифа. Нажатие: чёрный → красный → шериф → снять."
                         : "Кого №\(author) считает чёрными и кого красными. Нажатие: чёрный → красный → снять.")
                        .foregroundStyle(.secondary)
                    Keypad(count: state.seats.count) { number in
                        let seat = Seat(number)
                        let mark = marks[seat]
                        KeypadKey(
                            number: number, caption: mark?.caption,
                            style: seat == author ? .disabled : (mark == nil ? .normal : .selected),
                            tint: mark?.tint
                        ) { cycle(seat) }
                    }
                    if marks.values.contains(.sheriff) {
                        VStack(alignment: .leading, spacing: 6) {
                            Picker("Цена версии", selection: $versionValue) {
                                ForEach(Self.versionValues, id: \.self) { Text("±\(Points(hundredths: $0).description)").tag($0) }
                            }
                            .pickerStyle(.segmented)
                            Text("0.4 — «шериф / дон» или «шериф, дон / красный»; 0.2 — «красный / красный», «чёрный / чёрный» или второе вскрытие уже после ухода ПУ; 0 — одно вскрытие.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let preview {
                        Label("Оценка протокола: \(preview.signed)", systemImage: "plusminus.circle")
                            .font(.headline)
                            .foregroundStyle(preview >= .zero ? Color.green : Color.red)
                    }
                    Text("В протокол записывают только цвета и роли. Достоверные цвета и проверенных самим шерифом красных судья не оценивает.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .padding()
            }
            .background { AmbientBackground() }
            .navigationTitle("Протокол №\(author)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово", systemImage: "checkmark") {
                        if game.perform(.recordProtocol(draft)) { dismiss() }
                    }
                    .disabled(marks.isEmpty)
                }
            }
            .onAppear(perform: load)
        }
        .presentationDetents([.large])
    }

    private func cycle(_ seat: Seat) {
        switch marks[seat] {
        case nil: marks[seat] = .black
        case .black: marks[seat] = .red
        case .red:
            if isFirstKilled {
                // Версия — на одного шерифа: прежняя отметка снимается.
                for (other, mark) in marks where mark == .sheriff { marks[other] = nil }
                marks[seat] = .sheriff
            } else {
                marks[seat] = nil
            }
        case .sheriff: marks[seat] = nil
        }
    }

    private func load() {
        guard let proto = state.colorProtocol(by: author) else { return }
        var loaded: [Seat: Mark] = [:]
        for seat in proto.blacks { loaded[seat] = .black }
        for seat in proto.reds { loaded[seat] = .red }
        if let version = proto.version {
            loaded[version.sheriff] = .sheriff
            versionValue = version.value.hundredths
        }
        marks = loaded
    }
}
