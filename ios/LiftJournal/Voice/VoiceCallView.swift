import LiftAPI
import LiftTheme
import SwiftUI

/// The spoken check-in, full screen: a voice that moves with whoever is
/// talking, the conversation as it happens with each save and card, and the
/// call controls at the bottom.
struct VoiceCallView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let call: VoiceCall
  /// A card opened in full, or the camera: one at a time over the call.
  @State private var over = CallPresentation()

  var body: some View {
    // A card needs the room more than the voice does.
    let small = call.cards > 0
    NavigationStack {
      VStack(spacing: 0) {
        VoiceOrb(level: call.level, active: call.status == .speaking || call.status == .listening)
          .opacity(call.inCall ? 1 : 0.35)
          .animation(.easeInOut, value: call.inCall)
          .scaleEffect(small ? 96 / 220 : 1)
          .frame(height: small ? 96 : 220)
          .animation(.smooth, value: small)
          .padding(.top, 12)
        Text(statusText)
          .font(.headline)
          .foregroundStyle(call.status == .failed ? .red : .secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal)
          // It changes often (speaking, listening): cross-fading overlapped
          // the two labels.
          .contentTransition(.identity)
        if !app.voiceOptions.isEmpty {
          Text("\(call.provider.voiceName(in: app.voiceOptions) ?? "Voice") by \(call.provider.title) · change it in Profile")
            .font(.caption)
            .foregroundStyle(.tertiary)
            .padding(.top, 2)
        }
        transcript
        controls
      }
      .background(Theme.background)
      .navigationTitle("Voice Check-In")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          if !call.inCall {
            Button("Done", role: .confirm) { dismiss() }
          }
        }
      }
      .sheet(item: $over.card, onDismiss: { over.sheetDismissed(cameraWaiting: call.cameraRequested) }) { line in
        // As it is now: a picture may have been added since it opened.
        if let visual = call.lines.first(where: { $0.id == line.id })?.visual ?? line.visual {
          CardSheet(visual: visual)
        }
      }
      .fullScreenCover(
        isPresented: Binding(
          get: { over.camera },
          set: { shown in
            over.camera = shown
            if !shown { call.cameraRequested = false }
          })
      ) {
        CameraPicker { image in Task { await call.photoTaken(image) } }.ignoresSafeArea()
      }
      .onChange(of: call.cameraRequested) { _, requested in over.cameraRequested(requested) }
    }
    .interactiveDismissDisabled(call.inCall)
    .task { if call.status == .idle { await call.start() } }
  }

  private var statusText: String {
    switch call.status {
    case .idle, .connecting: "Connecting…"
    case .listening: call.muted ? "Muted" : "Listening"
    case .speaking: "Coach is speaking"
    case .reconnecting: "Reconnecting… the conversation carries on"
    case .ended: Self.ended(saved: call.saved, cards: call.cards)
    case .failed: call.error ?? "The call could not continue."
    }
  }

  /// "Call ended · 2 saved · 1 card. Everything is in Coach, with Undo."
  static func ended(saved: Int, cards: Int) -> String {
    let parts = [
      saved > 0 ? "\(saved) saved" : nil,
      cards > 0 ? "\(cards) \(cards == 1 ? "card" : "cards")" : nil,
    ].compactMap { $0 }
    guard !parts.isEmpty else { return "Call ended." }
    return (["Call ended"] + parts).joined(separator: " · ")
      + (saved > 0 ? ". Everything is in Coach, with Undo." : ". Everything is in Coach.")
  }

  private var transcript: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(spacing: 8) {
          ForEach(call.lines) { line in
            switch line.role {
            case .you:
              TranscriptLine(coach: false, text: line.text)
            case .coach:
              TranscriptLine(coach: true, text: line.text)
            case .save:
              SaveChip(label: line.text, state: line.state ?? .saving)
            case .card:
              if let visual = line.visual {
                VoiceCard(visual: visual) { over.expand(line) }
              }
            }
          }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
      }
      .defaultScrollAnchor(.bottom)
      // A new card is read from its top.
      .onChange(of: call.lines.last(where: { $0.role == .card })?.id) { _, id in
        guard let id else { return }
        withAnimation { proxy.scrollTo(id, anchor: .top) }
      }
    }
  }

  @ViewBuilder
  private var controls: some View {
    if call.inCall {
      HStack(spacing: 28) {
        CallButton(
          title: call.muted ? "Unmute" : "Mute",
          symbol: call.muted ? "mic.slash.fill" : "mic.fill",
          tint: call.muted ? .white : nil
        ) {
          call.muted.toggle()
        }
        .sensoryFeedback(.selection, trigger: call.muted)
        CallButton(title: "Camera", symbol: "camera.fill") { call.cameraRequested = true }
        CallButton(title: "End", symbol: "phone.down.fill", tint: .red) {
          call.stop()
        }
      }
      .padding(.vertical, 20)
    } else if call.status == .failed {
      Button("Try Again") { Task { await call.start() } }
        .buttonStyle(.glassProminent)
        .foregroundStyle(Theme.onAccent)
        .controlSize(.large)
        .padding(.vertical, 20)
    }
  }
}

