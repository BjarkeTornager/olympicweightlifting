import LiftAPI
import LiftTheme
import SwiftUI

/// One journal item opened: what it is and when, everything recorded for it,
/// and its route when Apple Health recorded one.
struct JournalItemView: View {
  let item: Components.Schemas.JournalItem

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        VStack(alignment: .leading, spacing: 12) {
          JournalRow(item: item)
          Text([JournalView.heading(item.date), kind].compactMap { $0 }.joined(separator: " · "))
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
        .card()
        if let details = item.details, !details.lines.isEmpty || details.summary != nil || details.footnote != nil {
          EntryDetails(entry: details, fullScreen: true)
            .card()
        }
        if item.hasRoute == true {
          NavigationLink {
            ActivityRouteView(id: item.id, title: item.title)
          } label: {
            HStack(spacing: 12) {
              IconBadge(symbol: "map.fill", tint: Theme.accent, size: 34)
              Text("Route").font(.body.weight(.medium)).foregroundStyle(Color.primary)
              Spacer()
              Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .card()
          }
          .buttonStyle(CardButtonStyle())
        }
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 12)
    }
    .background(Theme.background)
    .navigationTitle(item.title)
    .navigationBarTitleDisplayMode(.inline)
  }

  /// A meal's type ("Lunch"), which its details carry in their title.
  private var kind: String? {
    guard item.kind == "meal", let title = item.details?.title, let colon = title.firstIndex(of: ":") else {
      return nil
    }
    return String(title[..<colon])
  }
}
