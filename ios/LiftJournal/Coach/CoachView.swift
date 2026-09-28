import LiftAPI
import LiftTheme
import PhotosUI
import SwiftUI

/// Coach as a conversation, in the style of Messages: the athlete's
/// messages on the right in the accent colour, Coach's replies on the left,
/// what Coach saved shown under its reply with Undo, and a round text field
/// with a microphone that turns into a send button once there is text.
struct CoachView: View {
  @Environment(AppModel.self) private var app
  @State private var coach = CoachModel()
  @State private var picked: [PhotosPickerItem] = []
  @State private var showingPhotos = false
  @State private var showingCamera = false
  @FocusState private var composing: Bool

  var body: some View {
    ScrollView {
      LazyVStack(spacing: 4) {
        if coach.loaded && coach.items.isEmpty && coach.asking == nil {
          ContentUnavailableView {
            Label("Coach", systemImage: "bubble.left.and.text.bubble.right")
          } description: {
            Text("Log a meal from a photo, describe a workout, or ask how your week is going. Tap the microphone to talk instead.")
          }
          .padding(.top, 80)
        }
        let items = coach.items
        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
          if index == 0 || !Calendar.current.isDate(item.date, inSameDayAs: items[index - 1].date) {
            DayStamp(date: item.date)
          }
          switch item {
          case .turn(let turn): TurnView(turn: turn, coach: coach)
          case .call(let call): VoiceCallCard(call: call)
          }
        }
        if let asking = coach.asking {
          VStack(spacing: 6) {
            SentMessage(
              text: coach.sendingPreviews.isEmpty || asking != CoachModel.photoOnly ? asking : "",
              previews: coach.sendingPreviews)
            if coach.reply.isEmpty {
              TypingBubble(step: coach.step)
            } else {
              CoachMessages(text: coach.reply)
            }
            // Visuals appear as Coach makes them, before the reply is done.
            VStack(spacing: 8) {
              ForEach(coach.liveVisuals, id: \.id) { visual in
                CoachVisualView(visual: visual)
                  .padding(12)
                  .background(Theme.surface, in: .rect(cornerRadius: 18))
                  .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .top)))
              }
            }
            .padding(.leading, 34)
            .animation(.snappy, value: coach.liveVisuals.count)
          }
        }
        if let error = coach.error {
          Label(error, systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
        }
      }
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
    }
    .defaultScrollAnchor(.bottom)
    // The keyboard covers the tab bar: any scroll or tap on the thread puts
    // it away, so the rest of the app is always one tap from here.
    .scrollDismissesKeyboard(.immediately)
    .simultaneousGesture(TapGesture().onEnded { composing = false })
    .background(Theme.background)
    .navigationTitle("Coach")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if app.voiceEnabled {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Talk to Coach", systemImage: "waveform") { app.startVoice() }
        }
      }
    }
    .safeAreaInset(edge: .bottom) { composer }
    .task { if !coach.loaded { await coach.load(app) } }
    .onChange(of: app.voiceEnded) { _, _ in
      Task {
        await coach.load(app)
        // The server tidies the transcript just after the call; show it.
        try? await Task.sleep(for: .seconds(15))
        await coach.load(app)
      }
    }
    .refreshable { await coach.load(app) }
    .photosPicker(
      isPresented: $showingPhotos, selection: $picked,
      maxSelectionCount: max(1, 4 - coach.attachments.count), matching: .images)
    .onChange(of: picked) { _, items in
      Task {
        for item in items {
          if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
            coach.attach(image)
          }
        }
        picked = []
      }
    }
    .fullScreenCover(isPresented: $showingCamera) {
      CameraPicker { coach.attach($0) }.ignoresSafeArea()
    }
    .sensoryFeedback(.impact(weight: .light), trigger: coach.sentCount)
  }

  static func date(_ text: String) -> Date {
    (try? Date(text, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)))
      ?? (try? Date(text, strategy: .iso8601)) ?? .now
  }

  /// Sending puts the keyboard away, as the reply is what comes next.
  private func send() {
    guard coach.canSend else { return }
    composing = false
    coach.send(app)
  }

  // MARK: Composer

  private var composer: some View {
    VStack(spacing: 8) {
      if !coach.attachments.isEmpty {
        ScrollView(.horizontal) {
          HStack(spacing: 8) {
            ForEach(coach.attachments) { photo in
              Image(uiImage: photo.preview)
                .resizable()
                .scaledToFill()
                .frame(width: 64, height: 64)
                .clipShape(.rect(cornerRadius: 12))
                .overlay(alignment: .topTrailing) {
                  Button("Remove photo", systemImage: "xmark.circle.fill") {
                    coach.attachments.removeAll { $0.id == photo.id }
                  }
                  .labelStyle(.iconOnly)
                  .symbolRenderingMode(.palette)
                  .foregroundStyle(.white, .black.opacity(0.6))
                  .padding(4)
                }
            }
          }
          .padding(.horizontal, 4)
        }
        .scrollIndicators(.hidden)
      }
      HStack(alignment: .bottom, spacing: 8) {
        Menu {
          Button("Camera", systemImage: "camera") { showingCamera = true }
            .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))
          Button("Photos", systemImage: "photo.on.rectangle") { showingPhotos = true }
        } label: {
          Image(systemName: "plus")
            .font(.system(size: 17, weight: .semibold))
            .frame(width: 40, height: 40)
        }
        .glassEffect(.regular.interactive(), in: .circle)
        .disabled(coach.sending || coach.attachments.count >= 4)
        .accessibilityLabel("Add photo")

        HStack(alignment: .bottom, spacing: 4) {
          TextField("Message", text: $coach.draft, axis: .vertical)
            .lineLimit(1...6)
            .focused($composing)
            .padding(.leading, 14)
            .padding(.vertical, 10)
            .submitLabel(.send)
            // A multi-line field puts a line break where the Send key is
            // pressed: treat that as sending, as the key says.
            .onChange(of: coach.draft) { old, new in
              if new.hasSuffix("\n"), !old.hasSuffix("\n") {
                coach.draft = String(new.dropLast())
                send()
              }
            }
          trailingButton
            .padding(.trailing, 4)
            .padding(.bottom, 4)
        }
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 20))
      }
    }
    .padding(.horizontal, 12)
    .padding(.bottom, 6)
  }

  @ViewBuilder
  private var trailingButton: some View {
    if coach.sending {
      Button("Stop", systemImage: "stop.fill") { coach.cancel() }
        .labelStyle(.iconOnly)
        .font(.system(size: 14, weight: .bold))
        .frame(width: 32, height: 32)
        .background(Color.secondary.opacity(0.25), in: .circle)
    } else if coach.canSend {
      Button(action: send) {
        Image(systemName: "arrow.up")
          .font(.system(size: 15, weight: .bold))
          .foregroundStyle(Theme.onAccent)
          .frame(width: 32, height: 32)
          .background(Theme.accent, in: .circle)
      }
      .accessibilityLabel("Send")
    } else if app.voiceEnabled {
      Button {
        composing = false
        app.startVoice()
      } label: {
        Image(systemName: "waveform")
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 32, height: 32)
      }
      .accessibilityLabel("Talk to Coach")
    }
  }
}

