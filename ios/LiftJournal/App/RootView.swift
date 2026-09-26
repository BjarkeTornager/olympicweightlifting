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
            NavigationStack { CoachView() }
          }
          Tab("Journal", systemImage: "book.closed", value: AppModel.Tab.journal) {
            NavigationStack { JournalView() }
          }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .overlay(alignment: .bottom) { NoticeBar() }
      }
    }
    .fullScreenCover(isPresented: $model.updateRequired) { UpdateRequiredView() }
  }
}

/// A short confirmation above the tab bar, with Undo where the change can be undone.
struct NoticeBar: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if let notice = model.notice {
      HStack(spacing: 12) {
        Image(systemName: notice.problem ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
          .foregroundStyle(notice.problem ? .orange : .green)
        Text(notice.text).font(.subheadline).lineLimit(3)
        Spacer(minLength: 0)
        if let undo = notice.undo {
          Button("Undo") {
            model.notice = nil
            Task { await model.save(undo, confirmation: "Undone") }
          }
          .font(.subheadline.weight(.semibold))
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
      .glassEffect(.regular, in: .capsule)
      .padding(.horizontal, 16)
      .padding(.bottom, 64)
      .transition(.move(edge: .bottom).combined(with: .opacity))
      .task(id: notice.id) {
        try? await Task.sleep(for: .seconds(notice.problem ? 6 : 3))
        if model.notice?.id == notice.id { withAnimation { model.notice = nil } }
      }
      .accessibilityElement(children: .combine)
    }
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
