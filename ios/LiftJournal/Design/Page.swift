import LiftTheme
import SwiftUI

/// A hairline between rows, cells and sections of a page.
struct Hairline: View {
  var axis: Axis = .horizontal

  var body: some View {
    Rectangle()
      .fill(Theme.rule)
      .frame(width: axis == .vertical ? 1 : nil, height: axis == .horizontal ? 1 : nil)
      .accessibilityHidden(true)
  }
}

/// One thing in a list set on the page, in Movement, Train and the Journal:
/// a pigment key or a word in the left column ("Next"), the title in the
/// serif, an SF line of detail, where it came from, and an arrow when it
/// opens. Titles wrap; nothing is cut short.
struct EntryRow: View {
  enum Lead {
    case key(Color)
    case word(String)
  }

  let lead: Lead
  let title: String
  var meta: String?
  /// A second line of detail, such as where a run went.
  var note: String?
  /// Where it came from ("From Apple Health"), with the key of its area.
  var source: String?
  var sourceTint: Color?
  var opens = false
  @ScaledMetric(relativeTo: .footnote) private var wordColumn: CGFloat = 58

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 0) {
      switch lead {
      case .key(let tint):
        Key(tint: tint)
          .alignmentGuide(.firstTextBaseline) { $0[.bottom] }
          .frame(width: 24, alignment: .leading)
      case .word(let word):
        Text(word)
          .font(.footnote.weight(.semibold))
          .foregroundStyle(Theme.inkSecondary)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
          .frame(width: wordColumn, alignment: .leading)
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .folio(.heading)
          .foregroundStyle(Theme.ink)
          .multilineTextAlignment(.leading)
          .fixedSize(horizontal: false, vertical: true)
        if let meta, !meta.isEmpty {
          Text(meta).font(.subheadline).foregroundStyle(Theme.inkSecondary)
        }
        if let note {
          Text(note).font(.footnote).foregroundStyle(Theme.inkSecondary).lineLimit(2)
        }
        if let source {
          HStack(spacing: 5) {
            if let sourceTint { SmallKey(tint: sourceTint) }
            Text(source)
          }
          .font(.caption.weight(.medium))
          .foregroundStyle(Theme.inkSecondary)
          .padding(.top, 3)
        }
      }
      Spacer(minLength: 8)
      if opens { GoArrow() }
    }
    .padding(.vertical, 14)
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }
}

/// The 7 pt key beside a source line.
private struct SmallKey: View {
  let tint: Color
  @ScaledMetric(relativeTo: .caption) private var side: CGFloat = 7

  var body: some View {
    RoundedRectangle(cornerRadius: Theme.Radius.key / 2).fill(tint).frame(width: side, height: side)
      .accessibilityHidden(true)
  }
}

/// A note in the margin of a section: "Note" in the serif italic, the one
/// thing worth doing next, and an accent arrow, between two hairlines.
struct NoteRow: View {
  let title: String
  let detail: String
  @ScaledMetric(relativeTo: .body) private var column: CGFloat = 46

  var body: some View {
    HStack(spacing: 12) {
      Text("Note")
        .folio(.note)
        .foregroundStyle(Theme.ink)
        .frame(width: column, alignment: .leading)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
        Text(detail).font(.footnote).foregroundStyle(Theme.inkSecondary)
      }
      .multilineTextAlignment(.leading)
      Spacer(minLength: 8)
      GoArrow(tint: Theme.accent)
    }
    .padding(.vertical, 12)
    .overlay(alignment: .top) { Hairline() }
    .overlay(alignment: .bottom) { Hairline() }
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }
}

/// An action written into the page in place of a missing value ("Add in a
/// check-in"), in the accent with an arrow.
struct ActionText: View {
  let title: String

  init(_ title: String) { self.title = title }

  var body: some View {
    Text("\(title) \(Image(systemName: "arrow.right"))")
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(Theme.accent)
      .multilineTextAlignment(.leading)
  }
}

/// Four cells, or any number, in rows divided by a hairline cross. At the
/// largest text sizes they stack in one column.
struct CellGrid<Content: View>: View {
  var columns = 2
  @ViewBuilder var content: Content
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    Group(subviews: content) { cells in
      if typeSize >= .xxxLarge {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(cells.indices, id: \.self) { index in
            if index > 0 { Hairline() }
            cells[index].padding(.vertical, 14)
          }
        }
      } else {
        // Rows of equal columns, each row as tall as its tallest cell so
        // the hairline between them runs the full height.
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(stride(from: 0, to: cells.count, by: columns)), id: \.self) { start in
            if start > 0 { Hairline() }
            HStack(alignment: .top, spacing: 0) {
              ForEach(0..<columns, id: \.self) { column in
                if column > 0 { Hairline(axis: .vertical) }
                Group {
                  if start + column < cells.count {
                    cells[start + column]
                  } else {
                    Color.clear.frame(height: 0)
                  }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(.leading, column == 0 ? 0 : 16)
                .padding(.trailing, column == columns - 1 ? 0 : 16)
                .padding(.top, 14)
                .padding(.bottom, 16)
              }
            }
            .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
    }
  }
}

#Preview("Page") {
  ScrollView {
    VStack(alignment: .leading, spacing: 0) {
      FolioSection("Movement", meta: "4 this week")
      EntryRow(
        lead: .word("Done"), title: "Morning Run", meta: "34 min · 6.2 km · 151 bpm · 306 kcal",
        source: "From Apple Health", sourceTint: Theme.activity, opens: true)
      Hairline()
      EntryRow(
        lead: .word("Next"), title: "Snatch + Back Squat", meta: "Stability & Power Base · session 1 of 4",
        opens: true)
      Hairline()
      EntryRow(lead: .key(Theme.calories), title: "Greek yoghurt, granola and berries", meta: "Breakfast · 420 kcal")
      NoteRow(title: "Connect Apple Health", detail: "Sleep, heart rate and workouts, without typing")
        .padding(.top, 16)
      ActionText("Add in a check-in").padding(.top, 16)
    }
    .padding(20)
  }
  .background(Theme.background)
}
