import LiftAPI
import SwiftUI

/// One entry's details: what it is, and each item, set or value in it. Used
/// for Coach's receipts and for opening an item in the journal.
struct EntryDetails: View {
  let entry: Components.Schemas.CoachReceiptEntry
  /// On its own screen (the journal) rather than inside a receipt: larger
  /// text, a line between rows, and no title, as the screen names the item.
  var fullScreen = false

  var body: some View {
    VStack(alignment: .leading, spacing: fullScreen ? 10 : 6) {
      VStack(alignment: .leading, spacing: 1) {
        if !fullScreen {
          Text(entry.title).font(.subheadline.weight(.semibold))
        }
        let meta = [fullScreen ? nil : entry.date.flatMap(day), entry.summary].compactMap { $0 }
        if !meta.isEmpty {
          Text(meta.joined(separator: " · "))
            .font(fullScreen ? .subheadline : .footnote)
            .foregroundStyle(.secondary)
        }
      }
      ForEach(Array(entry.lines.enumerated()), id: \.offset) { index, line in
        if fullScreen, index > 0 || entry.summary != nil { Divider() }
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          VStack(alignment: .leading, spacing: 1) {
            Text(line.label).font(fullScreen ? .body : .footnote)
            if let note = line.note {
              Text(note).font(fullScreen ? .footnote : .caption).foregroundStyle(.secondary)
            }
          }
          Spacer(minLength: 8)
          if let value = line.value {
            Text(value)
              .font(fullScreen ? .subheadline : .footnote)
              .foregroundStyle(.secondary)
              .monospacedDigit()
              .multilineTextAlignment(.trailing)
          }
        }
        .accessibilityElement(children: .combine)
      }
      if let footnote = entry.footnote {
        Text(footnote)
          .font(fullScreen ? .footnote : .caption)
          .foregroundStyle(.secondary)
          .padding(.top, fullScreen ? 4 : 0)
      }
    }
  }

  /// Today's date goes without saying; another day is named.
  private func day(_ date: String) -> String? {
    guard let parsed = JournalDay.date(date), !Calendar.current.isDateInToday(parsed) else { return nil }
    return JournalView.heading(date)
  }
}
