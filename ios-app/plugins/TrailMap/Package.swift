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
        // MapLibre Native (free, open, no key): the same map engine as the website's 3D view, built for the iPhone.
        .package(url: "https://github.com/maplibre/maplibre-gl-native-distribution.git", exact: "6.31.0")
    ],
    targets: [
        .target(
            name: "TrailMap",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "MapLibre", package: "maplibre-gl-native-distribution")
            ],
            path: "ios/Sources/TrailMap"
        )
    ]
)
