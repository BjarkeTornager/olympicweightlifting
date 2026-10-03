import LiftAPI
import LiftTheme
import SwiftUI

/// The Coach conversation as a text thread with a human coach, in the style
/// of Messages: the athlete's texts and photos on the right in the accent
/// colour, the coach's on the left on white, one bubble per paragraph, with the coach's
/// avatar beside the last text of each reply.
enum Speaker {
  case athlete, coach
}

/// One text. The last in a run gets a tighter corner on the speaker's side.
struct MessageBubble<Content: View>: View {
  let speaker: Speaker
  var last = true
  @ViewBuilder var content: Content

  var body: some View {
    content
      .foregroundStyle(speaker == .athlete ? Theme.onAccent : Color.primary)
      .tint(speaker == .athlete ? Theme.onAccent : Theme.accent)
      .padding(.horizontal, 13)
      .padding(.vertical, 8)
      .background(speaker == .athlete ? Theme.accent : Theme.surface, in: shape)
  }

  private var shape: UnevenRoundedRectangle {
    let tail: CGFloat = last ? 5 : 18
    return speaker == .athlete
      ? UnevenRoundedRectangle(
        topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: tail, topTrailingRadius: 18,
        style: .continuous)
      : UnevenRoundedRectangle(
        topLeadingRadius: 18, bottomLeadingRadius: tail, bottomTrailingRadius: 18, topTrailingRadius: 18,
        style: .continuous)
  }
}

/// A row in the thread: the athlete's on the right, the coach's on the left
/// beside the avatar's column.
struct MessageRow<Content: View>: View {
  let speaker: Speaker
  var avatar = false
  @ViewBuilder var content: Content

  var body: some View {
    HStack(alignment: .bottom, spacing: 6) {
      if speaker == .athlete {
        Spacer(minLength: 56)
      } else {
        CoachAvatar().opacity(avatar ? 1 : 0)
      }
      content
      if speaker == .coach { Spacer(minLength: 40) }
    }
  }
}

struct CoachAvatar: View {
  var body: some View {
    Image("tab-coach-fill")
      .renderingMode(.template)
      .resizable()
      .scaledToFit()
      .frame(width: 16, height: 16)
      .foregroundStyle(Theme.onAccent)
      .frame(width: 28, height: 28)
      .background(Theme.accent, in: .circle)
      .accessibilityHidden(true)
  }
}

/// What the athlete sent: photos first, then the text, as Messages shows it.
struct SentMessage: View {
  let text: String
  var photoIDs: [String] = []
  var previews: [UIImage] = []
  /// What VoiceOver calls a photo not yet saved in the thread.
  var previewLabel = "Photo you sent"
  var voice = false

