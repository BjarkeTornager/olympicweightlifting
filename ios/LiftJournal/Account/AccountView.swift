import LiftAPI
import LiftStore
import SwiftUI

struct AccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var confirmingSignOut = false
  @State private var confirmingDeletion = false
  @State private var deleting = false
  @State private var deletionError: String?
  @AppStorage(AIConsent.key) private var aiAllowed = false
  /// Shown as the Profile tab rather than as a sheet: no Done button.
  var inTab = false

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
          Toggle(isOn: $aiAllowed) {
            Label("Share with Coach's AI provider", systemImage: "sparkles")
          }
        } footer: {
          Text("Coach and voice check-ins send your messages, photos and relevant journal and Apple Health records to a third-party AI provider. Turn this off to stop sharing; Coach stays off until you allow it again.")
        }
        Section {
          Button(role: .destructive) {
            confirmingDeletion = true
          } label: {
            if deleting {
              ProgressView()
            } else {
              Text("Delete account")
            }
          }
          .disabled(deleting)
        } footer: {
          if let deletionError {
            Text(deletionError).foregroundStyle(.red)
          } else {
            Text("Permanently deletes your account and everything in your journal from Lift Journal's server. Data in Apple Health is not affected.")
          }
        }
        Section {
        } footer: {
          Text("Lift Journal \(LiftServer.clientHeader.replacingOccurrences(of: "ios/", with: "").replacingOccurrences(of: "/", with: " (")))")
            .frame(maxWidth: .infinity)
        }
      }
      .navigationTitle(inTab ? "Profile" : "Account")
      .navigationBarTitleDisplayMode(inTab ? .large : .inline)
      .toolbar {
        if !inTab {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", role: .confirm) { dismiss() }
          }
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
      .alert("Delete your account?", isPresented: $confirmingDeletion) {
        Button("Delete account", role: .destructive) {
          Task {
            deleting = true
            deletionError = await model.deleteAccount()
            deleting = false
            if deletionError == nil { dismiss() }
          }
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("This permanently deletes your journal, workouts, meals, photos, videos, Coach conversations and Apple Health imports. It can't be undone. To keep a copy, download a backup from Settings on the website first.")
      }
    }
  }
}
