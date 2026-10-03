import LiftTheme
import SwiftUI

/// Coach's replies are Markdown. This renders the same subset the website
/// does (headings, nested bullet and numbered lists, tables, quotes, code
/// and inline emphasis) with native text and grids. Model HTML, images and
/// links stay inert text, as on the website.
enum MarkdownBlock: Equatable {
  struct Item: Equatable {
    var text: String
    var children: [MarkdownBlock]
  }

  case heading(String)
  case paragraph(String)
  case list(ordered: Bool, start: Int, items: [Item])
  case table(header: [String], rows: [[String]])
  case code(String)
  case quote(String)

  static func parse(_ text: String) -> [MarkdownBlock] {
    parse(lines: text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n"))
  }

  private static let listItem = /^(\s*)(?:(\d+)[.)]|[-*•])\s+(.+)$/
  private static let heading = /^\s*#{1,6}\s+(.+)$/
  private static let rule = /^\s*[-*_]{3,}\s*$/

  static func parse(lines: [String]) -> [MarkdownBlock] {
    var blocks: [MarkdownBlock] = []
    var i = 0
    while i < lines.count {
      let line = lines[i]
      if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
        var code: [String] = []
        i += 1
        while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
          code.append(lines[i])
          i += 1
        }
        i += 1
        blocks.append(.code(code.joined(separator: "\n")))
        continue
      }
      if let table = table(at: i, in: lines) {
        blocks.append(.table(header: table.header, rows: table.rows))
        i = table.next
        continue
      }
      if line.trimmingCharacters(in: .whitespaces).isEmpty || line.wholeMatch(of: rule) != nil {
        i += 1
        continue
      }
      if let match = line.wholeMatch(of: heading) {
        blocks.append(.heading(String(match.1)))
        i += 1
        continue
      }
      if let first = line.wholeMatch(of: listItem) {
        let indent = first.1.count
        let ordered = first.2 != nil
        let start = first.2.flatMap { Int($0) } ?? 1
        var items: [Item] = []
        while i < lines.count, let match = lines[i].wholeMatch(of: listItem),
          match.1.count == indent, (match.2 != nil) == ordered
        {
          var children: [String] = []
          i += 1
          while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).isEmpty,
            lines[i].prefix(while: { $0 == " " || $0 == "\t" }).count > indent
          {
            children.append(lines[i])
            i += 1
          }
          items.append(Item(text: String(match.3), children: parse(lines: children)))
          // Blank lines between items do not start a new list.
          while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).isEmpty,
            i + 1 < lines.count, lines[i + 1].wholeMatch(of: listItem)?.1.count == indent
          {
            i += 1
          }
        }
        blocks.append(.list(ordered: ordered, start: start, items: items))
        continue
      }
      if line.trimmingCharacters(in: .whitespaces).hasPrefix(">") {
        var quote: [String] = []
        while i < lines.count, lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(">") {
          quote.append(
            String(lines[i].trimmingCharacters(in: .whitespaces).dropFirst())
              .trimmingCharacters(in: .whitespaces))
          i += 1
        }
        blocks.append(.quote(quote.joined(separator: "\n")))
        continue
      }
      var paragraph = [line.trimmingCharacters(in: .whitespaces)]
      i += 1
      while i < lines.count, !startsBlock(lines, i) {
        paragraph.append(lines[i].trimmingCharacters(in: .whitespaces))
        i += 1
      }
      blocks.append(.paragraph(paragraph.joined(separator: "\n")))
    }
    return blocks
  }

  private static func startsBlock(_ lines: [String], _ i: Int) -> Bool {
    let line = lines[i]
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    return trimmed.isEmpty || line.wholeMatch(of: heading) != nil || line.wholeMatch(of: listItem) != nil
      || trimmed.hasPrefix("```") || trimmed.hasPrefix(">") || table(at: i, in: lines) != nil
  }

  static func cells(_ line: String) -> [String] {
    var value = line.trimmingCharacters(in: .whitespaces)
    if value.hasPrefix("|") { value.removeFirst() }
    if value.hasSuffix("|"), !value.hasSuffix("\\|") { value.removeLast() }
    var cells: [String] = []
    var current = ""
    var code = false
    var characters = Array(value)[...]
    while let c = characters.popFirst() {
      if c == "\\", characters.first == "|" {
        current.append("|")
        characters.removeFirst()
      } else if c == "|", !code {
        cells.append(current.trimmingCharacters(in: .whitespaces))
        current = ""
      } else {
        if c == "`" { code.toggle() }
        current.append(c)
      }
    }
    cells.append(current.trimmingCharacters(in: .whitespaces))
    return cells
  }

  private static func table(at i: Int, in lines: [String]) -> (header: [String], rows: [[String]], next: Int)? {
    guard i + 1 < lines.count, lines[i].contains("|") else { return nil }
    let header = cells(lines[i])
    let separator = cells(lines[i + 1])
    guard (2...8).contains(header.count), header.count == separator.count,
      separator.allSatisfy({ $0.wholeMatch(of: /:?-{3,}:?/) != nil })
    else { return nil }
    var rows: [[String]] = []
    var next = i + 2
    while next < lines.count, lines[next].contains("|"), rows.count < 80 {
      let row = cells(lines[next])
      guard row.count == header.count else { break }
      rows.append(row)
      next += 1
    }
    return (header, rows, next)
  }
}

