import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
  @Environment(JournalStore.self) private var store
  @State private var signout = false
  var body: some View {
    List {
      Section {
        Label {
          VStack(alignment: .leading, spacing: 6) {
            Text(store.user["name"].string).font(.headline)
            Text(store.user["email"].string).font(.caption).foregroundStyle(.secondary)
          }
        } icon: {
          Image(systemName: "person.crop.circle.fill").font(.largeTitle).foregroundStyle(
            Color.liftTeal)
        }
      }
      Section("Your journal") {
        NavigationLink {
          ImageLibraryView()
        } label: {
          Label("Image library", systemImage: "photo.on.rectangle")
        }
        NavigationLink {
          RecoveryView()
        } label: {
          Label("Backup & recovery", systemImage: "arrow.triangle.2.circlepath")
        }
        if store.canInvite {
          NavigationLink {
            InvitationsView()
          } label: {
            Label("Invitations", systemImage: "person.badge.plus")
          }
        }
        Button("Refresh journal", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
        if let synced = store.lastSynced {
          LabeledContent("Last synced", value: synced.formatted(date: .omitted, time: .shortened))
        }
      }
      Section("Privacy") {
        Text(
          "Your records belong to your account. Messages, relevant journal entries and attached images are sent to your configured assistant provider when you ask Coach. Uploads are also sent for analysis when photo sorting is enabled in the attachment menu."
        ).font(.footnote).foregroundStyle(.secondary)
        Link("Privacy policy", destination: APIClient.origin.appendingPathComponent("privacy"))
        Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
          signout = true
        }
      }
      Section {
        Text("Lift Journal for iPhone · 1.0\nNative training, nutrition and recovery.").font(
          .footnote
        ).foregroundStyle(.secondary)
      }
    }.navigationTitle("You")
      .confirmationDialog(
        "Sign out of this iPhone?", isPresented: $signout, titleVisibility: .visible
      ) {
        Button("Sign out", role: .destructive) { Task { await store.signOut() } }
      } message: {
        Text("Your cloud journal remains in your account. Resolve any unsent save first.")
      }
  }
}
struct JournalExport: FileDocument {
  static var readableContentTypes: [UTType] { [.json] }
  var data: Data
  init(data: Data) { self.data = data }
  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }
  func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}
