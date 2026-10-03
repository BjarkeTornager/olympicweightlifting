import LiftAPI
import LiftTheme
import SwiftUI

/// The spoken check-in, full screen: the split mark, whose halves move with
/// whoever is talking, what Coach is asking, the conversation as it happens
/// with each save and card, and the call controls at the bottom.
struct VoiceCallView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let call: VoiceCall
  /// A card opened in full, or the camera: one at a time over the call.
  @State private var over = CallPresentation()
  @Environment(\.dynamicTypeSize) private var typeSize
  /// Saves line up with the words above them.
  @ScaledMetric(relativeTo: .caption) private var indent: CGFloat = TranscriptLine.indent

  var body: some View {
    // A card, or the largest text, needs the room more than the voice does.
    let small = call.cards > 0 || typeSize.isAccessibilitySize
    NavigationStack {
      VStack(spacing: 0) {
        SplitDiscOrb(
          pose: pose, speaking: call.status == .speaking, coachLevel: Double(call.coachLevel),
          micLevel: Double(call.micLevel), muted: call.muted
        )
        .frame(width: small ? 96 : 224, height: small ? 96 : 224)
        .animation(.smooth, value: small)
        .padding(.top, small ? 0 : 4)
        status
          .padding(.horizontal, Theme.Space.l)
          .padding(.top, small ? 6 : 14)
          // Large, but leaving the conversation room to show.
          .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        transcript
        controls.dynamicTypeSize(...DynamicTypeSize.xxxLarge)
      }
      .background(Theme.background)
      .navigationTitle("Voice check-in")
      .navigationBarTitleDisplayMode(.inline)
      // Nothing passes under the bar: it would otherwise take on its paper
      // and hairline once the transcript, below the voice, fills up.
      .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
      .toolbar {
        ToolbarItem(placement: .principal) { header }
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

  private var pose: SplitDiscOrb.Pose {
    switch call.status {
    case .idle, .connecting, .reconnecting: .connecting
    case .listening, .speaking: .live
    case .ended: .ended
    case .failed: .failed
    }
  }

  /// "Voice check-in · 3:12" while the call runs.
  private var header: some View {
    HStack(spacing: 0) {
      Text("Voice check-in").foregroundStyle(Theme.ink).kicker()
      if call.inCall, let start = call.connectedAt {
        TimelineView(.periodic(from: start, by: 1)) { context in
          let running = Duration.seconds(max(0, context.date.timeIntervalSince(start)))
          Text(" · " + running.formatted(.time(pattern: .minuteSecond)))
            .kicker()
            .monospacedDigit()
        }
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }

  // MARK: Status

  private var status: some View {
    VStack(spacing: 6) {
      if let kicker {
        Text(kicker)
          .foregroundStyle(call.status == .speaking ? Theme.accent : call.status == .failed ? Theme.danger : Theme.ink)
          .kicker()
          // It changes often (speaking, listening): cross-fading overlapped
          // the two labels.
          .contentTransition(.identity)
      }
      switch call.status {
      case .ended:
        Text(Self.ended(saved: call.saved, cards: call.cards))
          .font(.system(.title3, design: .serif))
          .italic()
          .foregroundStyle(Theme.ink)
      case .failed:
        Text(call.error ?? "The call could not continue.")
          .font(.subheadline)
          .foregroundStyle(Theme.inkSecondary)
      case .reconnecting:
        Text("The conversation carries on.").folio(.note).foregroundStyle(Theme.inkSecondary)
      default:
        if let question = Self.question(call.lines) {
          Text("\u{201C}\(question)\u{201D}")
            .font(.system(.title2, design: .serif))
            .italic()
            .foregroundStyle(Theme.ink)
            .lineLimit(3)
            .minimumScaleFactor(0.8)
        }
      }
      if !app.voiceOptions.isEmpty, call.status != .ended, call.status != .failed {
        let voice = call.provider.voiceName(in: app.voiceOptions) ?? "Voice"
        Text("\(voice), \(call.provider.title) · change the voice in Profile")
          .font(.footnote)
          .foregroundStyle(Theme.inkSecondary)
          .padding(.top, 2)
      }
    }
    .multilineTextAlignment(.center)
    .fixedSize(horizontal: false, vertical: true)
    .frame(maxWidth: .infinity)
  }

  private var kicker: String? {
    switch call.status {
    case .idle, .connecting: "Connecting"
    case .listening: call.muted ? "Muted" : "Listening"
    case .speaking: "Coach is speaking"
    case .reconnecting: "Reconnecting"
    case .ended: nil
    case .failed: "Call stopped"
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

  /// What Coach last asked: the last question in its latest line, if it
  /// ended its turn on one.
  static func question(_ lines: [VoiceCall.Line]) -> String? {
    guard let last = lines.last(where: { $0.role == .coach }) else { return nil }
    var sentences: [String] = []
    last.text.enumerateSubstrings(in: last.text.startIndex..., options: .bySentences) { sentence, _, _, _ in
      if let sentence { sentences.append(sentence.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }
    return sentences.last { $0.hasSuffix("?") }
  }

  // MARK: Transcript

  private var transcript: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(TranscriptRow.rows(call.lines)) { row in
            switch row {
            case .spoken(let line):
              TranscriptLine(coach: line.role == .coach, text: line.text)
            case .saves(let lines):
              FlowLayout(spacing: 6, lineSpacing: 6) {
                ForEach(lines) { SaveChip(label: $0.text, state: $0.state ?? .saving) }
              }
              .padding(.leading, typeSize.isAccessibilitySize ? 0 : indent)
              .padding(.bottom, 10)
            case .card(let line):
              if let visual = line.visual {
                VoiceCard(visual: visual) { over.expand(line) }
                  .padding(.vertical, 8)
              }
            }
          }
        }
        .padding(.horizontal, Theme.Space.gutter)
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

  // MARK: Controls

  @ViewBuilder
  private var controls: some View {
    if call.inCall {
      HStack(spacing: 30) {
        CallButton(
          title: call.muted ? "Unmute" : "Mute", symbol: call.muted ? "mic.slash.fill" : "mic",
          kind: call.muted ? .on : .plain
        ) {
          call.muted.toggle()
        }
        .sensoryFeedback(.selection, trigger: call.muted)
        CallButton(title: "Camera", symbol: "camera") { call.cameraRequested = true }
        CallButton(title: "End", symbol: "phone.down.fill", kind: .end) {
          call.stop()
        }
      }
      .padding(.vertical, 20)
    } else if call.status == .failed {
      Button("Try Again") { Task { await call.start() } }
        .buttonStyle(PrimaryButtonStyle())
        .padding(.horizontal, Theme.Space.gutter)
        .padding(.vertical, 20)
    }
  }
}

/// The call's lines as they are shown: what was said, the saves after it
/// gathered in one row of chips, and the cards.
enum TranscriptRow: Identifiable, Equatable {
  case spoken(VoiceCall.Line)
  case saves([VoiceCall.Line])
  case card(VoiceCall.Line)

  var id: String {
    switch self {
    case .spoken(let line), .card(let line): line.id
    case .saves(let lines): lines.first?.id ?? ""
    }
  }

  static func rows(_ lines: [VoiceCall.Line]) -> [TranscriptRow] {
    var rows: [TranscriptRow] = []
    for line in lines {
      switch line.role {
      case .you, .coach: rows.append(.spoken(line))
      case .card: rows.append(.card(line))
      case .save:
        if case .saves(let saves) = rows.last {
          rows[rows.count - 1] = .saves(saves + [line])
        } else {
          rows.append(.saves([line]))
        }
      }
    }
    return rows
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
      CoachVisualView(visual: visual, compact: true, tint: VisualTint.topic(visuals: [visual])?.tint)
      if let more = CoachVisualView.more(visual) {
        Button(more, action: expand)
          .buttonStyle(SecondaryButtonStyle())
      }
    }
    .card(padding: 14)
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
        CoachVisualView(visual: visual, tint: VisualTint.topic(visuals: [visual])?.tint)
          .padding(Theme.Space.gutter)
          .environment(\.picturesOpenFullScreen, false)
      }
      .background(Theme.surface)
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

/// A 68 pt round call control: glass with an ink symbol, ink when switched
/// on (muted), or filled with the danger colour to end the call.
private struct CallButton: View {
  enum Kind { case plain, on, end }
  let title: String
  let symbol: String
  var kind = Kind.plain
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      VStack(spacing: 7) {
        Image(systemName: symbol)
          .font(.title2.weight(kind == .end ? .semibold : .regular))
          .foregroundStyle(kind == .plain ? Theme.ink : Theme.surface)
          .frame(width: 68, height: 68)
          .background {
            switch kind {
            case .plain: Color.clear
            case .on: Circle().fill(Theme.ink)
            case .end:
              Circle().fill(Theme.danger).shadow(color: Theme.danger.opacity(0.35), radius: 12, y: 8)
            }
          }
          .glassEffect(kind == .plain ? .regular.interactive() : .identity, in: .circle)
        Text(title).font(.caption.weight(.semibold)).foregroundStyle(Theme.inkSecondary)
      }
    }
    .buttonStyle(.plain)
    .accessibilityLabel(title)
  }
}

/// A save during the call: its area's key, a check once saved, on fill.
private struct SaveChip: View {
  let label: String
  let state: VoiceCall.Line.SaveState

  var body: some View {
    HStack(spacing: 6) {
      if let topic = VisualTint.topic(label) {
        Key(tint: topic.tint)
      }
      switch state {
      case .saving: ProgressView().controlSize(.mini)
      case .saved: Image(systemName: "checkmark").fontWeight(.bold)
      case .failed: Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.danger)
      }
      Text(state == .failed ? "\(label) not saved" : label)
    }
    .font(.footnote.weight(.semibold))
    .foregroundStyle(Theme.ink)
    .padding(.horizontal, 10)
    .frame(minHeight: 28)
    .background(Theme.fill, in: .capsule)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(
      state == .saving ? "Saving \(label)" : state == .saved ? "\(label) saved" : "\(label) not saved")
  }
}

/// The voice call's mark: Coach's half on the left, yours on the right, as
/// in the icon. The speaking half rises with its own voice, the gutter
/// opens, and echo arcs open on its side, so it's clear whose turn it is.
/// Connecting, the halves sit close and rock slowly, never frozen; muted,
/// your half is an outline; when the call ends they close into one disc.
/// Under Reduce Motion each pose is still and nothing rises with the voice.
struct SplitDiscOrb: View {
  enum Pose: Equatable { case connecting, live, ended, failed }
  let pose: Pose
  /// Coach is talking, for the still pose under Reduce Motion.
  var speaking = false
  /// Each from 0 to 1.
  var coachLevel: Double = 0
  var micLevel: Double = 0
  var muted = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  /// The halves' place in mark units, where the mark is 716 across.
  struct Placement: Equatable {
    var gap: CGFloat = 40
    var lift: CGFloat = 136
    var coachRise: CGFloat = 0
    var youRise: CGFloat = 0
    var opacity: Double = 1
    /// The side whose echoes show, and how strongly, from 0 to 1.
    var echo: MarkHalf.Part?
    var echoStrength: Double = 0
  }

  var placement: Placement {
    switch pose {
    case .connecting: return Placement(gap: 14, lift: 24, opacity: 0.55)
    case .ended: return Placement(gap: 0, lift: 0)
    case .failed: return Placement(opacity: 0.35)
    case .live:
      if reduceMotion {
        return speaking ? Placement(gap: 60, coachRise: 64, echo: .coach, echoStrength: 1) : Placement()
      }
      let coach = min(1, max(0, coachLevel))
      let mic = min(1, max(0, micLevel))
      let louder: MarkHalf.Part = coach >= mic ? .coach : .you
      let level = max(coach, mic)
      return Placement(
        gap: 40 + 24 * level, coachRise: 96 * coach, youRise: 96 * mic,
        echo: level > 0.06 ? louder : nil, echoStrength: min(1, level * 2.5))
    }
  }

  var body: some View {
    TimelineView(.animation(paused: pose != .connecting || reduceMotion)) { context in
      // One slow rock every four seconds while connecting.
      let rock = pose == .connecting && !reduceMotion
        ? sin(context.date.timeIntervalSinceReferenceDate * .pi / 2) : 0
      GeometryReader { proxy in
        let unit = min(proxy.size.width, proxy.size.height) / 944
        mark(placement, unit: unit)
          .frame(width: 716 * unit, height: 716 * unit)
          .rotationEffect(.degrees(rock * 4))
          .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
      }
    }
    .aspectRatio(1, contentMode: .fit)
    .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: placement)
    .accessibilityHidden(true)
  }

  private func mark(_ shape: Placement, unit: CGFloat) -> some View {
    ZStack {
      if let side = shape.echo {
        ForEach([1, 2], id: \.self) { n in
          MarkHalf(
            side, gap: shape.gap, lift: shape.lift, rise: side == .coach ? shape.coachRise : shape.youRise,
            spread: CGFloat(n) * 46
          )
          .stroke(side == .coach ? Theme.markCoach : Theme.markYou, lineWidth: 9 * unit)
          .opacity((0.5 - Double(n) * 0.17) * shape.echoStrength)
        }
      }
      MarkHalf(.coach, gap: shape.gap, lift: shape.lift, rise: shape.coachRise)
        .fill(Theme.markCoach)
      if muted && pose == .live {
        MarkHalf(.you, gap: shape.gap, lift: shape.lift, rise: shape.youRise)
          .stroke(Theme.markYou.opacity(0.7), lineWidth: 10 * unit)
      } else {
        MarkHalf(.you, gap: shape.gap, lift: shape.lift, rise: shape.youRise)
          .fill(Theme.markYou)
      }
    }
    .opacity(shape.opacity)
  }
}

#if DEBUG
  /// The orb's five poses, as the states board draws them.
  struct OrbStatesPreview: View {
    var body: some View {
      let states: [(String, SplitDiscOrb)] = [
        ("Connecting", SplitDiscOrb(pose: .connecting)),
        ("You are speaking", SplitDiscOrb(pose: .live, micLevel: 0.8)),
        ("Coach is speaking", SplitDiscOrb(pose: .live, speaking: true, coachLevel: 0.8)),
        ("Muted", SplitDiscOrb(pose: .live, muted: true)),
        ("Call ended", SplitDiscOrb(pose: .ended)),
      ]
      ScrollView {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 20)], spacing: 28) {
          ForEach(states, id: \.0) { title, orb in
            VStack(spacing: 10) {
              orb.frame(width: 150, height: 150)
              Text(title).folio(.note).foregroundStyle(Theme.ink)
            }
          }
        }
        .padding(20)
      }
      .background(Theme.background)
    }
  }

  /// A call with Coach speaking, two saves, and Coach's reply.
  struct VoiceCallPreview: View {
    var status = VoiceCall.Status.speaking
    var muted = false

    var body: some View {
      VoiceCallView(
        call: .staged(
          status, lines: PreviewData.callLines, coachLevel: status == .speaking ? 0.7 : 0, muted: muted)
      )
      .environment(AppModel())
    }
  }

  #Preview("Orb states") { OrbStatesPreview() }
  #Preview("Orb states, dark") { OrbStatesPreview().preferredColorScheme(.dark) }
  #Preview("Orb states, AX3") { OrbStatesPreview().dynamicTypeSize(.accessibility3) }
  #Preview("Voice call") { VoiceCallPreview() }
  #Preview("Voice call, dark") { VoiceCallPreview().preferredColorScheme(.dark) }
  #Preview("Voice call, AX3") { VoiceCallPreview().dynamicTypeSize(.accessibility3) }
  #Preview("Voice call, ended") { VoiceCallPreview(status: .ended) }
#endif
