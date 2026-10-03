import LiftAPI
import LiftTheme
import SwiftUI

/// The ink cover, as a magazine's: the running head, the mark bleeding off
/// the page with Coach's question beside it, the title and the pitch, and
/// the one way in. Always dark, as the icon is: the icon is the cover, the
/// app is the pages.
struct SignInView: View {
  @Environment(AppModel.self) private var model
  @AppStorage(Appearance.key) private var appearance: Appearance = .system
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    GeometryReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          CoverHead(issue: "Nº 1")
          // At the largest text sizes Coach's question moves under the
          // mark, so the two never overlap.
          if typeSize.isAccessibilitySize {
            CoverArt { EmptyView() }
            CoachAsks(wide: true).padding(.bottom, 12)
          } else {
            CoverArt { CoachAsks() }
          }
          CoverTitle()
          pitch.padding(.top, 18)
          Spacer(minLength: 32)
          bottom
        }
        .padding(.horizontal, 24)
        .frame(minHeight: proxy.size.height, alignment: .top)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .background { Color(ColorResource.launchBackground).ignoresSafeArea() }
    .environment(\.colorScheme, .dark)
    // The status bar follows the window, not the environment, so the window
    // turns dark while the cover shows and returns to the chosen appearance
    // after. preferredColorScheme would not return it reliably.
    .onAppear { Appearance.dark.apply() }
    .onDisappear { appearance.apply() }
  }

  private var pitch: some View {
    let more = Text(
      "Tell Coach how you slept, what you ate and how you moved. It keeps the record and tells you what it means."
    )
    .foregroundStyle(Theme.inkSecondary)
    return Text("A private health journal you can talk to. \(more)")
      .folio(.lede)
      .foregroundStyle(Theme.ink)
      .fixedSize(horizontal: false, vertical: true)
  }

  private var bottom: some View {
    VStack(alignment: .leading, spacing: 14) {
      if let error = model.signInError {
        Label(error, systemImage: "exclamationmark.circle")
          .font(.footnote)
          .foregroundStyle(Theme.danger)
      }
      Button {
        Task { await model.signIn() }
      } label: {
        Group {
          if model.signingIn {
            ProgressView().tint(Theme.onAccentFill)
          } else {
            Text("Continue with Google")
          }
        }
      }
      .buttonStyle(PrimaryButtonStyle())
      .disabled(model.signingIn)
      Text("For the owner and invited members. Each person's journal is private to their account. \(policy)")
        .font(.footnote)
        .foregroundStyle(Theme.inkSecondary)
        .tint(Theme.accent)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.bottom, 16)
  }

  private var policy: Text {
    var link = AttributedString("Privacy policy")
    link.link = LiftServer.origin.appending(path: "privacy")
    return Text(link).fontWeight(.semibold)
  }
}

/// The cover's running head over a 2 pt rule.
struct CoverHead: View {
  var issue: String?

  var body: some View {
    VStack(spacing: 0) {
      HStack(alignment: .firstTextBaseline) {
        Text("A private health journal").foregroundStyle(Theme.ink).kicker()
        Spacer(minLength: 8)
        if let issue {
          Text(issue).kicker()
        }
      }
      .padding(.top, 14)
      .padding(.bottom, 9)
      Rectangle().fill(Theme.ink).frame(height: 2)
    }
  }
}

/// The mark at 290 pt, bleeding off the right edge of the page, with room
/// beside it for Coach's question.
struct CoverArt<Beside: View>: View {
  @ViewBuilder var beside: Beside

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      BrandMark()
        .frame(width: 290, height: 290)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        // Past the page's margin and the screen's edge.
        .offset(x: 86, y: 12)
      beside.padding(.bottom, 18)
    }
    // As tall as the mark needs, or Coach's question at large text sizes.
    .frame(maxWidth: .infinity, minHeight: 306)
    .fixedSize(horizontal: false, vertical: true)
  }
}

/// The wordmark as the cover's title, "Lift / Journal" on two lines, in the
/// largest serif: regular, roman and in its own spacing, as the name is set
/// everywhere.
struct CoverTitle: View {
  var body: some View {
    VStack(alignment: .leading, spacing: -16) {
      Text("Lift")
      Text("Journal")
    }
    .folio(.coverWordmark)
    .foregroundStyle(Theme.ink)
    .padding(.top, 8)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Lift Journal")
    .accessibilityAddTraits(.isHeader)
  }
}

/// Coach's question, cycling every 4 s through the five areas, with their
/// keys as a pager. It holds on the first under Reduce Motion.
private struct CoachAsks: View {
  /// Across the page, rather than in the space beside the mark.
  var wide = false

  static let questions: [(text: String, tint: Color)] = [
    ("How did you sleep?", Theme.sleep),
    ("What did you eat?", Theme.calories),
    ("How did you move today?", Theme.activity),
    ("What did the scale say?", Theme.body),
    ("How do you feel?", Theme.feltEnergy),
  ]

  @State private var asked = 0
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @ScaledMetric(relativeTo: .title2) private var width: CGFloat = 156

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Coach asks").foregroundStyle(Theme.accent).label()
      Text("\u{201C}\(Self.questions[asked].text)\u{201D}")
        .font(.system(.title2, design: .serif))
        .italic()
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .id(asked)
        .transition(.opacity)
        .padding(.top, 6)
      HStack(spacing: 6) {
        ForEach(Self.questions.indices, id: \.self) { index in
          RoundedRectangle(cornerRadius: Theme.Radius.key)
            .fill(Self.questions[index].tint)
            .frame(width: 8, height: 8)
            .opacity(index == asked ? 1 : 0.4)
        }
      }
      .padding(.top, 12)
      .accessibilityHidden(true)
    }
    .frame(maxWidth: wide ? .infinity : min(width, 210), alignment: .leading)
    .accessibilityElement(children: .combine)
    .task(id: reduceMotion) {
      guard !reduceMotion else {
        asked = 0
        return
      }
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(4))
        guard !Task.isCancelled else { return }
        withAnimation(.easeInOut(duration: 0.5)) { asked = (asked + 1) % Self.questions.count }
      }
    }
  }
}

#Preview("Sign in") {
  SignInView().environment(AppModel())
}

#Preview("Sign in, AX3") {
  SignInView().environment(AppModel()).dynamicTypeSize(.accessibility3)
}

#Preview("Privacy cover") {
  PrivacyCover()
}
