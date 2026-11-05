import SwiftUI
import MafBoardCore
import MafBoardRemote

/// Пульт: сцены, микрофон, камера, вывод в сеть и запись на ноутбуке с MafBoard Studio.
struct StudioRemoteView: View {
    @Environment(AppModel.self) private var model
    @State private var isConfirmingForget = false

    var body: some View {
        NavigationStack {
            Group {
                if let link = model.studioLink {
                    StudioRemoteContent(link: link, deviceName: model.studioPairing?.deviceName ?? "Ноутбук")
                } else {
                    ContentUnavailableView(
                        "Ноутбук не подключён",
                        systemImage: "laptopcomputer",
                        description: Text("Откройте MafBoard Studio и отсканируйте QR-код камерой телефона.")
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { AmbientBackground() }
            .navigationTitle("Эфир")
            .toolbar {
                if model.studioPairing != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu("Ещё", systemImage: "ellipsis") {
                            Button("Отключить ноутбук", systemImage: "xmark.circle", role: .destructive) { isConfirmingForget = true }
                        }
                    }
                }
            }
            .confirmationDialog("Отключить ноутбук?", isPresented: $isConfirmingForget, titleVisibility: .visible) {
                Button("Отключить", role: .destructive) { Task { await model.forgetStudio() } }
            } message: {
                Text("Телефон перестанет управлять эфиром, сам эфир не прервётся. Подключить снова можно новым QR-кодом.")
            }
        }
    }
}

private struct StudioRemoteContent: View {
    let link: StudioLink
    let deviceName: String

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ConnectionHeader(connection: link.connection, deviceName: deviceName, denied: link.localNetworkDenied)
                    if !link.engineOnline {
                        Banner(text: "Движок перезапускается. Запись и вывод вернутся сами.", icon: "arrow.triangle.2.circlepath")
                    }
                    if let notice = link.notice {
                        Banner(text: notice, icon: "exclamationmark.circle")
                            .onTapGesture { link.dismissNotice() }
                    }
                    if let state = link.state {
                        SceneGrid(state: state) { link.send(.switchScene($0)) }
                        MicRow(muted: state.micMuted, peakDb: link.peakDb) { link.send(.setMicMuted(!state.micMuted)) }
                        CameraRow(state: state) { link.send(.selectCamera($0)) }
                        LanRow(enabled: state.lanEnabled, address: state.lanUrls.first) { link.send(.setLanEnabled($0)) }
                    } else {
                        ProgressView("Подключаюсь к ноутбуку…").frame(maxWidth: .infinity).padding(.top, 40)
                    }
                }
                .padding(20)
            }
            .tabBarClearance()
            .overlay(alignment: .bottom) {
                if let state = link.state {
                    RecordButton(recording: state.recording, seconds: link.stats?.recordingSeconds) {
                        link.send(.startRecording)
                    } onStop: {
                        link.send(.stopRecording)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 84)
                }
            }
        }
    }
}

private struct ConnectionHeader: View {
    let connection: StudioLink.Connection
    let deviceName: String
    let denied: Bool

    private var title: String {
        switch connection {
        case .lan: "По сети"
        case .cloud: "Через облако"
        case .laptopOffline: "Ноутбук не в сети"
        case .searching: "Ищу ноутбук"
        }
    }

    private var icon: String {
        switch connection {
        case .lan: "wifi"
        case .cloud: "cloud"
        case .laptopOffline: "wifi.slash"
        case .searching: "antenna.radiowaves.left.and.right"
        }
    }

    private var tint: Color {
        switch connection {
        case .lan, .cloud: .green
        case .laptopOffline: .orange
        case .searching: .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(deviceName).font(.headline).lineLimit(1)
                Spacer()
                Label(title, systemImage: icon).font(.subheadline.weight(.semibold)).foregroundStyle(tint)
            }
            if denied {
                Text("Разрешите MafBoard доступ к локальной сети в Настройках, иначе пульт работает только через облако.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct Banner: View {
    let text: String
    let icon: String

    var body: some View {
        Label(text, systemImage: icon)
            .font(.subheadline)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .glassEffect(.regular, in: .rect(cornerRadius: 14))
    }
}

private struct SceneGrid: View {
    let state: RemoteState
    let onSelect: (String) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
            ForEach(state.scenes) { scene in
                let isActive = scene.id == state.activeScene
                Button {
                    onSelect(scene.id)
                } label: {
                    VStack(spacing: 8) {
                        Image(systemName: Self.icon(for: scene.id)).font(.title2)
                        Text(scene.name).font(.footnote.weight(.semibold)).lineLimit(2).multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, minHeight: 84)
                    .foregroundStyle(isActive ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                    .contentShape(.rect(cornerRadius: 16))
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 16))
                .overlay {
                    if isActive {
                        RoundedRectangle(cornerRadius: 16).strokeBorder(.tint, lineWidth: 2)
                    }
                }
                .accessibilityAddTraits(isActive ? .isSelected : [])
                .sensoryFeedback(.selection, trigger: isActive)
            }
        }
    }

    private static func icon(for sceneID: String) -> String {
        switch sceneID {
        case "game": "video"
        case "break": "cup.and.saucer"
        case "soon": "clock"
        default: "rectangle.on.rectangle"
        }
    }
}

private struct RemoteRow<Trailing: View>: View {
    let title: String
    let icon: String
    @ViewBuilder let trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            Label(title, systemImage: icon).lineLimit(1)
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 52)
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
    }
}

