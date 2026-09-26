import LiftAPI
import SwiftUI

/// Permission to send journal data to third-party AI (App Review guideline
/// 5.1.2(i)). Coach sends messages, photos and relevant journal and Apple
/// Health records to the model provider; voice check-ins stream audio to
/// Google. Nothing AI-backed runs until this is granted. It is kept per
/// install and cleared on sign-out, so each person decides for themselves.
enum AIConsent {
  static let key = "aiConsent.v1"
  static func reset() { UserDefaults.standard.removeObject(forKey: key) }
}

/// Shows the permission screen in place of a feature that needs third-party AI.
struct AIConsentGate<Content: View>: View {
  @AppStorage(AIConsent.key) private var allowed = false
  @ViewBuilder var content: Content

  var body: some View {
    if allowed { content } else { AIConsentView() }
  }
}

/// Explains what is shared and with whom, then asks. Works inline (the Coach
/// tab) or presented as a sheet, where Not Now dismisses it.
struct AIConsentView: View {
  @AppStorage(AIConsent.key) private var allowed = false
  @Environment(\.dismiss) private var dismiss
  @Environment(\.isPresented) private var isPresented

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Image(systemName: "sparkles")
          .font(.system(size: 44))
          .foregroundStyle(.tint)
          .accessibilityHidden(true)
        Text("Coach uses third-party AI")
          .font(.title.bold())
        Text("To answer, Coach shares information from your journal with an AI provider outside Lift Journal. Nothing is sent until you allow it.")
          .foregroundStyle(.secondary)
        VStack(alignment: .leading, spacing: 14) {
          point(
            "text.bubble", "What is sent",
            "Your messages, photos you attach, and the journal records relevant to your question, including training, meals, check-ins and data imported from Apple Health."
          )
          point(
            "server.rack", "Who receives it",
            "Coach requests go through OpenRouter to the model provider shown in Coach, limited to providers that don't retain your data. TypeSafe may see your latest message to pick the model. Voice check-ins stream your voice to Google's Gemini API."
          )
          point(
            "hand.raised", "Your choice",
            "Logging, your journal and Apple Health work without it. You can withdraw permission any time in Account."
          )
        }
        Link("Privacy policy", destination: LiftServer.origin.appending(path: "privacy"))
          .font(.footnote)
        Button {
          allowed = true
          if isPresented { dismiss() }
        } label: {
          Text("Allow and continue")
            .fontWeight(.semibold)
            .frame(maxWidth: .infinity, minHeight: 32)
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
        if isPresented {
          Button("Not now") { dismiss() }
            .frame(maxWidth: .infinity)
        }
      }
      .padding(24)
    }
  }

  private func point(_ symbol: String, _ title: String, _ detail: String) -> some View {
    HStack(alignment: .top, spacing: 14) {
      Image(systemName: symbol)
        .font(.title3)
        .foregroundStyle(.tint)
        .frame(width: 28)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.headline)
        Text(detail).font(.subheadline).foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

#Preview {
  AIConsentView()
}
