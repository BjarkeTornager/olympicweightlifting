import LiftStore
import LiftTheme
import SwiftUI

@main
struct LiftJournalApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var model = AppModel()
  @Environment(\.scenePhase) private var phase
  @AppStorage(Appearance.key) private var appearance: Appearance = .system

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(model)
        .task { await model.start() }
        .onChange(of: phase) { _, phase in
          if phase == .active { Task { await model.becameActive() } }
        }
        // Health data stays out of the app switcher's snapshot.
        .overlay { if phase != .active { PrivacyCover() } }
        .onChange(of: appearance, initial: true) { _, appearance in appearance.apply() }
    }
  }
}

/// Apple Health wakes the app in the background when new sleep, workouts or
/// resting heart rate arrive, and a reminder's button may launch it. Both
/// must be set up on every launch, before launching finishes.
final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    MainActor.assumeIsolated {
      Reminders.shared.register()
      // The serif navigation titles. Not in the App's init: set that early,
      // they kept SwiftUI from tinting with the AccentColor asset.
      FolioChrome.apply()
    }
    Task { await AppModel.observeHealth() }
    return true
  }
}

/// The ink cover without the way in: the running head, the mark and the
/// title, set exactly as on the sign-in page. It shows while the app starts
/// and in the app switcher, so health data stays out of the snapshot. Always
/// dark, as the icon is.
struct PrivacyCover: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      CoverHead()
      CoverArt { EmptyView() }
      CoverTitle()
    }
    .padding(.horizontal, 24)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .clipped()
    .background { Color(ColorResource.launchBackground).ignoresSafeArea() }
    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    .environment(\.colorScheme, .dark)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Lift Journal")
  }
}
