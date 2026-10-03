import LiftAPI
import LiftTheme
import SwiftUI

// The Coach conversation, set as correspondence rather than chat bubbles:
// the athlete's words in a crisp ink capsule on the right, and Coach's
// replies as letters, with a byline and a margin rule in the colour of
// what the reply is about.

/// What the athlete sent: photos first, then the words in an ink capsule.
/// A message still in the queue (waiting its turn, or not sent) is drawn as
/// the capsule's dashed outline, as it hasn't reached Coach yet.
struct SentMessage: View {
  let text: String
  var photoIDs: [String] = []
  var previews: [UIImage] = []
  /// What VoiceOver calls a photo not yet saved in the thread.
  var previewLabel = "Photo you sent"
  var voice = false
  var queued = false
  @ScaledMetric(relativeTo: .body) private var widest: CGFloat = 280

  var body: some View {
    VStack(alignment: .trailing, spacing: 4) {
      if !photoIDs.isEmpty || !previews.isEmpty {
        PhotoTiles(ids: photoIDs, previews: previews, previewLabel: previewLabel)
      }
      if !text.isEmpty {
        Text(CoachReplyFormat.attributed(text))
          .font(.body)
          .foregroundStyle(queued ? Theme.ink : Theme.background)
          .tint(queued ? Theme.accent : Theme.background)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.horizontal, 17)
          .padding(.vertical, 11)
          .background {
            if queued {
              Self.shape.strokeBorder(Theme.inkSecondary, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            } else {
              Self.shape.fill(Theme.ink)
            }
          }
          .frame(maxWidth: widest, alignment: .trailing)
      }
      if voice {
        Label("Spoken", systemImage: "waveform")
          .font(.caption2.weight(.medium))
          .foregroundStyle(Theme.inkSecondary)
      }
    }
    .padding(.leading, 48)
    .frame(maxWidth: .infinity, alignment: .trailing)
  }

  /// Round, with a small tail at the bottom on the speaker's side.
  static let shape = UnevenRoundedRectangle(
    topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22,
    style: .continuous)
}

/// A message waiting for Coach to finish the one before, or one that
/// couldn't be sent: it waits there, with Retry, Edit and Remove, and the
/// messages after it wait too.
struct QueuedMessage: View {
  @Environment(AppModel.self) private var app
  let item: CoachModel.Outgoing
  let coach: CoachModel

  var body: some View {
    VStack(alignment: .trailing, spacing: 6) {
      SentMessage(
        text: item.text, previews: item.photos.map(\.preview),
        previewLabel: item.failure == nil ? "Photo waiting to send" : "Photo not sent", queued: true)
      if let failure = item.failure {
        Label {
          Text(failure).foregroundStyle(Theme.inkSecondary)
        } icon: {
          Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.danger)
        }
        .font(.footnote)
        .multilineTextAlignment(.trailing)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.leading, 48)
        // Edit needs the text field: a message that can only be edited
        // says how to free it.
        if item.expired && coach.hasDraft {
          Text("Empty the text field to edit it.")
            .font(.footnote)
            .foregroundStyle(Theme.inkSecondary)
        }
        // In a row while they fit, otherwise one under another.
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 8) { actions }
          VStack(alignment: .trailing, spacing: 8) { actions }
        }
      } else {
        // On one line while it fits, otherwise Remove under the status.
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 4) { waiting }
          VStack(alignment: .trailing, spacing: 0) { waiting }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .accessibilityElement(children: .contain)
  }

  @ViewBuilder
  private var waiting: some View {
    Label(status, systemImage: "clock")
      .font(.footnote)
      .foregroundStyle(Theme.inkSecondary)
      .multilineTextAlignment(.trailing)
    Button {
      coach.remove(item.id, app: app)
    } label: {
      Text("Remove")
        .font(.footnote.weight(.semibold))
        .padding(.horizontal, 6)
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(.rect)
    }
    .buttonStyle(.borderless)
    .tint(Theme.accent)
    .accessibilityLabel("Remove message")
    .accessibilityHint(item.summary)
  }

  @ViewBuilder
  private var actions: some View {
    Button("Remove", role: .destructive) { coach.remove(item.id, app: app) }
      .buttonStyle(SecondaryButtonStyle())
      .accessibilityLabel("Remove message")
      .accessibilityHint(item.summary)
    if !coach.hasDraft {
      Button("Edit") { coach.edit(item.id, app: app) }
        .buttonStyle(SecondaryButtonStyle())
        .accessibilityLabel("Edit message")
        .accessibilityHint(item.summary)
    } else if item.expired {
      Button("Edit") {}
        .buttonStyle(SecondaryButtonStyle())
        .disabled(true)
        .accessibilityLabel("Edit message")
        .accessibilityHint(item.summary)
    }
    // A message that waited over a day can only be edited or removed.
    if !item.expired {
      Button("Retry") { coach.retry(item.id, app: app) }
        .buttonStyle(PrimaryButtonStyle(height: 44, fullWidth: false))
        .accessibilityLabel("Retry sending")
        .accessibilityHint(item.summary)
    }
  }

  private var status: String {
    if coach.heldForEdit { return "Waits for your edit" }
    // A message ahead of this one failed: this waits until that's sorted.
    if coach.queue.prefix(while: { $0.id != item.id }).contains(where: { $0.failure != nil }) {
      return "Waits for the message above"
    }
    return "Waiting for Coach"
  }
}