struct RecoveryView: View {
  @Environment(JournalStore.self) private var store
  @State private var exporting = false
  @State private var export: JournalExport?
  @State private var discard = false
  var body: some View {
    List {
      Section("Backup") {
        Text(
          "Export your journal as JSON. The image catalog stays on the server; image pixels are not included in this file."
        ).font(.subheadline)
        Button("Export journal", systemImage: "square.and.arrow.up") {
          export = try? JournalExport(data: store.state.data)
          exporting = true
        }
      }
      if let pending = store.pending {
        Section("Unsent change") {
          Text(
            "This iPhone kept a save that has not been acknowledged. Retry the same save to avoid duplicates. If another device changed the journal, export your unsent copy before choosing the server copy."
          ).font(.subheadline)
          Button("Retry save", systemImage: "arrow.clockwise") {
            Task { do { try await store.retryPending() } catch { store.handle(error) } }
          }
          Button("Export unsent copy", systemImage: "square.and.arrow.up") {
            export = try? JournalExport(data: pending["state"].data)
            exporting = true
          }
          Button("Use server copy", role: .destructive) { discard = true }
        }
      } else {
        Label("All confirmed changes are on your account", systemImage: "checkmark.icloud")
          .foregroundStyle(Color.liftTeal)
      }
      Section {
        Text(
          "The app stores your sign-in in Keychain. Unsent saves use iOS file protection and are excluded from device backups. Private screens hide when the app is inactive and require server verification when you return."
        ).font(.footnote).foregroundStyle(.secondary)
      }
    }.navigationTitle("Backup & recovery")
      .fileExporter(
        isPresented: $exporting, document: export, contentType: .json,
        defaultFilename: "lift-journal-\(dayString())"
      ) { result in if case .failure(let error) = result { store.handle(error) } }
      .confirmationDialog(
        "Discard the unsent change?", isPresented: $discard, titleVisibility: .visible
      ) {
        Button("Discard unsent change", role: .destructive) {
          Task { await store.discardPending() }
        }
      } message: {
        Text("The server copy will remain. Export the unsent copy first if you want to retain it.")
      }
  }
}
struct ImageLibraryView: View {
  @Environment(JournalStore.self) private var store
  @State private var category = "all"
  var body: some View {
    List {
      Picker("Image category", selection: $category) {
        Text("All images").tag("all")
        ForEach(["food", "sleep", "activity", "health", "other", "unclassified"], id: \.self) {
          Text($0 == "unclassified" ? "Needs review" : $0.capitalized).tag($0)
        }
      }
      ForEach(store.images.filter { category == "all" || $0["category"].string == category }) {
        image in
        NavigationLink {
          ImageDetailView(image: image)
        } label: {
          HStack(spacing: 14) {
            Image(systemName: symbol(image["category"].string)).font(.title2).foregroundStyle(
              Color.liftTeal
            ).frame(width: 38)
            VStack(alignment: .leading, spacing: 5) {
              Text(image["label"].string).font(.headline)
              Text("\(image["category"].string.capitalized) · \(image["date"].string)").font(
                .caption
              ).foregroundStyle(.secondary)
            }
          }
        }
      }
      if store.images.isEmpty {
        EmptyJournal(
          title: "Your private image library",
          detail:
            "Add photos or screenshots in Coach. Photo sorting can categorize food, sleep and activities automatically.",
          symbol: "photo.on.rectangle")
      }
    }.navigationTitle("Images").refreshable { await store.refresh() }
  }
  func symbol(_ category: String) -> String {
    switch category {
    case "food": "fork.knife"
    case "sleep": "moon"
    case "activity": "figure.run"
    default: "photo"
    }
  }
}
struct ImageDetailView: View {
  @Environment(JournalStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let image: JSONValue
  @State private var pixels: UIImage?
  @State private var category = "unclassified"
  @State private var deleting = false
  var current: JSONValue { store.images.first { $0.id == image.id } ?? image }
  var body: some View {
    List {
      if let pixels {
        Image(uiImage: pixels).resizable().scaledToFit().accessibilityLabel(current["label"].string)
      } else {
        ProgressView("Loading private image…")
      }
      Section("Catalog") {
        LabeledContent("Date", value: current["date"].string)
        Picker("Category", selection: $category) {
          ForEach(["food", "sleep", "activity", "health", "other", "unclassified"], id: \.self) {
            Text($0 == "unclassified" ? "Needs review" : $0.capitalized).tag($0)
          }
        }
        Text(current["classification"]["tags"].array.map(\.string).joined(separator: " · ")).font(
          .caption
        ).foregroundStyle(.secondary)
        Button("Save category") {
          Task {
            do {
              _ = try await store.request(
                "/api/images/\(image.id)", method: "PATCH",
                body: json([
                  "category": s(category), "tags": current["classification"]["tags"],
                  "version": current["version"],
                ]))
              await store.refresh()
            } catch { store.handle(error) }
          }
        }
      }
      Button("Log with Coach", systemImage: "sparkles") {
        if store.attachments.count < 4 && !store.attachments.contains(where: { $0.id == image.id })
        {
          store.attachments.append(current)
        }
        store.ask(
          "Help me log the \(current["category"].string) shown in this image. Use visible dates and measurements, ask about anything unclear, and prepare it for review."
        )
      }
      Button("Delete image", systemImage: "trash", role: .destructive) { deleting = true }
    }.navigationTitle("Image details").navigationBarTitleDisplayMode(.inline)
      .task {
        category = current["category"].string
        do { pixels = UIImage(data: try await store.image(image.id)) } catch { store.handle(error) }
      }
      .confirmationDialog("Delete this image?", isPresented: $deleting, titleVisibility: .visible) {
        Button("Delete image", role: .destructive) {
          Task {
            do {
              _ = try await store.request("/api/images/\(image.id)", method: "DELETE")
              await store.refresh()
              dismiss()
            } catch { store.handle(error) }
          }
        }
      }
  }
}
struct InvitationsView: View {
  @Environment(JournalStore.self) private var store
  @State private var invitations: [JSONValue] = []
  @State private var email = ""
  @State private var removing: JSONValue?
  var body: some View {
    List {
      Section("Invite a Google account") {
        TextField("Email address", text: $email).keyboardType(.emailAddress)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
        Button("Grant access") {
          Task {
            do {
              _ = try await store.request(
                "/api/invitations", method: "POST", body: json(["email": s(email)]))
              email = ""
              await load()
            } catch { store.handle(error) }
          }
        }
        Text(
          "An invitation grants access to a separate private journal. Share the app invitation yourself; this does not send email."
        ).font(.caption).foregroundStyle(.secondary)
      }
      ForEach(invitations) { invitation in
        VStack(alignment: .leading, spacing: 10) {
          Text(invitation["email"].string).font(.headline)
          if invitation["revokedAt"].isNull {
            Button("Revoke access", role: .destructive) { removing = invitation }
          } else {
            Text("Access revoked").font(.caption).foregroundStyle(.secondary)
            Button("Restore access") {
              Task {
                do {
                  _ = try await store.request(
                    "/api/invitations", method: "POST", body: json(["email": invitation["email"]]))
                  await load()
                } catch { store.handle(error) }
              }
            }
          }
        }
      }
    }.navigationTitle("Invitations").task { await load() }
      .confirmationDialog(
        "Revoke this account’s access?",
        isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
        titleVisibility: .visible
      ) {
        if let removing {
          Button("Revoke access", role: .destructive) {
            Task {
              do {
                _ = try await store.request(
                  "/api/invitations", method: "DELETE", body: json(["id": s(removing.id)]))
                self.removing = nil
                await load()
              } catch { store.handle(error) }
            }
          }
        }
      }
  }
  func load() async {
    do { invitations = try await store.request("/api/invitations")["invitations"].array } catch {
      store.handle(error)
    }
  }
}
