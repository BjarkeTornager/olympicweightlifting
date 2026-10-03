import LiftAPI
import LiftStore
import LiftTheme
import SwiftUI

/// Everything recorded, newest first, a fortnight at a time, with the
/// standard search field and a filter menu. The week sits on top as a
/// register: one row per area, one mark per day.
struct JournalView: View {
  @Environment(AppModel.self) private var model
  @State private var items: [Components.Schemas.JournalItem] = []
  @State private var nextBefore: String?
  @State private var loading = false
  @State private var error: String?
  @State private var filter: Kind = .all
  @State private var query = ""
  /// The last seven days, for the register.
  @State private var week: Components.Schemas.Trends?
  /// Scrolled far enough that the large title is rising into the bar.
  @State private var scrolled = false

  init(items: [Components.Schemas.JournalItem] = [], week: Components.Schemas.Trends? = nil) {
    _items = State(initialValue: items)
    _week = State(initialValue: week)
  }

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
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        if query.isEmpty, let week, !week.days.isEmpty {
          WeekRegister(
            days: Array(week.days.suffix(7)),
            checkins: Set(items.filter { $0.kind == "checkin" }.map(\.date))
          )
          .padding(.top, 8)
        }
        ForEach(days, id: \.0) { day, entries in
          DayHeading(day: day).padding(.top, 32)
          ForEach(Array(entries.enumerated()), id: \.element.id) { index, item in
            if index > 0 { Hairline() }
            NavigationLink {
              // A workout opens with every set; everything else with what
              // was recorded for it.
              if item.kind == "strength" {
                SessionView(id: item.id)
              } else {
                JournalItemView(item: item)
              }
            } label: {
              JournalRow(item: item)
            }
          }
        }
        if days.isEmpty && !loading {
          if !query.isEmpty {
            ContentUnavailableView.search(text: query).padding(.top, 40)
          } else {
            Text(error ?? "Training, food and recovery appear here as you log them.")
              .folio(.note)
              .foregroundStyle(Theme.inkSecondary)
              .padding(.top, 32)
          }
        }
        if let nextBefore, query.isEmpty {
          ProgressView()
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
            .task(id: nextBefore) { await load(before: nextBefore) }
        }
      }
      .buttonStyle(CardButtonStyle())
      .padding(.horizontal, Theme.Space.gutter)
      .padding(.bottom, Theme.Space.l)
    }
    // Follows the distance rather than whether it is past the mark: as
    // more days load, a change to "past" could come before an older one.
    .onScrollGeometryChange(for: CGFloat.self) { geometry in
      geometry.contentOffset.y + geometry.contentInsets.top
    } action: { _, distance in
      let past = distance > Self.titleRisesAt
      if past != scrolled { withAnimation(.easeInOut(duration: 0.2)) { scrolled = past } }
    }
    .background(Theme.background)
    .navigationTitle("Journal")
    .searchable(text: $query, prompt: "Search your journal")
    .toolbar {
      // The running head over the large title. Taken out of the bar as the
      // title rises into it, so it neither runs into the title nor reads as
      // a second one beside the inline title; the filter button still
      // shows when a filter is on.
      if !scrolled {
        ToolbarItem(placement: .topBarLeading) {
          Text(filter == .all ? "All entries" : filter.rawValue)
            .foregroundStyle(Theme.ink)
            .kicker()
            .fixedSize()
            .accessibilityLabel(filter == .all ? "Showing all entries" : "Showing \(filter.rawValue.lowercased())")
        }
        .sharedBackgroundVisibility(.hidden)
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Picker("Show", selection: $filter) {
            ForEach(Kind.allCases) { Label($0.rawValue, systemImage: $0.symbol).tag($0) }
          }
          .pickerStyle(.inline)
        } label: {
          Label(
            "Filter",
            systemImage: filter == .all
              ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
        }
        // Read whether or not the running head is in the bar.
        .accessibilityValue(filter == .all ? "All entries" : filter.rawValue)
      }
    }
    .refreshable { await load(before: nil) }
    .task { if items.isEmpty { await load(before: nil) } }
    .task(id: model.today?.revision) {
      if let fresh = try? await model.client.getTrends(query: .init(date: JournalDay.string(.now), days: 7)).value() {
        week = fresh
      }
    }
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

  /// How far the page scrolls, once the search field has tucked away,
  /// before the rising large title would meet the running head.
  private static let titleRisesAt: CGFloat = 24

  static func heading(_ day: String) -> String {
    guard let date = JournalDay.date(day) else { return day }
    if Calendar.current.isDateInToday(date) { return "Today" }
    if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
    return date.formatted(.dateTime.weekday(.wide).day().month(.wide).locale(Format.locale))
  }
}

/// A day's heading on its ink rule: "Today", with "Friday 2 October" beside
/// it; earlier days by weekday, with the date.
private struct DayHeading: View {
  let day: String

  var body: some View {
    let date = JournalDay.date(day)
    let calendar = Calendar.current
    let recent = date.map { calendar.isDateInToday($0) || calendar.isDateInYesterday($0) } ?? false
    let title =
      recent ? JournalView.heading(day) : date?.formatted(.dateTime.weekday(.wide).locale(Format.locale)) ?? day
    let meta = date?.formatted(
      recent
        ? .dateTime.weekday(.wide).day().month(.wide).locale(Format.locale)
        : .dateTime.day().month(.wide).locale(Format.locale))
    FolioSection(title, meta: meta)
  }
}

/// One journal entry: the key of its area, the title in the serif, what was
/// recorded, and where it came from.
struct JournalRow: View {
  let item: Components.Schemas.JournalItem