  var body: some View {
    VStack(alignment: .trailing, spacing: 3) {
      if !photoIDs.isEmpty || !previews.isEmpty {
        MessageRow(speaker: .athlete) {
          PhotoTiles(ids: photoIDs, previews: previews, previewLabel: previewLabel)
        }
      }
      if !text.isEmpty {
        MessageRow(speaker: .athlete) {
          MessageBubble(speaker: .athlete) {
            Text(CoachReplyFormat.attributed(text)).textSelection(.enabled)
          }
        }
      }
      if voice {
        Label("Spoken", systemImage: "waveform")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
  }
}

/// A message waiting for Coach to finish the one before, or one that
/// couldn't be sent: it waits there, with Retry, Edit and Remove, and the
/// messages after it wait too.
struct QueuedMessage: View {
  @Environment(AppModel.self) private var app
  let item: CoachModel.Outgoing
  let coach: CoachModel

  var body: some View {
    VStack(alignment: .trailing, spacing: 2) {
      SentMessage(
        text: item.text, previews: item.photos.map(\.preview),
        previewLabel: item.failure == nil ? "Photo waiting to send" : "Photo not sent")
      if let failure = item.failure {
        Label(failure, systemImage: "exclamationmark.circle")
          .font(.caption)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.trailing)
          .padding(.top, 2)
        // Edit needs the text field: a message that can only be edited
        // says how to free it.
        if item.expired && coach.hasDraft {
          Text("Empty the text field to edit it.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 4) {
          action("Remove", label: "Remove message", role: .destructive) { coach.remove(item.id, app: app) }
          if !coach.hasDraft {
            action("Edit", label: "Edit message") { coach.edit(item.id, app: app) }
          } else if item.expired {
            action("Edit", label: "Edit message") {}
              .disabled(true)
          }
          // A message that waited over a day can only be edited or removed.
          if !item.expired {
            action("Retry", label: "Retry sending") { coach.retry(item.id, app: app) }
              .fontWeight(.semibold)
          }
        }
        .font(.footnote)
      } else {
        HStack(spacing: 4) {
          Label(status, systemImage: "clock")
            .font(.caption)
            .foregroundStyle(.secondary)
          action("Remove", label: "Remove message") { coach.remove(item.id, app: app) }
            .font(.caption)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .padding(.top, 4)
    .accessibilityElement(children: .contain)
  }

  /// A small text button with a full-size target, named for VoiceOver
  /// with the message it acts on.
  private func action(
    _ title: String, label: String, role: ButtonRole? = nil, perform: @escaping () -> Void
  ) -> some View {
    Button(role: role, action: perform) {
      Text(title)
        .padding(.horizontal, 6)
        .frame(minWidth: 44, minHeight: 44)
        .contentShape(.rect)
    }
    .buttonStyle(.borderless)
    .accessibilityLabel(label)
    .accessibilityHint(item.summary)
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
          .clipShape(.rect(cornerRadius: 18, style: .continuous))
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Photo you sent")
    } else {
      Image(uiImage: previews[index - ids.count])
        .resizable()
        .scaledToFill()
        .frame(width: side, height: side)
        .clipShape(.rect(cornerRadius: 18, style: .continuous))
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

/// Coach's reply as a run of texts: each paragraph, list or quote its own
/// bubble, a table as a card, the avatar beside the last one.
struct CoachMessages: View {
  let text: String

  var body: some View {
    let parts = Self.split(text)
    VStack(alignment: .leading, spacing: 3) {
      ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
        let last = index == parts.count - 1
        MessageRow(speaker: .coach, avatar: last) {
          if case .table(let header, let rows) = part {
            DataTable(columns: header, rows: rows)
          } else {
            MessageBubble(speaker: .coach, last: last) {
              MarkdownBlocksView(blocks: [part]).textSelection(.enabled)
            }
          }
        }
      }
    }
  }

  /// Headings join the text they introduce, so no bubble holds only a title.
  static func split(_ text: String) -> [MarkdownBlock] {
    var parts: [MarkdownBlock] = []
    var heading: String?
    for block in MarkdownBlock.parse(text) {
      switch block {
      case .heading(let title):
        heading = [heading, "**\(title)**"].compactMap { $0 }.joined(separator: "\n")
      case .paragraph(let body) where heading != nil:
        parts.append(.paragraph(heading! + "\n" + body))
        heading = nil
      default:
        if let title = heading { parts.append(.paragraph(title)) }
        heading = nil
        parts.append(block)
      }
    }
    if let title = heading { parts.append(.paragraph(title)) }
    return parts
  }
}

/// Coach is typing: three dots in a grey bubble, and what it is doing.
struct TypingBubble: View {
  let step: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      MessageRow(speaker: .coach, avatar: true) {
        MessageBubble(speaker: .coach) {
          Image(systemName: "ellipsis")
            .font(.title3.weight(.bold))
            .symbolEffect(.variableColor.iterative.dimInactiveLayers, options: .repeating)
            .foregroundStyle(.secondary)
            .padding(.vertical, 4)
        }
      }
      if let step {
        Text(step).font(.caption).foregroundStyle(.secondary).padding(.leading, 40)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Coach is replying")
  }
}

/// A single text, as used by the voice call's transcript.
struct Bubble: View {
  let text: String
  let mine: Bool

  var body: some View {
    MessageRow(speaker: mine ? .athlete : .coach, avatar: !mine) {
      MessageBubble(speaker: mine ? .athlete : .coach) {
        Text(CoachReplyFormat.attributed(text))
      }
    }
  }
}