private struct MicRow: View {
    let muted: Bool
    let peakDb: Double?
    let onToggle: () -> Void

    private static let silenceDb = -60.0
    private static let bars = 10

    private var level: Double {
        guard !muted, let peakDb else { return 0 }
        return min(1, max(0, (peakDb - Self.silenceDb) / -Self.silenceDb))
    }

    var body: some View {
        Button(action: onToggle) {
            RemoteRow(title: muted ? "Микрофон выключен" : "Микрофон", icon: muted ? "mic.slash" : "mic") {
                HStack(spacing: 3) {
                    ForEach(0..<Self.bars, id: \.self) { index in
                        let lit = Double(index) / Double(Self.bars) < level
                        Capsule()
                            .fill(lit ? AnyShapeStyle(.green) : AnyShapeStyle(.quaternary))
                            .frame(width: 4, height: 6 + CGFloat(index))
                    }
                }
                .animation(.linear(duration: 0.15), value: level)
                .accessibilityHidden(true)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(muted ? AnyShapeStyle(.orange) : AnyShapeStyle(.primary))
        .accessibilityValue(muted ? "выключен" : "включён")
    }
}

private struct CameraRow: View {
    let state: RemoteState
    let onSelect: (String) -> Void

    private var current: String {
        state.cameras.first { $0.id == state.cameraUid }?.name ?? "Нет камеры"
    }

    var body: some View {
        Menu {
            ForEach(state.cameras) { camera in
                Button {
                    onSelect(camera.id)
                } label: {
                    if camera.id == state.cameraUid {
                        Label(camera.name, systemImage: "checkmark")
                    } else {
                        Text(camera.name)
                    }
                }
            }
        } label: {
            RemoteRow(title: "Камера", icon: "camera") {
                Text(current).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct LanRow: View {
    let enabled: Bool
    let address: String?
    let onChange: (Bool) -> Void

    var body: some View {
        RemoteRow(title: "В локальную сеть", icon: "dot.radiowaves.left.and.right") {
            Toggle("В локальную сеть", isOn: Binding(get: { enabled }, set: onChange)).labelsHidden()
        }
    }
}

/// Запись начинается нажатием, а завершается только удержанием: случайно оборвать её нельзя.
private struct RecordButton: View {
    let recording: Bool
    let seconds: UInt64?
    let onStart: () -> Void
    let onStop: () -> Void

    private static let holdSeconds = 1.1
    @State private var isHolding = false

    private var clock: String {
        let total = seconds ?? 0
        return String(format: "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
    }

    var body: some View {
        if recording {
            VStack(spacing: 2) {
                Text("Завершить запись").font(.headline)
                Text("\(clock) · удерживайте").font(.footnote).monospacedDigit()
            }
            .frame(maxWidth: .infinity, minHeight: 60)
            .foregroundStyle(.red)
            .background(alignment: .leading) {
                GeometryReader { box in
                    Rectangle()
                        .fill(.red.opacity(0.25))
                        .frame(width: isHolding ? box.size.width : 0)
                        .animation(isHolding ? .linear(duration: Self.holdSeconds) : .easeOut(duration: 0.2), value: isHolding)
                }
            }
            .clipShape(.rect(cornerRadius: 18))
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 18))
            .contentShape(.rect(cornerRadius: 18))
            .onLongPressGesture(minimumDuration: Self.holdSeconds, perform: onStop) { isHolding = $0 }
            .sensoryFeedback(.impact(weight: .heavy), trigger: recording)
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel("Завершить запись")
            .accessibilityAction(named: "Завершить запись", onStop)
        } else {
            Button(action: onStart) {
                Label("Начать запись", systemImage: "record.circle").font(.headline).frame(maxWidth: .infinity, minHeight: 60)
            }
            .buttonStyle(.solidProminent)
        }
    }
}
