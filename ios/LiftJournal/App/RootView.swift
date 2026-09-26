import SwiftUI

struct RootView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    Group {
      switch model.phase {
      case .launching:
        PrivacyCover()
      case .signedOut:
        SignInView()
      case .signedIn:
        TabView(selection: $model.tab) {
          Tab("Today", systemImage: "sun.max", value: AppModel.Tab.today) {
            NavigationStack { TodayView() }
          }
          Tab("Coach", systemImage: "bubble.left.and.text.bubble.right", value: AppModel.Tab.coach) {
            NavigationStack { AIConsentGate { CoachView() } }
          }
          Tab("Journal", systemImage: "book.closed", value: AppModel.Tab.journal) {
            NavigationStack { JournalView() }
          }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .sheet(isPresented: $model.consentForVoice, onDismiss: {
          if UserDefaults.standard.bool(forKey: AIConsent.key) { model.startVoice() }
        }) {
          AIConsentView()
        }
        .fullScreenCover(
          isPresented: Binding(
            get: { model.voiceCall != nil }, set: { if !$0 { model.closeVoice() } })
        ) {
          if let call = model.voiceCall { VoiceCallView(call: call) }
        }
        .alert(
          "Not Saved",
          isPresented: Binding(
            get: { model.notice?.problem == true }, set: { if !$0 { model.notice = nil } }),
          presenting: model.notice
        ) { _ in
          Button("OK", role: .cancel) {}
        } message: { notice in
          Text(notice.text)
        }
      }
    }
    .fullScreenCover(isPresented: $model.updateRequired) { UpdateRequiredView() }
  }
}

struct UpdateRequiredView: View {
  var body: some View {
    ContentUnavailableView {
      Label("Update Lift Journal", systemImage: "arrow.down.app")
    } description: {
      Text("This version is no longer supported. Install the latest build from TestFlight. Your journal is safe.")
    } actions: {
      Link("Open TestFlight", destination: URL(string: "itms-beta://")!)
        .buttonStyle(.borderedProminent)
    }
    .interactiveDismissDisabled()
  }
}
