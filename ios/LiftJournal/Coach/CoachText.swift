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
}

/// A Coach reply rendered natively.
struct CoachText: View {
  let text: String

  var body: some View {
    MarkdownBlocksView(blocks: MarkdownBlock.parse(text))
      .textSelection(.enabled)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct MarkdownBlocksView: View {
  let blocks: [MarkdownBlock]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
        switch block {
        case .heading(let text):
          Text(CoachReplyFormat.attributed(text))
            .font(.headline)
            .padding(.top, 4)
        case .paragraph(let text):
          Text(CoachReplyFormat.attributed(text))
            .lineSpacing(2)
        case .list(let ordered, let start, let items):
          VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
              HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(ordered ? "\(start + index)." : "•")
                  .monospacedDigit()
                  .foregroundStyle(.secondary)
                  .frame(minWidth: ordered ? 20 : 10, alignment: .trailing)
                VStack(alignment: .leading, spacing: 6) {
                  Text(CoachReplyFormat.attributed(item.text)).lineSpacing(2)
                  if !item.children.isEmpty { MarkdownBlocksView(blocks: item.children) }
                }
              }
            }
          }
        case .table(let header, let rows):
          DataTable(columns: header, rows: rows)
        case .code(let code):
          ScrollView(.horizontal) {
            Text(code)
              .font(.system(.footnote, design: .monospaced))
              .padding(12)
          }
          .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 10))
        case .quote(let text):
          HStack(spacing: 10) {
            Capsule().fill(.tertiary).frame(width: 3)
            Text(CoachReplyFormat.attributed(text)).foregroundStyle(.secondary)
          }
        }
      }
    }
  }
}

/// A table as a native grid: bold header, the first column as row labels,
/// scrolling sideways when it is wider than the screen.
struct DataTable: View {
  let columns: [String]
  let rows: [[String]]

  var body: some View {
    ScrollView(.horizontal) {
      Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 0) {
        GridRow {
          ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
            Text(CoachReplyFormat.attributed(column))
              .font(.footnote.weight(.semibold))
              .foregroundStyle(.secondary)
              .padding(.vertical, 8)
          }
        }
        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
          Divider().gridCellUnsizedAxes(.horizontal)
          GridRow {
            ForEach(Array(row.enumerated()), id: \.offset) { index, cell in
              Text(CoachReplyFormat.attributed(cell))
                .font(.subheadline.weight(index == 0 ? .semibold : .regular))
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 220, alignment: .leading)
                .padding(.vertical, 8)
            }
          }
        }
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 4)
    }
    .scrollIndicators(.hidden)
    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 14))
  }
}
