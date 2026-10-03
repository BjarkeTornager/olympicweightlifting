import LiftAPI
import LiftTheme
import SwiftUI

/// One journal item opened: what it is and when, everything recorded for it,
/// and its route when Apple Health recorded one.
struct JournalItemView: View {
  let item: Components.Schemas.JournalItem
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        CardLabel(
          title: [JournalView.heading(item.date), kind].compactMap { $0 }.joined(separator: " · "),
          key: JournalRow.category(item.kind).tint)
        Text(LineBreaks.title(item.title, size: typeSize))
          .folio(.sectionTitle)
          .foregroundStyle(Theme.ink)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
          .padding(.top, 8)
        if !item.detail.isEmpty {
          Text(item.detail).font(.subheadline).foregroundStyle(Theme.inkSecondary).padding(.top, 4)
        }
        if item.fromAppleHealth {
          Text("From Apple Health")
            .font(.caption.weight(.medium))
            .foregroundStyle(Theme.inkSecondary)
            .padding(.top, 4)
        }
        if let details = item.details, !details.lines.isEmpty || details.summary != nil || details.footnote != nil {
          EntryDetails(entry: details, fullScreen: true)
            .card()
            .padding(.top, 20)
        }
        if item.hasRoute == true {
          NavigationLink {
            ActivityRouteView(id: item.id, title: item.title)
          } label: {
            EntryRow(lead: .key(Theme.activity), title: "Route", meta: "Where it went, on a map", opens: true)
          }
          .buttonStyle(CardButtonStyle())
          .overlay(alignment: .bottom) { Hairline() }
          .padding(.top, 12)
        }
      }
      .padding(.horizontal, Theme.Space.gutter)
      .padding(.vertical, Theme.Space.s)
    }
    .background(Theme.background)
    .navigationTitle(name)
    .navigationBarTitleDisplayMode(.inline)
  }

  /// What kind of entry this is, for the bar above the title.
  private var name: String {
    switch item.kind {
    case "strength": "Workout"
    case "cardio": "Activity"
    case "meal": "Meal"
    case "sleep": "Sleep"
    case "checkin": "Check-in"
    case "vitals": "Heart and movement"
    case "body": "Body"
    default: "Entry"
    }
  }

  /// A meal's type ("Lunch"), which its details carry in their title.
  private var kind: String? {
    guard item.kind == "meal", let title = item.details?.title, let colon = title.firstIndex(of: ":") else {
      return nil
    }
    return String(title[..<colon])
  }
}
