import SwiftUI
import UIKit

// A separate window also covers sheets and the system app-switcher snapshot.
@MainActor final class PrivacyShield {
  private var window: UIWindow?
  private weak var previousKeyWindow: UIWindow?
  func update(store: JournalStore, phase: ScenePhase) {
    let hidden = phase != .active || (!store.user.isNull && !store.verified)
    guard hidden else {
      window?.isHidden = true
      window = nil
      previousKeyWindow?.makeKey()
      previousKeyWindow = nil
      return
    }
    guard
      let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first
    else { return }
    if window == nil {
      previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
      let shield = UIWindow(windowScene: scene)
      shield.windowLevel = .alert + 1
      shield.backgroundColor = .systemBackground
      window = shield
    }
    window?.rootViewController = UIHostingController(
      rootView: PrivacyScreen(active: phase == .active).environment(store).tint(Color.liftTeal))
    window?.rootViewController?.view.accessibilityViewIsModal = true
    window?.isHidden = false
  }
}
private struct PrivacyScreen: View {
  @Environment(JournalStore.self) private var store
  let active: Bool
  var body: some View {
    PrivacyCover().overlay(alignment: .bottom) {
      if active {
        VStack(spacing: 16) {
          if store.checking {
            ProgressView("Verifying your account…")
          } else {
            Text("Connect to verify access to your journal.").font(.footnote).foregroundStyle(
              .secondary)
            Button("Reconnect to your journal") { Task { await store.verify() } }.buttonStyle(
              .borderedProminent)
          }
        }.padding(.bottom, 80)
      }
    }
  }
}
