// swift-tools-version: 6.2
import PackageDescription

// Shared by the app and, later, its widget extension. LiftAPI is the client
// generated from the server's OpenAPI document; LiftStore keeps credentials,
// the offline queue and the Apple Health reader.
let package = Package(
  name: "LiftKit",
  platforms: [.iOS(.v26)],
  products: [
    .library(name: "LiftKit", targets: ["LiftAPI", "LiftStore"])
  ],
  dependencies: [
    .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.13.1"),
    .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.12.1"),
    .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.3.1"),
    .package(url: "https://github.com/apple/swift-http-types", from: "1.4.0"),
  ],
  targets: [
    .target(
      name: "LiftAPI",
      dependencies: [
        .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
        .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
        .product(name: "HTTPTypes", package: "swift-http-types"),
      ],
      plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
    ),
    .target(name: "LiftStore", dependencies: ["LiftAPI"]),
    .testTarget(
      name: "LiftKitTests",
      dependencies: ["LiftAPI", "LiftStore"],
      resources: [.copy("Fixtures")]
    ),
  ]
)
