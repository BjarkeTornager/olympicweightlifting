import LiftAPI
import LiftTheme
import PhotosUI
import SwiftUI

/// Coach as correspondence: the athlete's messages on the right in an ink
/// capsule, Coach's replies as letters with their figures, what Coach saved
/// shown in its letter with Undo, and a glass text field with a voice button
/// that turns into a send button once there is text.
struct CoachView: View {
  @Environment(AppModel.self) private var app
  @State private var picked: [PhotosPickerItem] = []
  /// The app keeps Coach for the session, so the queue carries on when
  /// this screen goes (AI sharing turned off, say) and comes back.
  private var coach: CoachModel { app.coach }
  @State private var showingPhotos = false
  @State private var showingCamera = false
  /// The thread opens at the newest message (the default anchor) and
  /// returns there when the athlete sends, and only then: a reader of older
  /// messages stays where they are.
  @State private var position = ScrollPosition(edge: .bottom)
  @FocusState private var composing: Bool
  /// The round controls beside the text field, and the button in it. They
  /// grow with the text, up to a size that leaves the field room.
  @ScaledMetric(relativeTo: .body) private var controlSize: CGFloat = 50
  @ScaledMetric(relativeTo: .body) private var buttonSize: CGFloat = 36
  private var control: CGFloat { min(controlSize, 64) }
  private var button: CGFloat { min(buttonSize, 46) }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        if coach.loaded && coach.items.isEmpty && coach.asking == nil && coach.queue.isEmpty {
          CoachLetter {
            Text("Log a meal from a photo, describe a workout, or ask how your week is going. Tap the microphone to talk instead.")
              .folio(.coach)
              .foregroundStyle(Theme.ink)
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(.top, 24)
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
          VStack(alignment: .leading, spacing: 18) {
            SentMessage(
              text: coach.sendingPreviews.isEmpty || asking != CoachModel.photoOnly ? asking : "",
              previews: coach.sendingPreviews, previewLabel: "Photo you sent")
            let topic = VisualTint.topic(visuals: coach.liveVisuals)
            CoachLetter(topic: topic) {
              if coach.reply.isEmpty {
                CoachWriting(step: coach.step)
              } else {
                CoachText(text: coach.reply)
              }
              // Visuals appear as Coach makes them, before the reply is done.
              Figures(visuals: coach.liveVisuals, topic: topic)
                .animation(.snappy, value: coach.liveVisuals.count)
              // Stop is always here, even with a draft in the text field, and
              // last, so a tall chart never pushes it out of view.
              if coach.sending {
                Button { coach.cancel() } label: {
                  Label("Stop", systemImage: "stop.fill")
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityLabel("Stop Coach's reply")
              }
            }
          }
          .padding(.bottom, 26)
        }
        // Messages sent while Coach answers another wait their turn here.
        ForEach(coach.waiting) { item in
          QueuedMessage(item: item, coach: coach).padding(.bottom, 18)
        }
        if let error = coach.error {
          Label(error, systemImage: "exclamationmark.circle")
            .font(.footnote)
            .foregroundStyle(Theme.ink)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(Theme.fill, in: .capsule)
            .frame(maxWidth: .infinity)
            .padding(.top, 6)
        }
      }
      .padding(.horizontal, Theme.Space.gutter)
      .padding(.vertical, 8)
    }
    .defaultScrollAnchor(.bottom)
    .scrollPosition($position)
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
    // Clearing the field after Edit lets the messages behind it go.
    .onChange(of: coach.hasDraft) { _, has in
      if !has { coach.draftCleared(app) }
    }
    // Today's first steps open Coach for a meal photo or a goals message.
    .onChange(of: app.coachIntent, initial: true) { _, intent in
      guard let intent else { return }
      app.coachIntent = nil
      switch intent {
      case .mealPhoto:
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
          showingCamera = true
        } else {
          showingPhotos = true
        }
      case .message(let text):
        if coach.draft.isEmpty { coach.draft = text }
        composing = true
      }
    }
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

  /// Sending puts the keyboard away, as the reply is what comes next, and
  /// shows the message just sent.
  private func send() {
    guard coach.canSend else {
      if coach.queueFull && coach.hasDraft {
        UIAccessibility.post(notification: .announcement, argument: CoachModel.queueFullText)
      }
      return
    }
    composing = false
    coach.send(app)
    position.scrollTo(edge: .bottom)
  }

  // MARK: Composer

  private var composer: some View {
    VStack(spacing: 8) {
      if coach.queueFull && coach.hasDraft {
        Text(CoachModel.queueFullText)
          .font(.footnote)
          .foregroundStyle(Theme.inkSecondary)
          .multilineTextAlignment(.center)
          .frame(maxWidth: .infinity)
          .padding(.horizontal, 8)
      }
      if !coach.attachments.isEmpty {
        ScrollView(.horizontal) {
          HStack(spacing: 8) {
            ForEach(coach.attachments) { photo in
              Image(uiImage: photo.preview)
                .resizable()
                .scaledToFill()
                .frame(width: 64, height: 64)
                .clipShape(.rect(cornerRadius: Theme.Radius.badge, style: .continuous))
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
            .font(.title3.weight(.medium))
            .foregroundStyle(Theme.ink)
            .frame(width: control, height: control)
        }
        .glassEffect(.regular.interactive(), in: .circle)
        .disabled(coach.attachments.count >= 4)
        .accessibilityLabel("Add photo")

        HStack(alignment: .bottom, spacing: 6) {
          TextField(
            "Write to Coach", text: Bindable(coach).draft,
            prompt: Text("Write to Coach").font(.system(.body, design: .serif)).italic()
              .foregroundStyle(Theme.inkSecondary),
            axis: .vertical
          )
          .font(.body)
          .foregroundStyle(Theme.ink)
          .lineLimit(1...6)
          .focused($composing)
          .padding(.leading, 18)
          .padding(.vertical, 14)
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
            .padding(.trailing, (control - button) / 2)
            .padding(.bottom, (control - button) / 2)
        }
        .frame(minHeight: control)
        .glassEffect(.regular.interactive(), in: .rect(cornerRadius: control / 2))
      }
      // Large, but never so large that the field has no room to write in.
      .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }
    .padding(.horizontal, 16)
    .padding(.bottom, 6)
  }

  /// Send whenever there's a draft, even while Coach answers another
  /// message (it waits its turn), held back only by a full queue; Stop when
  /// the field is empty and Coach is answering; otherwise the voice button.
  @ViewBuilder
  private var trailingButton: some View {
    if coach.hasDraft {
      Button(action: send) {
        Image(systemName: "arrow.up")
          .font(.body.weight(.bold))
          .foregroundStyle(Theme.onAccentFill)
          .frame(width: button, height: button)
          .background(Theme.accentFill.opacity(coach.queueFull ? 0.35 : 1), in: .circle)
      }
      .disabled(coach.queueFull)
      .accessibilityLabel("Send")
    } else if coach.sending {
      Button("Stop", systemImage: "stop.fill") { coach.cancel() }
        .labelStyle(.iconOnly)
        .font(.subheadline.weight(.bold))
        .foregroundStyle(Theme.ink)
        .frame(width: button, height: button)
        .background(Theme.fill, in: .circle)
    } else if app.voiceEnabled {
      Button {
        composing = false
        app.startVoice()
      } label: {
        Image(systemName: "waveform")
          .font(.body.weight(.semibold))
          .foregroundStyle(Theme.onAccentFill)
          .frame(width: button, height: button)
          .background(Theme.accentFill, in: .circle)
      }
      .accessibilityLabel("Talk to Coach")
    }
  }
}

// MARK: Messages

/// The day between hairlines: "Today · 21:45", "Yesterday", "Friday 2
/// October".
private struct DayStamp: View {
  let date: Date

  var body: some View {
    HStack(spacing: 12) {
      Rectangle().fill(Theme.rule).frame(height: 1)
      Text(label).kicker().fixedSize()
      Rectangle().fill(Theme.rule).frame(height: 1)
    }
    .padding(.top, 20)
    .padding(.bottom, 16)
    .accessibilityElement(children: .combine)
  }

  private var label: String {
    if Calendar.current.isDateInToday(date) {
      return "Today · " + date.formatted(date: .omitted, time: .shortened)
    }
    if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
    return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
  }
}

private struct TurnView: View {
  @Environment(AppModel.self) private var app
  let turn: CoachTurn
  let coach: CoachModel

  var body: some View {
    let visuals = turn.visuals ?? []
    let reply = turn.reply ?? ""
    VStack(alignment: .leading, spacing: 18) {
      SentMessage(
        text: !turn.photoIds.isEmpty && turn.question == CoachModel.photoOnly ? "" : turn.question,
        photoIDs: turn.photoIds, voice: turn.fromVoice)
      if !reply.isEmpty || turn.status == "failed" || turn.status == "running" || !visuals.isEmpty
        || !turn.receipts.isEmpty
      {
        let topic = VisualTint.topic(visuals: visuals, receipts: turn.receipts.map(\.title))
        CoachLetter(topic: topic) {
          if !reply.isEmpty {
            CoachText(text: reply)
          } else if turn.status == "failed" {
            CoachText(text: "Sorry, I couldn't finish that one. Try asking again.")
          } else if turn.status == "running" {
            // Still being answered, as after the app was closed mid-reply.
            CoachWriting(step: "Still working")
          }
          // Charts, maps and saved entries sit in the letter's margin.
          Figures(visuals: visuals, topic: topic)
          ForEach(turn.receipts, id: \.id) { receipt in
            ReceiptCard(receipt: receipt, busy: coach.busyReceipt == receipt.id) { undo in
              Task { await coach.resolve(receipt, undo: undo, app: app) }
            }
          }
        }
      }
    }
    .padding(.bottom, 26)
  }
}

/// A reply's figures, each on its sheet, numbered in order and lit in the
/// colour of the reply's topic.
struct Figures: View {
  let visuals: [Components.Schemas.CoachVisual]
  var topic: Category?

  var body: some View {
    let numbers = CoachVisualView.numbers(visuals)
    let tint = topic?.tint
    ForEach(Array(visuals.enumerated()), id: \.element.id) { index, visual in
      CoachVisualView(visual: visual, number: numbers[index], tint: tint)
        .card(padding: 14)
        .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .top)))
    }
  }
}

