import SwiftUI

@main struct LiftJournalApp: App {
  @State private var store = JournalStore()
  @State private var privacy = PrivacyShield()
  @Environment(\.scenePhase) private var phase
  var body: some Scene {
    WindowGroup {
      RootView().environment(store).tint(Color.liftTeal)
        .task { await store.verify() }
        .onChange(of: phase) { _, value in
          if value == .active { Task { await store.verify() } } else { store.suspend() }
          privacy.update(store: store, phase: value)
        }
        .onChange(of: store.verified) { _, _ in privacy.update(store: store, phase: phase) }
        .onChange(of: store.user) { _, _ in privacy.update(store: store, phase: phase) }
        .overlay { if phase != .active { PrivacyCover() } }
    }
  }
}
extension Color {
  static let liftTeal = Color(red: 0.16, green: 0.40, blue: 0.43)
  static let liftMint = Color(red: 0.90, green: 0.95, blue: 0.92)
}
struct PrivacyCover: View {
  var body: some View {
    ZStack {
      Color(.systemBackground).ignoresSafeArea()
      VStack(spacing: 16) {
        Image(systemName: "heart.text.clipboard").font(.system(size: 42)).foregroundStyle(
          Color.liftTeal)
        Text("Lift Journal").font(.title2.bold())
        Text("Your private health journal").foregroundStyle(.secondary)
      }
    }
  }
}
struct RootView: View {
  @Environment(JournalStore.self) private var store
  var body: some View {
    @Bindable var store = store
    Group {
      if !store.user.isNull {
        TabView(selection: $store.selectedTab) {
          Tab("Coach", systemImage: "sparkles", value: 0) { NavigationStack { CoachView() } }
          Tab("Today", systemImage: "sun.max", value: 1) { NavigationStack { TodayView() } }
          Tab("Train", systemImage: "figure.strengthtraining.traditional", value: 2) {
            NavigationStack { TrainingView() }
          }
          Tab("Journal", systemImage: "book.closed", value: 3) { NavigationStack { JournalView() } }
          Tab("You", systemImage: "person.crop.circle", value: 4) {
            NavigationStack { SettingsView() }
          }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
          if store.pending != nil {
            Button {
              store.recoveryPresented = true
            } label: {
              Text("Unsent change · Review recovery").font(.footnote)
            }.padding(8).frame(maxWidth: .infinity).background(.orange.opacity(0.15))
          }
        }
        .accessibilityHidden(!store.verified)
        .overlay { if !store.verified { PrivacyCover() } }
        .sheet(isPresented: $store.recoveryPresented) {
          NavigationStack {
            RecoveryView().toolbar {
              ToolbarItem(placement: .confirmationAction) {
                Button("Done") { store.recoveryPresented = false }
              }
            }
          }
        }
      } else {
        SignInView()
      }
    }
    .alert(
      "Lift Journal",
      isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })
    ) {
      Button("OK", role: .cancel) { store.error = nil }
    } message: {
      Text(store.error ?? "")
    }
  }
}
struct SignInView: View {
  @Environment(JournalStore.self) private var store
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      Spacer()
      Image(systemName: "heart.text.clipboard.fill").font(.system(size: 52)).foregroundStyle(
        Color.liftTeal)
      Text("Your health.\nAll together.").font(
        .system(.largeTitle, design: .rounded, weight: .bold))
      Text("Training, food and recovery — with a Coach that knows your journal.").font(.title3)
        .foregroundStyle(.secondary)
      HStack(spacing: 24) {
        Label("Move", systemImage: "figure.run")
        Label("Nourish", systemImage: "leaf")
        Label("Recover", systemImage: "moon")
      }.font(.footnote).foregroundStyle(Color.liftTeal)
      Spacer()
      if store.hasCredential && !store.signingIn {
        ProgressView("Opening your private journal…").frame(maxWidth: .infinity)
        Button("Try again") { Task { await store.verify() } }.frame(maxWidth: .infinity)
      } else {
        Button {
          Task { await store.signIn() }
        } label: {
          HStack {
            Image(systemName: "person.crop.circle.badge.checkmark")
            Text(store.signingIn ? "Connecting…" : "Continue with Google").fontWeight(.semibold)
          }.frame(maxWidth: .infinity).padding(.vertical, 9)
        }.buttonStyle(.borderedProminent).disabled(store.signingIn)
      }
      Text(
        "A private space for you and invited members. Each person’s health data stays in their own account."
      ).font(.footnote).foregroundStyle(.secondary)
      Link("Privacy", destination: APIClient.origin.appendingPathComponent("privacy")).font(
        .footnote)
    }.padding(28).background(Color(.systemGroupedBackground))
  }
}
struct HealthCard<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 16) { content }.padding(20).frame(
      maxWidth: .infinity, alignment: .leading
    ).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24))
  }
}
struct Metric: View {
  let title: String, value: String, symbol: String
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Image(systemName: symbol).foregroundStyle(Color.liftTeal)
      Text(value).font(.title2.bold()).lineLimit(1).minimumScaleFactor(0.65)
      Text(title).font(.caption).foregroundStyle(.secondary)
    }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .combine)
  }
}
struct EmptyJournal: View {
  let title: String, detail: String, symbol: String
  var body: some View {
    ContentUnavailableView(title, systemImage: symbol, description: Text(detail))
  }
}
