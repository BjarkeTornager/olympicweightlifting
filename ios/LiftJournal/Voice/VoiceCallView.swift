import SwiftUI

/// The spoken check-in, full screen: a voice that moves with whoever is
/// talking, the conversation as it happens with each save, and the call
/// controls at the bottom.
struct VoiceCallView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let call: VoiceCall

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        VoiceOrb(level: call.level, active: call.status == .speaking || call.status == .listening)
          .opacity(call.inCall ? 1 : 0.35)
          .animation(.easeInOut, value: call.inCall)
          .frame(height: 220)
          .padding(.top, 12)
        Text(statusText)
          .font(.headline)
          .foregroundStyle(call.status == .failed ? .red : .secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal)
          .contentTransition(.opacity)
          .animation(.default, value: call.status)
        transcript
        controls
      }
      .navigationTitle("Voice Check-In")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          if !call.inCall {
            Button("Done", role: .confirm) { dismiss() }
          }
        }
      }
      .fullScreenCover(isPresented: Binding(get: { call.cameraRequested }, set: { call.cameraRequested = $0 })) {
        CameraPicker { image in Task { await call.photoTaken(image) } }.ignoresSafeArea()
      }
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
    case .ended:
      call.saved > 0
        ? "Call ended · \(call.saved) saved. Everything is in Coach, with Undo."
        : "Call ended."
    case .failed: call.error ?? "The call could not continue."
    }
  }

  private var transcript: some View {
    ScrollView {
      LazyVStack(spacing: 8) {
        ForEach(call.lines) { line in
          switch line.role {
          case .you:
            Bubble(text: line.text, mine: true)
          case .coach:
            Bubble(text: line.text, mine: false)
          case .save:
            SaveChip(label: line.text, state: line.state ?? .saving)
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
    }
    .defaultScrollAnchor(.bottom)
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
        .controlSize(.large)
        .padding(.vertical, 20)
    }
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
      case .saved: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
      case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.orange)
      }
    }
    .font(.footnote.weight(.medium))
    .padding(.horizontal, 12)
    .padding(.vertical, 6)
    .background(Color(.secondarySystemFill), in: .capsule)
    .frame(maxWidth: .infinity)
  }
}

/// A soft, moving shape that grows with the voice being heard.
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
                colors: [.indigo, .purple, .pink, .blue, .indigo],
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