/// A voice call in the thread: when and how long, and what was said, set as
/// on the call screen. Long calls start folded.
private struct VoiceCallCard: View {
  let call: VoiceCallRecord
  @State private var expanded = false
  private let folded = 4

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 8) {
        Image(systemName: "waveform").foregroundStyle(Theme.accent).accessibilityHidden(true)
        Text("Voice call").foregroundStyle(Theme.ink).kicker()
        Text(duration).kicker()
      }
      .padding(.bottom, 8)
      .accessibilityElement(children: .combine)
      ForEach(Array(shown.enumerated()), id: \.offset) { _, line in
        TranscriptLine(coach: line.role == "coach", text: line.text)
      }
      if call.lines.count > folded {
        Button(expanded ? "Show less" : "Show the whole call (\(call.lines.count) lines)") {
          withAnimation { expanded.toggle() }
        }
        .buttonStyle(SecondaryButtonStyle())
        .padding(.top, 10)
      }
    }
    .card(padding: 14)
    .padding(.bottom, 26)
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

/// What Coach saved, or offers to save: a sheet with the entry's name in the
/// serif, Undo or Save, and the details on request.
struct ReceiptCard: View {
  let receipt: Components.Schemas.CoachReceipt
  let busy: Bool
  let resolve: (_ undo: Bool) -> Void
  /// A receipt waiting to be saved opens by itself, so the athlete can
  /// check the entries first; a saved one opens on tap.
  @State private var expanded: Bool?
  @Environment(\.dynamicTypeSize) private var typeSize

