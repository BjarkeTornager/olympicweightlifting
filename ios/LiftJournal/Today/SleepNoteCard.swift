import Foundation
import LiftAPI
import LiftTheme
import SwiftUI

/// When Coach's note on short sleep is hidden. Short sleep changes slowly,
/// so a hidden note stays away for a week rather than coming back each day.
enum SleepNote {
  static let hiddenKey = "sleepNoteHidden"
  static let quietDays = 7

  /// What to save when the note `id` is hidden on `today`: "sleep-short
  /// 2026-10-04".
  static func hide(_ id: String, today: String) -> String { "\(id) \(today)" }

  /// Whether the note `id` is still hidden on `today`, from what was saved.
  static func hidden(_ id: String, saved: String, today: String, calendar: Calendar = .current) -> Bool {
    let parts = saved.split(separator: " ")
    guard parts.count == 2, parts[0] == id,
      let from = JournalDay.date(String(parts[1]), calendar: calendar),
      let day = JournalDay.date(today, calendar: calendar),
      let days = calendar.dateComponents([.day], from: from, to: day).day
    else { return false }
    return days >= 0 && days < quietDays
  }
}

/// Coach's note on two weeks of short sleep, from the server: what the
/// journal shows, an invitation, and a way to talk it through with Coach.
/// It can be hidden for a week.
struct SleepNoteCard: View {
  @Environment(AppModel.self) private var model
  let note: Components.Schemas.SleepNote
  let hide: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Rectangle().fill(Theme.ink).frame(height: 1)
      HStack(alignment: .firstTextBaseline) {
        Text("A thought from Coach").foregroundStyle(Theme.ink).kicker()
        Spacer(minLength: 0)
        Button("Hide for a week", systemImage: "xmark", action: hide)
          .labelStyle(.iconOnly)
          .font(.footnote.weight(.semibold))
          .foregroundStyle(Theme.inkSecondary)
          .frame(width: 44, height: 44)
          .contentShape(.rect)
      }
      VStack(alignment: .leading, spacing: 6) {
        Text(note.title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(Theme.ink)
        Paragraph(note.observation, language: .english)
          .folio(.note)
          .foregroundStyle(Theme.ink)
        Paragraph(note.invitation, language: .english)
          .folio(.note)
          .foregroundStyle(Theme.inkSecondary)
      }
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityElement(children: .combine)
      Button {
        model.openCoach(.message(note.prompt))
      } label: {
        ActionText("Talk it through")
      }
      .buttonStyle(.plain)
      .padding(.top, 10)
    }
  }
}
