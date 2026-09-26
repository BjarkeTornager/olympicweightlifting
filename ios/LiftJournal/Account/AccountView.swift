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
            LabeledContent("Name", value: session.name)
            LabeledContent("Email", value: session.email)
          }
        }
        Section {
          NavigationLink {
            HealthView()
          } label: {
            LabeledContent {
              Text(model.health.connected ? "Connected" : "Off")
            } label: {
              Label("Apple Health", systemImage: "heart.fill")
            }
          }
          Link(destination: LiftServer.origin) {
            Label("Open the website", systemImage: "safari")
          }
          Link(destination: LiftServer.origin.appending(path: "privacy")) {
            Label("Privacy policy", systemImage: "hand.raised")
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
