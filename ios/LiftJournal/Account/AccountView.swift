import LiftAPI
import LiftStore
import SwiftUI

struct AccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var confirmingSignOut = false

  var body: some View {
    NavigationStack {
      List {
        if let session = model.session {
          Section {
            HStack(spacing: 14) {
              Avatar(name: session.name, size: 56)
              VStack(alignment: .leading, spacing: 2) {
                Text(session.name).font(.title3.weight(.semibold))
                Text(session.email).font(.subheadline).foregroundStyle(.secondary)
              }
            }
            .padding(.vertical, 4)
          }
        }
        Section {
          NavigationLink {
            HealthView()
          } label: {
            LabeledContent {
              Text(model.health.connected ? "On" : "Off")
            } label: {
              Label {
                Text("Apple Health")
              } icon: {
                IconBadge(symbol: "heart.fill", tint: .pink, size: 28)
              }
            }
          }
          Link(destination: LiftServer.origin) {
            Label {
              Text("Open the Website")
            } icon: {
              IconBadge(symbol: "safari.fill", tint: .blue, size: 28)
            }
          }
          Link(destination: LiftServer.origin.appending(path: "privacy")) {
            Label {
              Text("Privacy Policy")
            } icon: {
              IconBadge(symbol: "hand.raised.fill", tint: .gray, size: 28)
            }
          }
        } footer: {
          Text("Routines, programmes, videos and backups are managed on the website for now.")
        }
        Section {
          Button("Sign out", role: .destructive) { confirmingSignOut = true }
        } footer: {
          Text("Signs out this iPhone only. Your journal stays on the server.")
        }
        Section {
        } footer: {
          Text("Lift Journal \(LiftServer.clientHeader.replacingOccurrences(of: "ios/", with: "").replacingOccurrences(of: "/", with: " (")))")
            .frame(maxWidth: .infinity)
        }
      }
      .navigationTitle("Account")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", role: .confirm) { dismiss() }
        }
      }
      .confirmationDialog("Sign out of Lift Journal on this iPhone?", isPresented: $confirmingSignOut) {
        Button("Sign out", role: .destructive) {
          Task {
            await model.signOut()
            dismiss()
          }
        }
      } message: {
        if model.queued > 0 {
          Text("\(model.queued) unsent changes on this iPhone will be lost.")
        }
      }
    }
  }
}