/// Photos in the thread: one large, or up to four in a square grid.
struct PhotoTiles: View {
  let ids: [String]
  var previews: [UIImage] = []
  var previewLabel = "Photo you sent"
  @State private var viewing: String?

  var body: some View {
    let count = ids.count + previews.count
    let side: CGFloat = count == 1 ? 210 : 118
    // A plain grid of fixed-size tiles: at most four, so nothing lazy to
    // measure inside the thread's own lazy list.
    Grid(horizontalSpacing: 4, verticalSpacing: 4) {
      ForEach(rows(count: count), id: \.self) { row in
        GridRow {
          ForEach(row, id: \.self) { index in
            tile(index, side: side)
          }
        }
      }
    }
    .fullScreenCover(item: Binding(get: { viewing.map(PhotoID.init) }, set: { viewing = $0?.id })) { photo in
      PhotoViewer(id: photo.id)
    }
  }

  struct PhotoID: Identifiable {
    let id: String
  }

  /// Tile indexes in rows: one on its own, otherwise two to a row.
  private func rows(count: Int) -> [[Int]] {
    let perRow = count == 1 ? 1 : 2
    return stride(from: 0, to: count, by: perRow).map { Array($0..<min($0 + perRow, count)) }
  }

  /// Saved photos first, then photos still being sent.
  @ViewBuilder
  private func tile(_ index: Int, side: CGFloat) -> some View {
    if index < ids.count {
      let id = ids[index]
      Button {
        viewing = id
      } label: {
        PrivateImage(id: id)
          .frame(width: side, height: side)
          .clipShape(.rect(cornerRadius: Theme.Radius.sheet, style: .continuous))
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Photo you sent")
    } else {
      Image(uiImage: previews[index - ids.count])
        .resizable()
        .scaledToFill()
        .frame(width: side, height: side)
        .clipShape(.rect(cornerRadius: Theme.Radius.sheet, style: .continuous))
        .opacity(0.8)
        .accessibilityLabel(previewLabel)
    }
  }
}

/// One photo on black, dismissed with Done or a swipe down.
private struct PhotoViewer: View {
  @Environment(\.dismiss) private var dismiss
  let id: String

  var body: some View {
    NavigationStack {
      PrivateImage(id: id)
        .aspectRatio(contentMode: .fit)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.black)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) { Button("Done", role: .confirm) { dismiss() } }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
    }
  }
}

/// The head of Coach's letter: the mark, "Coach" in the accent, and what the
/// reply is about with its key ("■ Sleep"), in sentence case, as it heads
/// every reply. VoiceOver reads it as a heading,
/// so replies can be skipped through.
struct CoachByline: View {
  var topic: Category?
  @ScaledMetric(relativeTo: .caption) private var mark: CGFloat = 18