/// Inline emphasis, code and line breaks within one block.
enum CoachReplyFormat {
  static func attributed(_ text: String) -> AttributedString {
    (try? AttributedString(
      markdown: text,
      options: .init(allowsExtendedAttributes: false, interpretedSyntax: .inlineOnlyPreservingWhitespace,
        failurePolicy: .returnPartiallyParsedIfPossible)))
      ?? AttributedString(text)
  }

  /// The reply as plain text, for Copy and Share: the words as Coach wrote
  /// them, without the Markdown marks, and without the soft hyphens and
  /// joined spaces the letter is typeset with.
  static func plain(_ text: String) -> String {
    plain(MarkdownBlock.parse(text), indent: "")
  }

  private static func plain(_ blocks: [MarkdownBlock], indent: String) -> String {
    func inline(_ text: String) -> String { String(attributed(text).characters) }
    return blocks.map { block in
      switch block {
      case .heading(let text), .paragraph(let text), .quote(let text):
        return indent + inline(text)
      case .code(let code):
        return code
      case .list(let ordered, let start, let items):
        return items.enumerated().map { index, item in
          let line = indent + (ordered ? "\(start + index)." : "•") + " " + inline(item.text)
          return item.children.isEmpty ? line : line + "\n" + plain(item.children, indent: indent + "   ")
        }
        .joined(separator: "\n")
      case .table(let header, let rows):
        return ([header] + rows).map { $0.map(inline).joined(separator: "\t") }.joined(separator: "\n")
      }
    }
    .joined(separator: "\n\n")
  }

  /// As `attributed`, set in New York at `size`: strong words in weight 500
  /// rather than bold, which is too heavy in running serif text, and code in
  /// SF Mono. A short strong figure ("7 h 15 min") never breaks across lines.
  /// Figures keep the serif's proportional digits, as running text does.
  static func letter(_ text: String, size: CGFloat) -> AttributedString {
    let source = attributed(text)
    var letter = AttributedString()
    for run in source.runs {
      var piece = AttributedString(source[run.range])
      let intent = run.inlinePresentationIntent ?? []
      let strong = intent.contains(.stronglyEmphasized)
      let italic = intent.contains(.emphasized)
      let code = intent.contains(.code)
      if strong || italic || code {
        if strong && piece.characters.count <= 16 {
          let joined = String(piece.characters).replacingOccurrences(of: " ", with: "\u{00A0}")
          piece = AttributedString(joined, attributes: run.attributes)
        }
        var font: Font =
          code
          ? .system(size: size * 0.85, weight: .regular, design: .monospaced)
          : .system(size: size, weight: strong ? .medium : .regular, design: .serif)
        if italic { font = font.italic() }
        piece.font = font
        piece.inlinePresentationIntent = nil
      }
      letter.append(piece)
    }
    return letter
  }
}

/// A Coach reply rendered natively, as a letter: New York paragraphs and
/// lists, tables as small sheets, code in SF Mono. Lines break as set in
/// `LineBreaks`, in the reply's language. A long press copies or shares the
/// reply as written (`CoachReplyFormat.plain`), not as typeset.
struct CoachText: View {
  let text: String
  /// Coach is still writing it: set in the language Coach was asked to use,
  /// rather than one told from its first few words, with its end left to
  /// break as it comes.
  var streaming = false

  var body: some View {
    let language = streaming ? LineBreaks.Language.coach : LineBreaks.language(of: text)
    MarkdownBlocksView(blocks: MarkdownBlock.parse(text), language: language, streaming: streaming)
      .frame(maxWidth: .infinity, alignment: .leading)
      .contextMenu {
        let plain = CoachReplyFormat.plain(text)
        Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = plain }
        ShareLink(item: plain)
      }
  }
}

