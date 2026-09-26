import LiftAPI
import PhotosUI
import SwiftUI

struct CoachView: View {
  @Environment(AppModel.self) private var app
  @State private var coach = CoachModel()
  @State private var picked: [PhotosPickerItem] = []
  @State private var showingCamera = false
  @FocusState private var composing: Bool

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 20) {
        if coach.loaded && coach.turns.isEmpty && coach.asking == nil {
          ContentUnavailableView(
            "Ask Coach", systemImage: "bubble.left.and.text.bubble.right",
            description: Text(
              "Log a meal from a photo, record a workout in your own words, or ask how your week is going."))
        }
        ForEach(coach.turns, id: \.id) { turn in
          TurnView(turn: turn, coach: coach)
        }
        if let asking = coach.asking {
          Bubble(text: asking)
          VStack(alignment: .leading, spacing: 8) {
            if !coach.reply.isEmpty { Reply(text: coach.reply) }
            if let step = coach.step {
              Label(step, systemImage: "ellipsis")
                .symbolEffect(.variableColor.iterative)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
          }
        }
        if let error = coach.error {
          Label(error, systemImage: "exclamationmark.triangle")
            .font(.subheadline)
            .foregroundStyle(.orange)
        }
      }
      .padding()
    }
    .defaultScrollAnchor(.bottom)
    .scrollDismissesKeyboard(.interactively)
    .navigationTitle("Coach")
    .navigationBarTitleDisplayMode(.inline)
    .safeAreaInset(edge: .bottom) { composer }
    .task { if !coach.loaded { await coach.load(app) } }
    .refreshable { await coach.load(app) }
    .onChange(of: picked) { _, items in
      Task {
        for item in items {
          if let data = try? await item.loadTransferable(type: Data.self),
            let image = UIImage(data: data)
          {
            coach.attach(image)
          }
        }
        picked = []
      }
    }
    .fullScreenCover(isPresented: $showingCamera) {
      CameraPicker { coach.attach($0) }.ignoresSafeArea()
    }
  }

  private var composer: some View {
    VStack(spacing: 8) {
      if !coach.attachments.isEmpty {
        ScrollView(.horizontal) {
          HStack {
            ForEach(coach.attachments) { photo in
              Image(uiImage: photo.preview)
                .resizable()
                .scaledToFill()
                .frame(width: 56, height: 56)
                .clipShape(.rect(cornerRadius: 10))
                .overlay(alignment: .topTrailing) {
                  Button("Remove photo", systemImage: "xmark.circle.fill") {
                    coach.attachments.removeAll { $0.id == photo.id }
                  }
                  .labelStyle(.iconOnly)
                  .foregroundStyle(.white, .black.opacity(0.6))
                  .offset(x: 6, y: -6)
                }
            }
          }
          .padding(.top, 6)
        }
      }
      HStack(alignment: .bottom, spacing: 10) {
        Menu {
          Button("Take photo", systemImage: "camera") { showingCamera = true }
            .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
          PhotosPicker(
            selection: $picked, maxSelectionCount: max(1, 4 - coach.attachments.count),
            matching: .images
          ) {
            Label("Choose photos", systemImage: "photo.on.rectangle")
          }
        } label: {
          Image(systemName: "plus")
            .font(.title3)
            .frame(width: 36, height: 36)
        }
        .accessibilityLabel("Add photo")
        .disabled(coach.sending || coach.attachments.count >= 4)

        TextField("Message Coach", text: $coach.draft, axis: .vertical)
          .lineLimit(1...6)
          .focused($composing)
          .padding(.vertical, 8)

        if coach.sending {
          Button("Stop", systemImage: "stop.circle.fill") { coach.cancel() }
            .labelStyle(.iconOnly)
            .font(.title)
        } else {
          Button("Send", systemImage: "arrow.up.circle.fill") {
            coach.send(app)
          }
          .labelStyle(.iconOnly)
          .font(.title)
          .disabled(!coach.canSend)
        }
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .glassEffect(.regular, in: .rect(cornerRadius: 24))
    .padding(.horizontal, 12)
    .padding(.bottom, 6)
  }
}

private struct TurnView: View {
  @Environment(AppModel.self) private var app
  let turn: CoachTurn
  let coach: CoachModel

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Bubble(
        text: turn.question, voice: turn.fromVoice, photos: turn.photoIds.count)
      if let reply = turn.reply, !reply.isEmpty { Reply(text: reply) }
      if turn.status == "failed" {
        Label("Coach couldn't finish this one.", systemImage: "exclamationmark.triangle")
          .font(.subheadline).foregroundStyle(.orange)
      }
      ForEach(turn.receipts, id: \.id) { receipt in
        ReceiptCard(receipt: receipt, busy: coach.busyReceipt == receipt.id) { undo in
          Task { await coach.resolve(receipt, undo: undo, app: app) }
        }
      }
    }
  }
}

private struct Bubble: View {
  let text: String
  var voice = false
  var photos = 0

  var body: some View {
    VStack(alignment: .trailing, spacing: 4) {
      if voice {
        Label("From your voice check-in", systemImage: "waveform")
          .font(.caption).foregroundStyle(.secondary)
      }
      Text(text)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.accentColor.opacity(0.15), in: .rect(cornerRadius: 18))
      if photos > 0 {
        Label("\(photos) \(photos == 1 ? "photo" : "photos")", systemImage: "photo")
          .font(.caption).foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .padding(.leading, 48)
  }
}

private struct Reply: View {
  let text: String

  var body: some View {
    Text(CoachReplyFormat.attributed(text))
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

enum CoachReplyFormat {
  static func attributed(_ text: String) -> AttributedString {
    (try? AttributedString(
      markdown: text,
      options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
  }
}

private struct ReceiptCard: View {
  let receipt: Components.Schemas.CoachReceipt
  let busy: Bool
  let resolve: (_ undo: Bool) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Image(systemName: icon).foregroundStyle(color)
        Text(receipt.title).font(.subheadline.weight(.semibold))
        Spacer()
        if busy {
          ProgressView()
        } else if receipt.state == "saved" {
          Button("Undo") { resolve(true) }.font(.subheadline)
        } else if receipt.state == "pending" {
          Button("Save") { resolve(false) }
            .font(.subheadline.weight(.semibold))
            .buttonStyle(.borderedProminent)
        }
      }
      Text(receipt.detail).font(.footnote).foregroundStyle(.secondary)
    }
    .padding(12)
    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14))
    .accessibilityElement(children: .contain)
  }

  private var icon: String {
    switch receipt.state {
    case "saved": "checkmark.circle.fill"
    case "undone": "arrow.uturn.backward.circle"
    case "expired": "clock"
    default: "square.and.pencil"
    }
  }

  private var color: Color {
    receipt.state == "saved" ? .green : .secondary
  }
}

/// The system camera, for a meal or a screenshot of a workout.
struct CameraPicker: UIViewControllerRepresentable {
  let captured: (UIImage) -> Void
  @Environment(\.dismiss) private var dismiss

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let parent: CameraPicker
    init(_ parent: CameraPicker) { self.parent = parent }

    func imagePickerController(
      _ picker: UIImagePickerController,
      didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
      if let image = info[.originalImage] as? UIImage { parent.captured(image) }
      parent.dismiss()
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
      parent.dismiss()
    }
  }
}
