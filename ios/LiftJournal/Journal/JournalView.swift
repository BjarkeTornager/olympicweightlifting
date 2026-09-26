import LiftAPI
import LiftStore
import SwiftUI

/// Everything recorded, newest first, a fortnight at a time, with the
/// standard search field and a filter menu.
struct JournalView: View {
  @Environment(AppModel.self) private var model
  @State private var items: [Components.Schemas.JournalItem] = []
  @State private var nextBefore: String?
  @State private var loading = false
  @State private var error: String?
  @State private var filter: Kind = .all
  @State private var query = ""

  enum Kind: String, CaseIterable, Identifiable {
    case all = "All", training = "Training", food = "Food", recovery = "Recovery"
    var id: Self { self }
    var symbol: String {
      switch self {
      case .all: "tray.full"
      case .training: "figure.run"
      case .food: "fork.knife"
      case .recovery: "bed.double"
      }
    }
    func includes(_ kind: String) -> Bool {
      switch self {
      case .all: true
      case .training: ["strength", "cardio"].contains(kind)
      case .food: kind == "meal"
      case .recovery: ["sleep", "checkin", "vitals", "body"].contains(kind)
      }
    }
  }

  private var days: [(String, [Components.Schemas.JournalItem])] {
    let words = query.lowercased().split(separator: " ")
    let shown = items.filter { item in
      filter.includes(item.kind)
        && words.allSatisfy { "\(item.title) \(item.detail)".lowercased().contains($0) }
    }
    let grouped = Dictionary(grouping: shown, by: \.date)
    return grouped.keys.sorted(by: >).map { ($0, grouped[$0]!) }
  }

  var body: some View {
    List {
      ForEach(days, id: \.0) { day, entries in
        Section(Self.heading(day)) {
          ForEach(entries, id: \.id) { item in
            if item.hasRoute == true {
              NavigationLink {
                ActivityRouteView(id: item.id, title: item.title)
              } label: {
                JournalRow(item: item)
              }
            } else {
              JournalRow(item: item)
            }
          }
        }
      }
      if let nextBefore, query.isEmpty {
        ProgressView()
          .frame(maxWidth: .infinity)
          .listRowBackground(Color.clear)
          .task(id: nextBefore) { await load(before: nextBefore) }
      }
    }
    .overlay {
      if days.isEmpty && !loading {
        if !query.isEmpty {
          ContentUnavailableView.search(text: query)
        } else {
          ContentUnavailableView(
            "Nothing Here Yet", systemImage: "book.closed",
            description: Text(error ?? "Training, food and recovery appear here as you log them."))
        }
      }
    }
    .navigationTitle(filter == .all ? "Journal" : filter.rawValue)
    .searchable(text: $query, prompt: "Search your journal")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Picker("Show", selection: $filter) {
            ForEach(Kind.allCases) { Label($0.rawValue, systemImage: $0.symbol).tag($0) }
          }
          .pickerStyle(.inline)
        } label: {
          Label("Filter", systemImage: filter == .all
            ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
        }
      }
    }
    .refreshable { await load(before: nil) }
    .task { if items.isEmpty { await load(before: nil) } }
    .onChange(of: model.today?.revision) { _, _ in Task { await load(before: nil) } }
  }

  private func load(before: String?) async {
    guard !loading else { return }
    loading = true
    defer { loading = false }
    let start = before ?? JournalDay.string(Calendar.current.date(byAdding: .day, value: 1, to: .now)!)
    do {
      let page = try await model.client.getJournal(query: .init(before: start, days: 14)).value()
      items = before == nil ? page.items : items + page.items
      nextBefore = page.nextBefore
      error = nil
    } catch {
      self.error = await model.handle(error)
      nextBefore = nil
    }
  }

  static func heading(_ day: String) -> String {
    guard let date = JournalDay.date(day) else { return day }
    if Calendar.current.isDateInToday(date) { return "Today" }
    if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
    return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
  }
}

struct JournalRow: View {
  let item: Components.Schemas.JournalItem

  var body: some View {
    HStack(spacing: 12) {
      IconBadge(symbol: category.symbol, tint: category.tint)
      VStack(alignment: .leading, spacing: 2) {
        Text(item.title)
        if !item.detail.isEmpty {
          Text(item.detail).font(.subheadline).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
      if item.hasRoute == true {
        Image(systemName: "map.fill").font(.caption).foregroundStyle(.secondary)
          .accessibilityLabel("Route recorded")
      }
      if item.fromAppleHealth { AppleHealthMark() }
    }
    .accessibilityElement(children: .combine)
  }

  private var category: Category {
    switch item.kind {
    case "strength": .training
    case "cardio": .activity
    case "meal": .food
    case "sleep": .sleep
    case "vitals": .heart
    case "body": .body
    default: .checkin
    }
  }
}
