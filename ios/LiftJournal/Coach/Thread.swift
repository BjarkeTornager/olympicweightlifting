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
  var voice = false

  var body: some View {
    VStack(alignment: .trailing, spacing: 3) {
      if !photoIDs.isEmpty || !previews.isEmpty {
        MessageRow(speaker: .athlete) { PhotoTiles(ids: photoIDs, previews: previews) }
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

/// Photos in the thread: one large, or up to four in a square grid.
struct PhotoTiles: View {
  let ids: [String]
  var previews: [UIImage] = []
  @State private var viewing: String?

  var body: some View {
    let count = ids.count + previews.count
    let side: CGFloat = count == 1 ? 210 : 118
    LazyVGrid(
      columns: Array(repeating: GridItem(.fixed(side), spacing: 4), count: count == 1 ? 1 : 2),
      alignment: .trailing, spacing: 4
    ) {
      ForEach(ids, id: \.self) { id in
        Button {
          viewing = id
        } label: {
          PrivateImage(id: id)
            .frame(width: side, height: side)
            .clipShape(.rect(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Photo you sent")
      }
      ForEach(Array(previews.enumerated()), id: \.offset) { _, image in
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
          .frame(width: side, height: side)
          .clipShape(.rect(cornerRadius: 18, style: .continuous))
          .opacity(0.8)
      }
    }
    .fixedSize()
    .fullScreenCover(item: Binding(get: { viewing.map(PhotoID.init) }, set: { viewing = $0?.id })) { photo in
      PhotoViewer(id: photo.id)
    }
  }

  struct PhotoID: Identifiable {
    let id: String
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
