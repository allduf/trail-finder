// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "TrailMap",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "TrailMap", targets: ["TrailMap"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", "8.0.0"..<"9.0.0"),
    ],
    targets: [
        .target(
            name: "TrailMap",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                "MapLibre"
            ],
            path: "ios/Sources/TrailMap"
        ),
        // MapLibre Native (free, open, no key) with 3D mountains: the official one has none yet (maplibre-native issue
        // #252), so this is a community build of its feature/terrain-3d branch, NOT an official MapLibre release
        // (github.com/kaiuhl/maplibre-native, release glassing-terrain-20261109-337f1b4ba8a3, 2026-11-09). Only the
        // alex-only "Native map (test)" and "Native 3D (test)" screens use it. sha256 also in vendor/SOURCES.md.
        .binaryTarget(
            name: "MapLibre",
            url: "https://github.com/kaiuhl/maplibre-native/releases/download/glassing-terrain-20261109-337f1b4ba8a3/MapLibre.dynamic.xcframework.zip",
            checksum: "49fcee33e83d69d87b525f28ab7025727f70affbf17a6afa67cf6d2ff0395bf9"
        )
    ]
)
