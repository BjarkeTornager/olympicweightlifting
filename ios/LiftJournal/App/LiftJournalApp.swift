import LiftStore
import SwiftUI

@main
struct LiftJournalApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @State private var model = AppModel()
  @Environment(\.scenePhase) private var phase

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
    }
  }
}

/// Apple Health wakes the app in the background when new sleep, workouts or
/// resting heart rate arrive. Its observers must be registered on every
/// launch, before launching finishes.
final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    Task { await AppModel.observeHealth() }
    return true
  }
}

struct PrivacyCover: View {
  var body: some View {
    ZStack {
      Color(.systemBackground).ignoresSafeArea()
      Image(systemName: "heart.text.clipboard")
        .font(.system(size: 44))
        .foregroundStyle(.tint)
        .accessibilityLabel("Lift Journal")
    }
  }
}
