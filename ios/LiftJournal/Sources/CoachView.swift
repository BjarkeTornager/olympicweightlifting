import Charts
import PhotosUI
import SwiftUI

struct CoachView: View {
  @Environment(JournalStore.self) private var store
  @State private var photo: PhotosPickerItem?
  @State private var camera = false
  @State private var follow = true
  @State private var scrolling = false
  @State private var nearBottom = true
  @FocusState private var focused: Bool
  var body: some View {
    @Bindable var store = store
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 28) {
          if store.turns.isEmpty && !store.streaming { welcome }
          ForEach(store.turns) { turn in
            VStack(alignment: .leading, spacing: 20) {
              HStack {
                Spacer(minLength: 24)
                Text(turn["question"].string).padding(16).background(
                  Color.liftTeal.opacity(0.1), in: RoundedRectangle(cornerRadius: 20)
                ).textSelection(.enabled)
              }
              Label("COACH", systemImage: "sparkles").font(.caption.weight(.semibold))
                .foregroundStyle(Color.liftTeal)
              CoachText(text: turn["reply"].string)
              ForEach(turn["visuals"].array) { visual in CoachVisual(value: visual["content"]) }
              ForEach(turn["proposals"].array) { proposal in ProposalView(proposal: proposal) }
              if turn["status"].string == "failed" {
                Text("This reply was interrupted. No change was saved without confirmation.").font(
                  .footnote
                ).foregroundStyle(.secondary)
              }
            }
          }
          if store.streaming {
            HStack {
              Spacer()
              Text(store.composer).padding(16).background(
                Color.liftTeal.opacity(0.1), in: RoundedRectangle(cornerRadius: 20))
            }
            HStack(spacing: 10) {
              ProgressView()
              Text(store.step).font(.footnote).foregroundStyle(.secondary)
            }
            if !store.liveReply.isEmpty { CoachText(text: store.liveReply) }
          }
          Color.clear.frame(height: 1).id("latest")
        }.padding(20)
      }
      .defaultScrollAnchor(.bottom, for: .initialOffset)
      .defaultScrollAnchor(.top, for: .alignment)
      .scrollDismissesKeyboard(.interactively)
      .onScrollGeometryChange(for: Bool.self) { g in
        g.visibleRect.maxY >= g.contentSize.height - 100
      } action: { _, bottom in
        nearBottom = bottom
        if scrolling { follow = bottom }
      }
      .onScrollPhaseChange { previous, next in
        scrolling = next == .tracking || next == .interacting || next == .decelerating
        if next == .idle && previous != .animating { follow = nearBottom }
      }
      .onChange(of: store.streamRevision) { _, _ in
        if follow { proxy.scrollTo("latest", anchor: .bottom) }
      }
      .onChange(of: store.turns.count) { _, _ in
        if follow { withAnimation { proxy.scrollTo("latest", anchor: .bottom) } }
      }
      .overlay(alignment: .bottomTrailing) {
        if !follow {
          Button("Latest", systemImage: "arrow.down") {
            follow = true
            withAnimation { proxy.scrollTo("latest", anchor: .bottom) }
          }.buttonStyle(.borderedProminent).padding()
        }
      }
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 12) {
          if !store.attachments.isEmpty {
            ScrollView(.horizontal) {
              HStack {
                ForEach(store.attachments) { image in
                  HStack {
                    Label(image["category"].string.capitalized, systemImage: "photo")
                    Button("Remove", systemImage: "xmark.circle.fill") {
                      store.attachments.removeAll { $0.id == image.id }
                    }.labelStyle(.iconOnly)
                  }.font(.caption).padding(8).background(.quaternary, in: Capsule())
                }
              }
            }
          }
          HStack(alignment: .bottom, spacing: 12) {
            Menu {
              Toggle("Send uploads to Coach for sorting", isOn: $store.autoTagImages)
              PhotosPicker(selection: $photo, matching: .images) {
                Label("Choose photo", systemImage: "photo")
              }
              if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take photo", systemImage: "camera") { camera = true }
              }
              Button("Log sleep", systemImage: "moon") {
                store.ask("Help me log my sleep last night.")
              }
              Button("Log food", systemImage: "fork.knife") { store.ask("Help me log what I ate.") }
              Button("Log activity", systemImage: "figure.run") {
                store.ask("Help me log my completed cardio activity.")
              }
            } label: {
              Image(systemName: "plus").font(.title3).frame(width: 44, height: 44)
            }.accessibilityLabel("Attach or log").disabled(!store.canSave)
            TextField("Message Coach", text: $store.composer, axis: .vertical).lineLimit(1...5)
              .padding(12).background(
                Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 18)
              ).focused($focused).disabled(store.streaming).accessibilityIdentifier(
                "coach-composer")
            Button {
              if store.streaming {
                store.cancelCoach()
              } else {
                follow = true
                focused = false
                store.send()
                proxy.scrollTo("latest", anchor: .bottom)
              }
            } label: {
              Image(systemName: store.streaming ? "stop.fill" : "arrow.up").font(.headline).frame(
                width: 42, height: 42
              ).background(Color.liftTeal, in: Circle()).foregroundStyle(.white)
            }.accessibilityLabel(store.streaming ? "Stop reply" : "Send message").disabled(
              !store.streaming
                && (!store.canSave
                  || store.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            )
          }
          Text("Review before saving · Coach can make mistakes").font(.caption2).foregroundStyle(
            .secondary)
        }.padding(.horizontal, 14).padding(.vertical, 10).background(.regularMaterial)
      }
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle("Coach").navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Refresh conversation", systemImage: "arrow.clockwise") {
          Task { await store.refresh() }
        }.disabled(store.streaming)
      }
    }
    .onChange(of: photo) { _, value in
      Task {
        do {
          if let data = try await value?.loadTransferable(type: Data.self),
            let image = UIImage(data: data)
          {
            try await store.upload(image)
          }
          photo = nil
        } catch { store.handle(error) }
      }
    }
    .sheet(isPresented: $camera) {
      CameraPicker { image in
        camera = false
        Task { do { try await store.upload(image) } catch { store.handle(error) } }
      }.ignoresSafeArea()
    }
  }
  private var welcome: some View {
    VStack(alignment: .leading, spacing: 24) {
      Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(Color.liftTeal)
      Text("A space for your\nwhole health.").font(
        .system(.largeTitle, design: .rounded, weight: .bold))
      Text("Tell me what you did, ate or how you slept. We’ll take it from there.").font(.title3)
        .foregroundStyle(.secondary)
      ForEach(
        [
          (
            "Plan my day", "sun.max",
            "Help me plan today using my recent training, cardio, food and sleep. Show the most useful next steps."
          ), ("Log a meal", "fork.knife", "Help me log what I ate."),
          ("Log an activity", "figure.run", "Help me log my completed activity."),
          ("Log sleep", "moon", "Help me log my sleep last night."),
        ], id: \.0
      ) { item in
        Button {
          store.ask(item.2)
          focused = true
        } label: {
          HStack {
            Label(item.0, systemImage: item.1)
            Spacer()
            Image(systemName: "arrow.up.left")
          }.padding(16).background(
            Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
        }
      }
    }.padding(.vertical, 20)
  }
}
struct CoachText: View {
  let text: String
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(Array(text.components(separatedBy: "\n\n").enumerated()), id: \.offset) {
        _, paragraph in
        let heading = paragraph.hasPrefix("#")
        Text(attributed(paragraph.trimmingCharacters(in: CharacterSet(charactersIn: "# ")))).font(
          heading ? .headline : .body
        ).lineSpacing(5).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }
  private func attributed(_ text: String) -> AttributedString {
    var value =
      (try? AttributedString(
        markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
      ?? AttributedString(text)
    value.link = nil
    return value
  }
}
struct ProposalView: View {
  @Environment(JournalStore.self) private var store
  let proposal: JSONValue
  @State private var expanded = true
  var saved: Bool { proposal["status"].string == "saved" }
  var body: some View {
    HealthCard {
      DisclosureGroup(isExpanded: $expanded) {
        VStack(alignment: .leading, spacing: 16) {
          Text(proposal["detail"].string).font(.subheadline).foregroundStyle(.secondary)
          RecordDetails(
            value: proposal["cardio"].isNull
              ? proposal["checkin"].isNull
                ? proposal["meal"].isNull
                  ? proposal["workout"].isNull ? proposal["targets"] : proposal["workout"]
                  : proposal["meal"] : proposal["checkin"] : proposal["cardio"])
          if proposal["status"].string == "pending" {
            Button("Save to journal", systemImage: "checkmark") {
              Task {
                do {
                  try await store.confirm(proposal)
                  expanded = false
                } catch { store.handle(error) }
              }
            }.buttonStyle(.borderedProminent).disabled(!store.canSave)
          } else if saved {
            Label("Saved to your journal", systemImage: "checkmark.circle.fill").foregroundStyle(
              Color.liftTeal)
            Button("Undo this save") {
              Task {
                do { try await store.confirm(proposal, undo: true) } catch { store.handle(error) }
              }
            }.disabled(!store.canSave)
          } else {
            Text(proposal["status"].string.capitalized).font(.footnote).foregroundStyle(.secondary)
          }
        }.padding(.top, 12)
      } label: {
        Label(
          (saved ? "Saved · " : "") + proposal["title"].string,
          systemImage: saved ? "checkmark.circle" : "square.and.pencil"
        ).font(.headline)
      }
    }.onAppear { expanded = !saved }
  }
}
struct CoachVisual: View {
  let value: JSONValue
  var body: some View {
    HealthCard {
      Text(value["title"].string).font(.headline)
      switch value["kind"].string {
      case "table":
        ScrollView(.horizontal) {
          Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 14) {
            GridRow {
              ForEach(Array(value["columns"].array.prefix(8).enumerated()), id: \.offset) {
                _, column in Text(column.string).font(.caption.bold())
              }
            }
            Divider()
            ForEach(Array(value["rows"].array.prefix(40).enumerated()), id: \.offset) { _, row in
              GridRow {
                ForEach(Array(row.array.prefix(8).enumerated()), id: \.offset) { _, cell in
                  Text(cell.string).font(.subheadline).frame(maxWidth: 220, alignment: .leading)
                }
              }
            }
          }
        }
      case "bar_chart":
        Chart(Array(value["points"].array.prefix(30).enumerated()), id: \.offset) { _, point in
          BarMark(
            x: .value("Label", point["label"].string),
            y: .value(value["unit"].string, point["value"].double ?? 0)
          ).foregroundStyle(Color.liftTeal)
        }.frame(height: 210)
        Text(value["unit"].string).font(.caption).foregroundStyle(.secondary)
      case "diagram":
        ForEach(Array(value["nodes"].array.prefix(16).enumerated()), id: \.offset) { _, node in
          VStack(alignment: .leading, spacing: 8) {
            Label(node["label"].string, systemImage: "circle.inset.filled").font(
              .subheadline.bold())
            ForEach(
              Array(
                value["edges"].array.filter { $0["from"].string == node.id }.prefix(24).enumerated()
              ), id: \.offset
            ) { _, edge in
              let target =
                value["nodes"].array.first { $0.id == edge["to"].string }?["label"].string ?? ""
              Label(
                [edge["label"].string, target].filter { !$0.isEmpty }.joined(separator: " · "),
                systemImage: "arrow.turn.down.right"
              ).font(.caption).foregroundStyle(.secondary)
            }
          }.padding(12).frame(maxWidth: .infinity, alignment: .leading).background(
            Color.liftTeal.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
        }
      default: EmptyView()
      }
      if !value["caption"].string.isEmpty {
        Text(value["caption"].string).font(.footnote).foregroundStyle(.secondary)
      }
    }
  }
}
struct CameraPicker: UIViewControllerRepresentable {
  let receive: (UIImage) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(receive: receive) }
  func makeUIViewController(context: Context) -> UIImagePickerController {
    let c = UIImagePickerController()
    c.sourceType = .camera
    c.delegate = context.coordinator
    return c
  }
  func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate
  {
    let receive: (UIImage) -> Void
    init(receive: @escaping (UIImage) -> Void) { self.receive = receive }
    func imagePickerController(
      _ picker: UIImagePickerController,
      didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) { if let image = info[.originalImage] as? UIImage { receive(image) } }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
      picker.dismiss(animated: true)
    }
  }
}
