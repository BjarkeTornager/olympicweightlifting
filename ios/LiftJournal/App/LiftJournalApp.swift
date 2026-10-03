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

struct PrivacyCover: View {
  var body: some View {
    ZStack {
      Theme.background.ignoresSafeArea()
      Image(systemName: "heart.text.clipboard")
        .font(.system(size: 44))
        .foregroundStyle(.tint)
        .accessibilityLabel("Lift Journal")
    }
  }
}
