// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "V7ImeMac",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "V7ImeMac",
            path: "Sources/V7ImeMac"
        )
    ]
)
