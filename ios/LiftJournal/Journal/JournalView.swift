import LiftAPI
import LiftStore
import SwiftUI

/// Everything recorded, newest first, a fortnight at a time.
struct JournalView: View {
  @Environment(AppModel.self) private var model
  @State private var items: [Components.Schemas.JournalItem] = []
  @State private var nextBefore: String?
  @State private var loading = false
  @State private var error: String?
  @State private var filter: Kind = .all

  enum Kind: String, CaseIterable, Identifiable {
    case all = "All", training = "Training", food = "Food", recovery = "Recovery"
    var id: Self { self }
    func includes(_ kind: String) -> Bool {
      switch self {
      case .all: true
      case .training: ["strength", "cardio"].contains(kind)
      case .food: kind == "meal"
      case .recovery: ["sleep", "checkin", "vitals"].contains(kind)
      }
    }
  }

  private var days: [(String, [Components.Schemas.JournalItem])] {
    let shown = items.filter { filter.includes($0.kind) }
    let grouped = Dictionary(grouping: shown, by: \.date)
    return grouped.keys.sorted(by: >).map { ($0, grouped[$0]!) }
  }

  var body: some View {
    List {
      Picker("Show", selection: $filter) {
        ForEach(Kind.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      .listRowBackground(Color.clear)
      .listRowInsets(EdgeInsets())

      ForEach(days, id: \.0) { day, entries in
        Section(Self.heading(day)) {
          ForEach(entries, id: \.id) { JournalRow(item: $0) }
        }
      }
      if let nextBefore {
        ProgressView()
          .frame(maxWidth: .infinity)
          .task(id: nextBefore) { await load(before: nextBefore) }
      } else if !items.isEmpty {
        Text("That's everything.")
          .font(.footnote).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity)
          .listRowBackground(Color.clear)
      }
    }
    .overlay {
      if items.isEmpty && !loading {
        ContentUnavailableView(
          "Nothing here yet", systemImage: "book.closed",
          description: Text(error ?? "Training, food and recovery appear here as you log them."))
      }
    }
    .navigationTitle("Journal")
    .refreshable { await reload() }
    .task { if items.isEmpty { await reload() } }
    .onChange(of: model.today?.revision) { _, _ in Task { await reload() } }
  }

  private func reload() async {
    await load(before: nil)
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
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: symbol)
        .foregroundStyle(color)
        .frame(width: 28)
      VStack(alignment: .leading, spacing: 2) {
        Text(item.title)
        if !item.detail.isEmpty {
          Text(item.detail).font(.subheadline).foregroundStyle(.secondary)
        }
        if item.fromAppleHealth { AppleHealthBadge() }
      }
    }
    .accessibilityElement(children: .combine)
  }

  private var symbol: String {
    switch item.kind {
    case "strength": "figure.strengthtraining.olympic"
    case "cardio": "figure.run"
    case "meal": "fork.knife"
    case "sleep": "bed.double.fill"
    case "checkin": "face.smiling"
    case "vitals": "heart.fill"
    default: "circle"
    }
  }

  private var color: Color {
    switch item.kind {
    case "strength": .orange
    case "cardio": .green
    case "meal": .yellow
    case "sleep": .indigo
    case "vitals": .pink
    default: .secondary
    }
  }
}
