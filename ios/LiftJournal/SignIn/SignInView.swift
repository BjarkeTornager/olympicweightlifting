import LiftAPI
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
      Text("Training, food, sleep and recovery in one private journal, with a Coach that knows it.")
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
            ProgressView()
          } else {
            Text("Continue with Google").fontWeight(.semibold)
          }
        }
        .frame(maxWidth: .infinity, minHeight: 32)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
      .disabled(model.signingIn)
      Text("For the owner and invited members. Each person's journal is private to their account.")
        .font(.footnote)
        .foregroundStyle(.secondary)
      Link("Privacy policy", destination: LiftServer.origin.appending(path: "privacy"))
        .font(.footnote)
    }
    .padding(28)
  }
}

#Preview {
  SignInView().environment(AppModel())
}
