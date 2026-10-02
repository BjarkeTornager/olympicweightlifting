import LiftAPI
import LiftTheme
import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Spacer()
      Image(systemName: "heart.text.clipboard.fill")
        .font(.system(size: 52))
        .foregroundStyle(.tint)
        .accessibilityHidden(true)
      Text("Lift Journal")
        .font(.largeTitle.bold())
      Text("A private health journal you can talk to. Tell Coach how you slept, what you ate and how you moved, and it keeps the record and tells you what it means.")
        .font(.title3)
        .foregroundStyle(.secondary)
      Spacer()
      if let error = model.signInError {
        Label(error, systemImage: "exclamationmark.circle")
          .font(.footnote)
          .foregroundStyle(.red)
      }
      Button {
        Task { await model.signIn() }
      } label: {
        Group {
          if model.signingIn {
            ProgressView().tint(Theme.onAccent)
          } else {
            Text("Continue with Google").fontWeight(.semibold)
          }
        }
        .frame(maxWidth: .infinity, minHeight: 32)
      }
      .buttonStyle(.glassProminent)
      .foregroundStyle(Theme.onAccent)
      .controlSize(.large)
      .disabled(model.signingIn)
      Text("For the owner and invited members. Each person's journal is private to their account.")
        .font(.footnote)
        .foregroundStyle(.secondary)
      Link("Privacy policy", destination: LiftServer.origin.appending(path: "privacy"))
        .font(.footnote)
    }
    .padding(28)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .background(Theme.background)
  }
}

#Preview {
  SignInView().environment(AppModel())
}
