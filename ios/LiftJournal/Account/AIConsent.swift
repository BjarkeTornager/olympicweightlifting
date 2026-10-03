import LiftAPI
import LiftTheme
import SwiftUI

/// Permission to send journal data to third-party AI (App Review guideline
/// 5.1.2(i)). Coach sends messages, photos and relevant journal and Apple
/// Health records to the model provider; voice check-ins stream audio to
/// Google. Nothing AI-backed runs until this is granted. It is kept per
/// install and cleared on sign-out, so each person decides for themselves.
enum AIConsent {
  static let key = "aiConsent.v1"
  static func reset() { UserDefaults.standard.removeObject(forKey: key) }
  /// Whether the athlete has allowed it (and not withdrawn it in Profile).
  static var granted: Bool { UserDefaults.standard.bool(forKey: key) }
}

/// Shows the permission screen in place of a feature that needs third-party AI.
struct AIConsentGate<Content: View>: View {
  @AppStorage(AIConsent.key) private var allowed = false
  @ViewBuilder var content: Content

  var body: some View {
    if allowed { content } else { AIConsentView() }
  }
}

/// Explains what is shared and with whom, then asks. Set as a letter from
/// Coach, as its replies are: the byline, then the title, the standfirst
/// and three numbered paragraphs behind the margin rule. Works inline (the
/// Coach tab) or presented as a sheet, where Not Now dismisses it.
struct AIConsentView: View {
  @AppStorage(AIConsent.key) private var allowed = false
  @Environment(\.dismiss) private var dismiss
  @Environment(\.isPresented) private var isPresented

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        CoachLetter {
          Text("Coach uses third-party AI")
            .folio(.sectionTitle)
            .foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
          Text("To answer, Coach shares information from your journal with an AI provider outside Lift Journal. Nothing is sent until you allow it.")
            .folio(.standfirst)
            .foregroundStyle(Theme.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
          point(
            1, "What is sent",
            "Your messages, photos you attach, and the journal records relevant to your question, including training, meals, check-ins and data imported from Apple Health."
          )
          .padding(.top, 6)
          point(
            2, "Who receives it",
            "Coach requests go through OpenRouter to the model provider shown in Coach, limited to providers that don't retain your data. TypeSafe may see your latest message to pick the model. Voice check-ins stream your voice to Google's Gemini API, or to ElevenLabs if you choose it in Profile."
          )
          point(
            3, "Your choice",
            "Logging, your journal and Apple Health work without it. You can withdraw permission any time in Profile."
          )
        }
        Link(destination: LiftServer.origin.appending(path: "privacy")) {
          Label("Privacy policy", systemImage: "arrow.up.right")
            .labelStyle(TrailingIcon())
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Theme.accent)
            .frame(minHeight: 44)
        }
        .padding(.top, 12)
        VStack(spacing: 10) {
          Button("Allow and continue") {
            allowed = true
            if isPresented { dismiss() }
          }
          .buttonStyle(PrimaryButtonStyle())
          if isPresented {
            Button("Not now") { dismiss() }
              .buttonStyle(SecondaryButtonStyle())
          }
        }
        .padding(.top, 20)
      }
      .padding(.horizontal, Theme.Space.l)
      .padding(.vertical, Theme.Space.l)
    }
    .background(Theme.background)
  }

  /// A numbered paragraph: the number in the margin, its subject, then the
  /// paragraph in the serif.
  private func point(_ number: Int, _ title: String, _ detail: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Text("\(number)")
        .folio(.coach)
        .monospacedDigit()
        .foregroundStyle(Theme.inkSecondary)
        .frame(minWidth: 12, alignment: .leading)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
        Paragraph(detail, language: .english)
          .folio(.coach)
          .foregroundStyle(Theme.ink)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

/// A link's arrow after its words.
private struct TrailingIcon: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.title
      configuration.icon.imageScale(.small)
    }
  }
}

#Preview("AI consent") { AIConsentView() }
#Preview("AI consent, dark") { AIConsentView().preferredColorScheme(.dark) }
#Preview("AI consent, AX3") { AIConsentView().dynamicTypeSize(.accessibility3) }