// MARK: Messages

private struct DayStamp: View {
  let date: Date

  var body: some View {
    Text(label)
      .font(.caption.weight(.medium))
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity)
      .padding(.top, 14)
      .padding(.bottom, 4)
  }

  private var label: String {
    if Calendar.current.isDateInToday(date) { return "Today " + date.formatted(date: .omitted, time: .shortened) }
    if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
    return date.formatted(.dateTime.weekday(.wide).day().month())
  }
}

private struct TurnView: View {
  @Environment(AppModel.self) private var app
  let turn: CoachTurn
  let coach: CoachModel

  var body: some View {
    VStack(spacing: 6) {
      SentMessage(
        text: !turn.photoIds.isEmpty && turn.question == CoachModel.photoOnly ? "" : turn.question,
        photoIDs: turn.photoIds, voice: turn.fromVoice)
      if let reply = turn.reply, !reply.isEmpty {
        CoachMessages(text: reply)
      } else if turn.status == "failed" {
        CoachMessages(text: "Sorry, I couldn't finish that one. Try asking again.")
      } else if turn.status == "running" {
        // Still being answered, as after the app was closed mid-reply.
        TypingBubble(step: "Still working")
      }
      // Charts, maps and saved entries sit in the coach's column.
      VStack(spacing: 8) {
        ForEach(turn.visuals ?? [], id: \.id) { visual in
          CoachVisualView(visual: visual)
            .padding(12)
            .background(Theme.surface, in: .rect(cornerRadius: 18))
        }
        ForEach(turn.receipts, id: \.id) { receipt in
          ReceiptCard(receipt: receipt, busy: coach.busyReceipt == receipt.id) { undo in
            Task { await coach.resolve(receipt, undo: undo, app: app) }
          }
        }
      }
      .padding(.leading, 34)
    }
    .padding(.bottom, 12)
  }
}

