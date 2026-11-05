// swift-tools-version: 6.2
import PackageDescription

// MafBoardCore — правила, игровой движок, баллы, рейтинги, аккаунты и вход. Только Foundation:
// без SwiftUI/SwiftData, чтобы тот же код собирался под Android (Swift SDK for Android)
// и мог работать на сервере.
// MafBoardClient — HTTP-клиент API MafBoard (вход через Telegram, GoMafia, история клуба).
// MafBoardRemote — пульт MafBoard Studio: шифрование и протокол. Отдельно, потому что нужен CryptoKit.
let package = Package(
    name: "MafBoardCore",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "MafBoardCore", targets: ["MafBoardCore"]),
        .library(name: "MafBoardClient", targets: ["MafBoardClient"]),
        .library(name: "MafBoardRemote", targets: ["MafBoardRemote"]),
    ],
    targets: [
        .target(name: "MafBoardCore"),
        .target(name: "MafBoardClient", dependencies: ["MafBoardCore"]),
        .target(name: "MafBoardRemote"),
        .testTarget(name: "MafBoardCoreTests", dependencies: ["MafBoardCore"]),
        .testTarget(name: "MafBoardClientTests", dependencies: ["MafBoardClient", "MafBoardCore"]),
        .testTarget(
            name: "MafBoardRemoteTests",
            dependencies: ["MafBoardRemote"],
            // Копия docs/remote-test-vectors.json из MafBoard Studio: те же векторы проверяет Rust.
            resources: [.copy("remote-test-vectors.json")]
        ),
    ]
)
