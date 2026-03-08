// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CursorMobile",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(name: "CursorMobileShared", targets: ["CursorMobileShared"])
    ],
    targets: [
        .target(
            name: "CursorMobileShared",
            path: "Sources/CursorMobileShared"
        ),
        .target(
            name: "CursorMobileApp",
            dependencies: ["CursorMobileShared"],
            path: "Sources/CursorMobileApp"
        ),
        .testTarget(
            name: "CursorMobileSharedTests",
            dependencies: ["CursorMobileShared"],
            path: "Tests/CursorMobileSharedTests"
        )
    ]
)