/// A voice call in the thread: when and how long, and what was said, in
/// the same sides as typed messages. Long calls start folded.
private struct VoiceCallCard: View {
  let call: VoiceCallRecord
  @State private var expanded = false
  private let folded = 4

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label {
        Text("Voice call").font(.subheadline.weight(.semibold))
          + Text(" · \(duration)").font(.subheadline).foregroundStyle(.secondary)
      } icon: {
        Image(systemName: "waveform").foregroundStyle(.tint)
      }
      ForEach(Array(shown.enumerated()), id: \.offset) { _, line in
        HStack {
          if line.role == "you" { Spacer(minLength: 40) }
          Text(line.text)
            .font(.subheadline)
            .textSelection(.enabled)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .foregroundStyle(line.role == "you" ? Theme.onAccent : Color.primary)
            .background(
              line.role == "you" ? Theme.accent : Theme.fill,
              in: .rect(cornerRadius: 16))
          if line.role == "coach" { Spacer(minLength: 40) }
        }
      }
      if call.lines.count > folded {
        Button(expanded ? "Show less" : "Show the whole call (\(call.lines.count) lines)") {
          withAnimation { expanded.toggle() }
        }
        .font(.footnote.weight(.medium))
      }
    }
    .padding(12)
    .background(Theme.surface, in: .rect(cornerRadius: 20))
    .padding(.bottom, 12)
    .accessibilityElement(children: .contain)
  }

  private var shown: [Components.Schemas.VoiceCallLine] {
    expanded ? call.lines : Array(call.lines.prefix(folded))
  }

  private var duration: String {
    let seconds = max(0, CoachView.date(call.endedAt).timeIntervalSince(CoachView.date(call.startedAt)))
    return seconds < 60 ? "under a minute" : Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
  }
}

private struct ReceiptCard: View {
  let receipt: Components.Schemas.CoachReceipt
  let busy: Bool
  let resolve: (_ undo: Bool) -> Void
  /// A receipt waiting to be saved opens by itself, so the athlete can
  /// check the entries first; a saved one opens on tap.
  @State private var expanded: Bool?

  private var entries: [Components.Schemas.CoachReceiptEntry] { receipt.entries ?? [] }
  private var isOpen: Bool { expanded ?? (receipt.state == "pending") }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .top, spacing: 10) {
        IconBadge(symbol: symbol, tint: tint, size: 28)
        Button {
          withAnimation(.snappy) { expanded = !isOpen }
        } label: {
          VStack(alignment: .leading, spacing: 2) {
            Text(receipt.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.primary)
            Text(receipt.detail)
              .font(.footnote)
              .foregroundStyle(.secondary)
              .lineLimit(isOpen ? nil : 2)
            if receipt.state == "undone" {
              Text("Undone").font(.footnote.weight(.medium)).foregroundStyle(.secondary)
            }
            if !entries.isEmpty {
              Label(isOpen ? "Hide details" : "Show details", systemImage: isOpen ? "chevron.up" : "chevron.down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.accent)
                .padding(.top, 4)
            }
          }
          .multilineTextAlignment(.leading)
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(entries.isEmpty && receipt.detail.count < 90)
        .accessibilityHint(entries.isEmpty ? "" : isOpen ? "Hides what was saved" : "Shows what was saved")
        if busy {
          ProgressView()
        } else if receipt.state == "saved" {
          Button("Undo") { resolve(true) }
            .buttonStyle(.bordered)
            .controlSize(.small)
        } else if receipt.state == "pending" {
          Button("Save") { resolve(false) }
            .buttonStyle(.borderedProminent)
            .foregroundStyle(Theme.onAccent)
            .controlSize(.small)
        }
      }
      if isOpen, !entries.isEmpty {
        VStack(alignment: .leading, spacing: 12) {
          ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
            if index > 0 { Divider() }
            EntryDetails(entry: entry)
          }
        }
        .padding(12)
        .background(Theme.fill, in: .rect(cornerRadius: 12, style: .continuous))
        .transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
    .padding(12)
    .background(Theme.surface, in: .rect(cornerRadius: 16))
    .frame(maxWidth: 340, alignment: .leading)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var symbol: String {
    switch receipt.state {
    case "saved": "checkmark"
    case "undone": "arrow.uturn.backward"
    case "expired": "clock"
    default: "square.and.pencil"
    }
  }

  private var tint: Color {
    switch receipt.state {
    case "saved": Theme.success
    case "pending": Theme.accent
    default: .secondary
    }
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