  var body: some View {
    let source = [item.fromAppleHealth ? "From Apple Health" : nil, item.hasRoute == true ? "Route" : nil]
      .compactMap { $0 }.joined(separator: " · ")
    EntryRow(
      lead: .key(Self.category(item.kind).tint), title: item.title, meta: item.detail,
      source: source.isEmpty ? nil : source, opens: true)
  }

  static func category(_ kind: String) -> Category {
    switch kind {
    case "strength", "cardio": .activity
    case "meal": .food
    case "sleep": .sleep
    case "vitals": .heart
    case "body": .body
    default: .checkin
    }
  }
}

/// The week as a printed register: one row per area of life, one mark per
/// day, filled in that area's pigment when something was logged that day.
/// Today's initial is bold. At the largest text sizes each area's name sits
/// over its marks, so the days keep the full width.
struct WeekRegister: View {
  enum Area: String, CaseIterable {
    case sleep = "Sleep", food = "Food", drinks = "Drinks", movement = "Movement", body = "Body"
    case feeling = "Feeling"

    var tint: Color {
      switch self {
      case .sleep: Theme.sleep
      case .food: Theme.calories
      case .drinks: Theme.water
      case .movement: Theme.activity
      case .body: Theme.body
      case .feeling: Theme.feltEnergy
      }
    }

    /// Whether anything in this area was logged on `day`. Check-ins come
    /// from the journal, as the week's totals don't carry them.
    func logged(_ day: Components.Schemas.TrendDay, checkins: Set<String>) -> Bool {
      switch self {
      case .sleep: day.sleepHours != nil
      case .food: (day.calories ?? 0) > 0
      case .drinks: (day.waterMl ?? 0) > 0
      case .movement: day.cardioMinutes > 0 || day.strengthSessions > 0
      case .body: day.bodyweight != nil || day.bodyFatPercent != nil
      case .feeling: checkins.contains(day.date)
      }
    }
  }

  /// The seven days, oldest first.
  let days: [Components.Schemas.TrendDay]
  /// The dates with a check-in.
  let checkins: Set<String>
  @ScaledMetric(relativeTo: .footnote) private var labelColumn: CGFloat = 92
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let dates = days.map { JournalDay.date($0.date) }
    let stacked = typeSize.isAccessibilitySize
    VStack(alignment: .leading, spacing: 0) {
      Rectangle().fill(Theme.ink).frame(height: 2)
      HStack(alignment: .firstTextBaseline) {
        Text("This week").foregroundStyle(Theme.ink).kicker()
        Spacer(minLength: 8)
        if let first = dates.first ?? nil, let last = dates.last ?? nil {
          let style = Date.FormatStyle.dateTime.day().month(.abbreviated).locale(Format.locale)
          Text("\(first.formatted(style)) – \(last.formatted(style))")
            .font(.footnote)
            .foregroundStyle(Theme.inkSecondary)
        }
      }
      .padding(.top, 10)
      VStack(alignment: .leading, spacing: stacked ? 12 : 7) {
        ForEach(Area.allCases, id: \.self) { area in
          if stacked {
            VStack(alignment: .leading, spacing: 5) {
              label(area)
              marks(area)
            }
          } else {
            HStack(spacing: 5) {
              label(area).lineLimit(1).minimumScaleFactor(0.8).frame(width: labelColumn, alignment: .leading)
              marks(area)
            }
          }
        }
        HStack(spacing: 5) {
          if !stacked { Color.clear.frame(width: labelColumn, height: 1) }
          ForEach(dates.indices, id: \.self) { index in
            let today = index == dates.count - 1
            Text(dates[index]?.formatted(.dateTime.weekday(.narrow).locale(Format.locale)) ?? "")
              .font(.caption2.weight(today ? .bold : .medium))
              .foregroundStyle(today ? Theme.ink : Theme.inkSecondary)
              .frame(maxWidth: .infinity)
          }
        }
        .padding(.top, 4)
      }
      .padding(.top, 12)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(spoken)
      Text("Filled marks show what was logged that day.")
        .font(.footnote)
        .foregroundStyle(Theme.inkSecondary)
        .padding(.top, 10)
        .accessibilityHidden(true)
    }
  }

  private func label(_ area: Area) -> some View {
    HStack(spacing: 7) {
      Key(tint: area.tint)
      Text(area.rawValue).font(.footnote).foregroundStyle(Theme.ink)
    }
  }

  /// One mark per day, filled when something in `area` was logged.
  private func marks(_ area: Area) -> some View {
    HStack(spacing: 5) {
      ForEach(days.indices, id: \.self) { index in
        RoundedRectangle(cornerRadius: Theme.Radius.key)
          .fill(area.logged(days[index], checkins: checkins) ? area.tint : Theme.track)
          .frame(maxWidth: .infinity)
          .frame(height: 12)
      }
    }
  }

  /// "Sleep, 7 of 7 days. Movement, 4 of 7 days."
  private var spoken: String {
    Area.allCases.map { area in
      "\(area.rawValue), \(days.filter { area.logged($0, checkins: checkins) }.count) of \(days.count) days"
    }
    .joined(separator: ". ")
  }
}

#if DEBUG
  #Preview("Journal") {
    NavigationStack { JournalView(items: PreviewData.journal, week: PreviewData.week) }
      .environment(AppModel())
  }
  #Preview("Journal, dark") {
    NavigationStack { JournalView(items: PreviewData.journal, week: PreviewData.week) }
      .environment(AppModel())
      .preferredColorScheme(.dark)
  }
#endif