/// What is shown over the call, one at a time: two presentations at once
/// fail, so a card's sheet closes before the camera opens.
struct CallPresentation {
  var card: VoiceCall.Line?
  var camera = false

  mutating func expand(_ line: VoiceCall.Line) {
    if !camera { card = line }
  }

  mutating func cameraRequested(_ requested: Bool) {
    if !requested {
      camera = false
    } else if card != nil {
      card = nil
    } else {
      camera = true
    }
  }

  /// The sheet has gone: the camera opens if it is still wanted.
  mutating func sheetDismissed(cameraWaiting: Bool) {
    if cameraWaiting { camera = true }
  }
}

/// A card the coach put on screen, compact so the conversation stays in
/// view; the whole card opens in a sheet. Its picture doesn't open full
/// screen over the call.
private struct VoiceCard: View {
  let visual: Visual
  let expand: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      CoachVisualView(visual: visual, compact: true)
      if let more = CoachVisualView.more(visual) {
        Button(more, action: expand)
          .buttonStyle(.bordered)
          .controlSize(.small)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.surface, in: .rect(cornerRadius: 18, style: .continuous))
    .environment(\.picturesOpenFullScreen, false)
  }
}

/// A card in full over the call, which carries on underneath.
private struct CardSheet: View {
  @Environment(\.dismiss) private var dismiss
  let visual: Visual

  var body: some View {
    NavigationStack {
      ScrollView {
        CoachVisualView(visual: visual)
          .padding(16)
          .environment(\.picturesOpenFullScreen, false)
      }
      .background(Theme.background)
      .navigationTitle(visual.kind == "recipe" ? "Recipe" : "Card")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done", role: .confirm) { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
  }
}

private struct CallButton: View {
  let title: String
  let symbol: String
  var tint: Color?
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 6) {
        Image(systemName: symbol)
          .font(.title2)
          .foregroundStyle(tint == .red ? .white : .primary)
          .frame(width: 68, height: 68)
          .background(tint == .red ? Color.red : Color.clear, in: .circle)
          .glassEffect(tint == .red ? .regular.tint(.red).interactive() : .regular.interactive(), in: .circle)
        Text(title).font(.caption).foregroundStyle(.secondary)
      }
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }
}

private struct SaveChip: View {
  let label: String
  let state: VoiceCall.Line.SaveState

  var body: some View {
    Label {
      Text(state == .failed ? "\(label) not saved" : label)
    } icon: {
      switch state {
      case .saving: ProgressView().controlSize(.mini)
      case .saved: Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
      case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.attention)
      }
    }
    .font(.footnote.weight(.medium))
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .background(Theme.fill, in: .capsule)
    .frame(maxWidth: .infinity)
  }
}

/// A soft, moving shape in the theme's orb colours that grows with the voice
/// being heard.
struct VoiceOrb: View {
  let level: Float
  let active: Bool

  var body: some View {
    TimelineView(.animation(paused: !active)) { context in
      let t = context.date.timeIntervalSinceReferenceDate
      let scale = 1 + CGFloat(level) * 0.35
      ZStack {
        ForEach(0..<3) { layer in
          Circle()
            .fill(
              AngularGradient(
                colors: Theme.orb,
                center: .center, angle: .degrees(t * 40 + Double(layer) * 120))
            )
            .opacity(0.55 - Double(layer) * 0.12)
            .scaleEffect(scale * (1 - CGFloat(layer) * 0.12) + CGFloat(sin(t * 2 + Double(layer))) * 0.03)
            .blur(radius: 18 + CGFloat(layer) * 6)
        }
        Circle()
          .fill(.white.opacity(0.25))
          .frame(width: 80, height: 80)
          .scaleEffect(scale)
          .blur(radius: 10)
      }
      .frame(width: 180, height: 180)
      .animation(.easeOut(duration: 0.12), value: level)
    }
    .accessibilityHidden(true)
  }
}