struct MarkdownBlocksView: View {
  let blocks: [MarkdownBlock]
  /// The reply's language, for hyphenating its paragraphs.
  var language: LineBreaks.Language = .english
  /// Coach is still writing the last block: its end is left to break as it
  /// comes (`LineBreaks.paragraph`).
  var streaming = false
  @Environment(\.dynamicTypeSize) private var typeSize
  /// The serif's size for Coach's paragraphs, which runs of strong or
  /// italic text must match.
  @ScaledMetric(relativeTo: .body) private var size: CGFloat = 18

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
        let open = streaming && index == blocks.count - 1
        switch block {
        case .heading(let text):
          // A heading keeps its words whole.
          let heading = LineBreaks.title(text, size: typeSize, finished: !open)
          Text(CoachReplyFormat.letter(heading, size: size * 20 / 18))
            .folio(.heading)
            .foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 4)
            .accessibilityAddTraits(.isHeader)
        case .paragraph(let text):
          paragraph(text, open: open)
        case .list(let ordered, let start, let items):
          VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
              let last = open && index == items.count - 1
              HStack(alignment: .firstTextBaseline, spacing: 10) {
                // Equal-width digits, so "9." and "10." line up on the right.
                Text(ordered ? "\(start + index)." : "•")
                  .folio(.coach)
                  .monospacedDigit()
                  .foregroundStyle(Theme.inkSecondary)
                  .frame(minWidth: ordered ? 22 : 10, alignment: .trailing)
                VStack(alignment: .leading, spacing: 8) {
                  paragraph(item.text, open: last && item.children.isEmpty)
                  if !item.children.isEmpty {
                    MarkdownBlocksView(blocks: item.children, language: language, streaming: last)
                  }
                }
              }
            }
          }
        case .table(let header, let rows):
          DataTable(columns: header, rows: rows).card(padding: 0)
        case .code(let code):
          ScrollView(.horizontal) {
            Text(code)
              .font(.system(.footnote, design: .monospaced))
              .foregroundStyle(Theme.ink)
              .padding(12)
          }
          .background(Theme.fill, in: .rect(cornerRadius: Theme.Radius.badge, style: .continuous))
        case .quote(let text):
          HStack(spacing: 12) {
            Rectangle().fill(Theme.track).frame(width: 2)
            Text(CoachReplyFormat.letter(body(text, open: open), size: size))
              .folio(.coach)
              .italic()
              .typesettingLanguage(language.typesetting)
              .foregroundStyle(Theme.inkSecondary)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
    }
  }

  private func paragraph(_ text: String, open: Bool) -> some View {
    Text(CoachReplyFormat.letter(body(text, open: open), size: size))
      .folio(.coach)
      .foregroundStyle(Theme.ink)
      .typesettingLanguage(language.typesetting)
      .fixedSize(horizontal: false, vertical: true)
  }

  /// A paragraph's text with its line breaks set (`LineBreaks.paragraph`),
  /// its end left alone while Coach is still writing it (`open`).
  private func body(_ text: String, open: Bool) -> String {
    LineBreaks.paragraph(text, language: language, size: typeSize, finished: !open)
  }
}

/// A table as a native grid: the header in sentence case, the first column
/// as row labels, hairlines between rows, scrolling sideways when it
/// is wider than the screen. A column of figures is set flush right, so its
/// equal-width digits line up by place ("980" under "1,900"). It sits on
/// whatever sheet holds it.
struct DataTable: View {
  let columns: [String]
  let rows: [[String]]
  /// Room at the sides: none inside a figure, which has its own margin.
  var inset: CGFloat = 14

  var body: some View {
    let figures = Self.figureColumns(rows, count: columns.count)
    ScrollView(.horizontal) {
      Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 0) {
        GridRow {
          ForEach(Array(columns.enumerated()), id: \.offset) { index, column in
            Text(CoachReplyFormat.attributed(column))
              .label()
              .multilineTextAlignment(figures.contains(index) ? .trailing : .leading)
              .padding(.vertical, 8)
              .gridColumnAlignment(figures.contains(index) ? .trailing : .leading)
          }
        }
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
          Rectangle().fill(Theme.rule).frame(height: 1).gridCellUnsizedAxes(.horizontal)
          GridRow {
            ForEach(Array(row.enumerated()), id: \.offset) { index, cell in
              Text(CoachReplyFormat.attributed(cell))
                .font(.subheadline.weight(index == 0 ? .semibold : .regular))
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .multilineTextAlignment(figures.contains(index) ? .trailing : .leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 220, alignment: figures.contains(index) ? .trailing : .leading)
                .padding(.vertical, 8)
            }
          }
        }
      }
      .padding(.horizontal, inset)
      .padding(.vertical, 4)
    }
    .scrollIndicators(.hidden)
  }

  /// The columns after the first whose every cell starts with a figure
  /// ("980", "1,900 kcal", "−2 bpm"), an empty cell or a dash aside.
  static func figureColumns(_ rows: [[String]], count: Int) -> Set<Int> {
    Set(
      (1..<max(count, 1)).filter { column in
        let cells = rows.compactMap { row in
          row.indices.contains(column) ? String(CoachReplyFormat.attributed(row[column]).characters) : nil
        }
        .filter { !["", "-", "\u{2013}", "\u{2014}"].contains($0) }
        return !cells.isEmpty && cells.allSatisfy { $0.prefixMatch(of: /[+\-−±~≈]?\d/) != nil }
      })
  }
}