  private var entries: [Components.Schemas.CoachReceiptEntry] { receipt.entries ?? [] }
  private var isOpen: Bool { expanded ?? (receipt.state == "pending") }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Image(systemName: symbol)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(receipt.state == "pending" ? Theme.accent : Theme.ink)
          .accessibilityHidden(true)
        Button {
          withAnimation(.snappy) { expanded = !isOpen }
        } label: {
          VStack(alignment: .leading, spacing: 3) {
            Text(receipt.title).folio(.entry).foregroundStyle(Theme.ink)
            Text(receipt.detail)
              .font(.footnote)
              .foregroundStyle(Theme.inkSecondary)
              .lineLimit(isOpen ? nil : 2)
            if receipt.state == "undone" {
              Text("Undone").font(.footnote.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
            }
            if !entries.isEmpty {
              Label(isOpen ? "Hide details" : "Show details", systemImage: isOpen ? "chevron.up" : "chevron.down")
                .font(.footnote.weight(.semibold))
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
        if !typeSize.isAccessibilitySize { action }
      }
      if typeSize.isAccessibilitySize { action }
      if isOpen, !entries.isEmpty {
        VStack(alignment: .leading, spacing: 12) {
          ForEach(Array(entries.enumerated()), id: \.offset) { index, entry in
            if index > 0 { Rectangle().fill(Theme.rule).frame(height: 1) }
            EntryDetails(entry: entry)
          }
        }
        .padding(12)
        .background(Theme.fill, in: .rect(cornerRadius: Theme.Radius.badge, style: .continuous))
        .transition(.opacity.combined(with: .move(edge: .top)))
      }
    }
    .card(padding: 14)
  }

  @ViewBuilder
  private var action: some View {
    if busy {
      ProgressView().frame(minWidth: 44, minHeight: 44)
    } else if receipt.state == "saved" {
      Button("Undo") { resolve(true) }
        .buttonStyle(SecondaryButtonStyle())
    } else if receipt.state == "pending" {
      Button("Save") { resolve(false) }
        .buttonStyle(PrimaryButtonStyle(height: 44, fullWidth: false))
    }
  }

  private var symbol: String {
    switch receipt.state {
    case "saved": "checkmark"
    case "undone": "arrow.uturn.backward"
    case "expired": "clock"
    default: "square.and.pencil"
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
