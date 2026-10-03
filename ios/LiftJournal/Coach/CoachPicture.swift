import LiftAPI
import LiftStore
import LiftTheme
import SwiftUI
import UIKit

extension EnvironmentValues {
  /// Whether tapping a dish's picture opens it full screen. Off on the call
  /// screen, which shows one thing at a time over the call.
  @Entry var picturesOpenFullScreen = true
}

/// A picture of a dish Coach drew for a recipe card, fetched with the
/// athlete's session. It is drawn after the card appears, so this asks again
/// every second and a half while it is being drawn, for up to 45 seconds. It
/// is always marked as an AI picture, and tapping it opens it full screen.
/// A picture already fetched shows at once when its card scrolls back into
/// view.
struct CoachPicture: View {
  @Environment(AppModel.self) private var app
  @Environment(\.picturesOpenFullScreen) private var opensFullScreen
  let id: String
  let title: String
  /// A shorter strip in a compact card; otherwise 4:3 at full width.
  var height: CGFloat?

  enum Phase { case drawing, ready(UIImage), unavailable }
  /// What a reply means for the picture.
  enum Outcome: Equatable { case ready, drawing, gone }

  @State private var phase = Phase.drawing
  @State private var viewing = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  static let interval: Duration = .milliseconds(1500)
  static let patience: Duration = .seconds(45)
  /// Pictures fetched this session, by id.
  static let cache = NSCache<NSString, UIImage>()

  /// 200 is the picture and 202 still drawing; no answer, a busy server or a
  /// release in progress is worth asking again; anything else (404) is gone.
  static func outcome(status: Int) -> Outcome {
    switch status {
    case 200: .ready
    case 0, 202, 429, 500...: .drawing
    default: .gone
    }
  }

  var body: some View {
    if case .unavailable = phase {
      Label("Picture unavailable", systemImage: "photo")
        .font(.footnote)
        .foregroundStyle(Theme.inkSecondary)
    } else {
      frame
        .overlay { picture }
        .clipShape(.rect(cornerRadius: Theme.Radius.badge, style: .continuous))
        // A printed label on the picture, legible on any dish.
        .overlay(alignment: .topLeading) {
          Text("AI picture")
            .font(.caption2.weight(.semibold))
            .textCase(.uppercase)
            .tracking(1)
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Theme.surface.opacity(0.88), in: .capsule)
            .padding(8)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(opensFullScreen && isReady ? .isButton : [])
        .task(id: id) { await load() }
        .fullScreenCover(isPresented: $viewing) {
          if case .ready(let image) = phase { PictureViewer(image: image, title: title) }
        }
    }
  }

  private var isReady: Bool {
    if case .ready = phase { true } else { false }
  }

  private var accessibilityText: String {
    isReady ? "AI picture of \(title)" : "Drawing an AI picture of \(title)"
  }

  @ViewBuilder
  private var frame: some View {
    if let height {
      Theme.fill.frame(maxWidth: .infinity).frame(height: height)
    } else {
      Theme.fill.aspectRatio(4.0 / 3.0, contentMode: .fit).frame(maxWidth: .infinity)
    }
  }

  @ViewBuilder
  private var picture: some View {
    switch phase {
    case .ready(let image):
      Image(uiImage: image)
        .resizable()
        .scaledToFill()
        .contentShape(.rect)
        .onTapGesture { if opensFullScreen { viewing = true } }
    case .drawing:
      VStack(spacing: 8) {
        Image(systemName: "photo.artframe")
          .font(.title2)
          .foregroundStyle(Theme.inkTertiary)
          .symbolEffect(.pulse, options: .repeating, isActive: !reduceMotion)
        Text("Drawing a picture…").folio(.note).foregroundStyle(Theme.inkSecondary)
      }
    case .unavailable:
      EmptyView()
    }
  }

  private func load() async {
    guard case .drawing = phase else { return }
    if let image = Self.cache.object(forKey: id as NSString) {
      phase = .ready(image)
      return
    }
    guard let session = app.session else {
      phase = .unavailable
      return
    }
    let until = ContinuousClock.now + Self.patience
    while !Task.isCancelled {
      let response = try? await RawRequest.send(
        "api/coach/pictures/\(id)", method: "GET", json: nil, token: session.token,
        account: session.accountID, timeout: 15)
      switch Self.outcome(status: response?.status ?? 0) {
      case .ready:
        guard let image = response.flatMap({ UIImage(data: $0.data) }) else {
          phase = .unavailable
          return
        }
        Self.cache.setObject(image, forKey: id as NSString)
        phase = .ready(image)
        return
      case .gone:
        phase = .unavailable
        return
      case .drawing:
        guard ContinuousClock.now < until else {
          phase = .unavailable
          return
        }
        try? await Task.sleep(for: Self.interval)
      }
    }
  }
}

/// A dish's picture on black, dismissed with Done or a swipe down.
private struct PictureViewer: View {
  @Environment(\.dismiss) private var dismiss
  let image: UIImage
  let title: String

  var body: some View {
    NavigationStack {
      Image(uiImage: image)
        .resizable()
        .scaledToFit()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black)
        .accessibilityLabel("AI picture of \(title)")
        .navigationTitle("AI picture")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) { Button("Done", role: .confirm) { dismiss() } }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
    }
  }
}