  var body: some View {
    // The topic moves to a line of its own when it doesn't fit beside.
    FlowLayout(spacing: 8, lineSpacing: 6) {
      HStack(spacing: 8) {
        BrandMark().frame(width: mark, height: mark)
        Text("Coach").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent).fixedSize()
      }
      if let topic {
        HStack(spacing: 6) {
          Key(tint: topic.tint)
          Text(topic.name).label().fixedSize()
        }
        .padding(.leading, 8)
        .padding(.trailing, 10)
        .padding(.vertical, 4)
        .background(Theme.fill, in: .capsule)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(topic.map { "Coach, \($0.name)" } ?? "Coach")
    .accessibilityAddTraits(.isHeader)
  }
}

/// Coach's reply as a letter: the byline, then the reply in New York behind
/// a 2 pt margin rule in the colour of its topic (ultramarine when it has
/// none), with its figures and receipts inside the same margin.
struct CoachLetter<Content: View>: View {
  var topic: Category?
  @ViewBuilder var content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      CoachByline(topic: topic)
      VStack(alignment: .leading, spacing: 16) { content }
        .padding(.leading, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) {
          Rectangle()
            .fill(topic?.tint ?? Theme.accent)
            .frame(width: 2)
            .accessibilityHidden(true)
        }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// Coach is writing: a moving ellipsis in the letter's margin, and what it
/// is doing in serif italic ("Reading your journal").
struct CoachWriting: View {
  let step: String?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      Image(systemName: "ellipsis")
        .font(.title3.weight(.bold))
        .foregroundStyle(Theme.inkSecondary)
        .symbolEffect(.variableColor.iterative.dimInactiveLayers, options: .repeating, isActive: !reduceMotion)
      if let step {
        Text(step).folio(.note).foregroundStyle(Theme.inkSecondary)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(step.map { "Coach is replying: \($0)" } ?? "Coach is replying")
  }
}

/// One spoken line of a call, in the thread and on the call screen, below
/// a hairline: who, then what was said, yours in SF and
/// Coach's in the serif. At the largest text sizes who stands above the
/// words.
struct TranscriptLine: View {
  let coach: Bool
  let text: String
  @Environment(\.dynamicTypeSize) private var typeSize
  /// The column the names stand in, at the default text size.
  static let indent: CGFloat = 66
  @ScaledMetric(relativeTo: .caption) private var column: CGFloat = TranscriptLine.indent

  var body: some View {
    let stacked = typeSize.isAccessibilitySize
    let language = LineBreaks.language(of: text)
    let layout =
      stacked
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
      : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
    layout {
      Text(coach ? "Coach" : "You")
        .foregroundStyle(coach ? Theme.accent : Theme.inkSecondary)
        .label()
        .frame(width: stacked ? nil : column - 8, alignment: .leading)
      Text(CoachReplyFormat.attributed(words(language)))
        .font(coach ? .system(.body, design: .serif) : .callout)
        .foregroundStyle(Theme.ink)
        .typesettingLanguage(language.typesetting)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        // What was said, not how it is typeset.
        .contextMenu {
          let plain = CoachReplyFormat.plain(text)
          Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = plain }
          ShareLink(item: plain)
        }
    }
    .padding(.vertical, 10)
    .overlay(alignment: .top) { Rectangle().fill(Theme.rule).frame(height: 1) }
    .accessibilityElement(children: .combine)
  }

  /// What was said, with its line breaks set (`LineBreaks.paragraph`).
  private func words(_ language: LineBreaks.Language) -> String {
    LineBreaks.paragraph(text, language: language, size: typeSize)
  }
}

#if DEBUG
  /// A thread as Coach shows it: a sent message, a letter about sleep with
  /// its figure, a recipe with its picture, and the queue's two states.
  struct CoachThreadPreview: View {
    init() {
      CoachPicture.cache.setObject(PreviewData.dishPicture, forKey: PreviewData.pictureID as NSString)
    }

    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          SentMessage(text: "How did I sleep this week?")
          CoachLetter(topic: .sleep) {
            CoachText(
              text:
                "You logged sleep on all 7 nights this week, averaging **7 h 12 min** from 26 September to 2 October.")
            CoachVisualView(visual: PreviewData.sleepFigure, number: 1, tint: Theme.sleep).card(padding: 14)
            CoachText(
              text:
                "Your longest night was **8 h 6 min** on 28 September. The shortest was **6 h 12 min** on 30 September.")
          }
          SentMessage(text: "Something with salmon for dinner?")
          CoachLetter(topic: .food) {
            CoachText(text: "A quick bowl that keeps protein high. The picture is drawn for the card.")
            CoachVisualView(visual: PreviewData.recipe, tint: Theme.calories).card(padding: 14)
          }
          QueuedPreview()
        }
        .padding(20)
      }
      .background(Theme.background)
      .environment(AppModel())
    }
  }

  /// A message that couldn't be sent, and one waiting behind it.
  struct QueuedPreview: View {
    @State private var coach = PreviewData.queuedCoach()

    var body: some View {
      VStack(spacing: 18) {
        ForEach(coach.waiting) { QueuedMessage(item: $0, coach: coach) }
      }
      .environment(AppModel())
    }
  }

  #Preview("Coach letter") { CoachThreadPreview() }
  #Preview("Coach letter, dark") { CoachThreadPreview().preferredColorScheme(.dark) }
  #Preview("Coach letter, AX3") { CoachThreadPreview().dynamicTypeSize(.accessibility3) }
  #Preview("Queue") { QueuedPreview().padding(20).background(Theme.background) }
  #Preview("Queue, dark") { QueuedPreview().padding(20).background(Theme.background).preferredColorScheme(.dark) }
  #Preview("Queue, AX3") { QueuedPreview().padding(20).background(Theme.background).dynamicTypeSize(.accessibility3) }
#endif
