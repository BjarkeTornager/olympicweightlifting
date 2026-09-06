import Charts
import SwiftUI

struct TodayView: View {
  @Environment(JournalStore.self) private var store
  @State private var sheet: LogSheet?
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide))).font(.subheadline)
          .foregroundStyle(.secondary)
        Text("Make today yours.").font(.system(.largeTitle, design: .rounded, weight: .bold))
        HealthCard {
          Text("Your day at a glance").font(.headline)
          HStack(alignment: .top) {
            Metric(
              title: "Sleep reported",
              value: store.overview["checkin"]["sleepHours"].double.map {
                duration(Int(($0 * 3600).rounded()))
              } ?? "—", symbol: "moon")
            Metric(
              title: "Food logged", value: "\(store.overview["nutrients"]["calories"].int) kcal",
              symbol: "fork.knife")
            Metric(
              title: "Sessions this week", value: "\(store.overview["sessionsThisWeek"].int)",
              symbol: "figure.run")
          }
          Text("Based on your entries. Missing information stays unmeasured.").font(.caption)
            .foregroundStyle(.secondary)
        }
        HStack {
          quick("Activity", "figure.run", .cardio)
          quick("Food", "fork.knife", .food)
          quick("Check-in", "heart.text.clipboard", .checkin)
        }
        VStack(alignment: .leading, spacing: 14) {
          Text("A useful next step").font(.title2.bold())
          ForEach(store.overview["priorities"].array, id: \.self) { priority in
            HealthCard {
              Text(priority["category"].string).font(.caption.bold()).foregroundStyle(
                Color.liftTeal)
              Text(priority["title"].string).font(.headline)
              Text(priority["reason"].string).font(.subheadline).foregroundStyle(.secondary)
              Button("Discuss with Coach", systemImage: "arrow.up.right") {
                store.ask(
                  "Help me with this next step, using my actual journal: \(priority["title"].string)"
                )
              }
            }
          }
        }
        CardioWeek()
      }.padding(20)
    }.background(Color(.systemGroupedBackground)).navigationTitle("Today")
      .navigationBarTitleDisplayMode(.inline).refreshable { await store.refresh() }
      .sheet(item: $sheet) { LogForm(kind: $0) }
  }
  private func quick(_ label: String, _ symbol: String, _ kind: LogSheet) -> some View {
    Button {
      sheet = kind
    } label: {
      VStack(spacing: 8) {
        Image(systemName: symbol).font(.title2)
        Text(label).font(.caption.bold())
      }.frame(maxWidth: .infinity).padding(.vertical, 18).background(
        Color.liftMint, in: RoundedRectangle(cornerRadius: 20))
    }
  }
}
struct CardioWeek: View {
  @Environment(JournalStore.self) private var store
  var summary: JSONValue { store.overview["cardio"] }
  var body: some View {
    HealthCard {
      Label("Movement this week", systemImage: "waveform.path.ecg").font(.headline)
      HStack {
        Metric(title: "Activities", value: summary["sessions"].string, symbol: "figure.run")
        Metric(
          title: "Time recorded", value: duration(summary["durationSeconds"].int), symbol: "clock")
        Metric(
          title: "Distance",
          value: summary["distanceKm"].double.map {
            "\($0.formatted(.number.precision(.fractionLength(0...1)))) km"
          } ?? "—", symbol: "point.topleft.down.to.point.bottomright.curvepath")
      }
      if !summary["daily"].array.isEmpty {
        Chart(summary["daily"].array) { day in
          BarMark(
            x: .value("Date", String(day["date"].string.suffix(5))),
            y: .value("Minutes", Double(day["durationSeconds"].int) / 60)
          ).foregroundStyle(Color.liftTeal)
        }.frame(height: 140)
      }
      Text("Recorded minutes, with no automatic activity or calorie estimates.").font(.caption)
        .foregroundStyle(.secondary)
    }
  }
}
struct JournalView: View {
  @Environment(JournalStore.self) private var store
  @State private var category = "Cardio"
  @State private var search = ""
  @State private var sheet: LogSheet?
  var entries: [JSONValue] {
    let values: [JSONValue]
    switch category {
    case "Strength": values = store.state["sessions"].array
    case "Food": values = store.state["nutrition"]["meals"].array
    case "Recovery": values = store.state["health"]["checkins"].array
    default: values = store.state["cardio"]["sessions"].array
    }
    return values.filter {
      search.isEmpty || recordTitle($0).localizedCaseInsensitiveContains(search)
        || $0["date"].string.contains(search)
    }.sorted { $0["date"].string > $1["date"].string }
  }
  var body: some View {
    List {
      Picker("Journal category", selection: $category) {
        ForEach(["Cardio", "Strength", "Food", "Recovery"], id: \.self) { Text($0) }
      }.pickerStyle(.segmented).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
      if entries.isEmpty {
        EmptyJournal(
          title: "Your story starts here", detail: "Add an entry or tell Coach what you did.",
          symbol: "book.closed"
        ).listRowBackground(Color.clear)
      }
      ForEach(entries) { entry in
        NavigationLink {
          EntryView(entry: entry, category: category)
        } label: {
          VStack(alignment: .leading, spacing: 6) {
            Text(recordTitle(entry)).font(.headline)
            Text(entry["date"].string).font(.caption).foregroundStyle(.secondary)
            if entry["durationSeconds"].int > 0 {
              Text(duration(entry["durationSeconds"].int)).font(.subheadline).foregroundStyle(
                Color.liftTeal)
            }
          }.padding(.vertical, 5)
        }
      }
      NavigationLink {
        ImageLibraryView()
      } label: {
        Label("Image library", systemImage: "photo.on.rectangle")
      }
    }.navigationTitle("Journal").searchable(text: $search, prompt: "Activity, meal or date")
      .refreshable { await store.refresh() }
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button("Cardio activity", systemImage: "figure.run") { sheet = .cardio }
            Button("Meal", systemImage: "fork.knife") { sheet = .food }
            Button("Daily check-in", systemImage: "moon") { sheet = .checkin }
          } label: {
            Image(systemName: "plus")
          }.accessibilityLabel("Add journal entry")
        }
      }
      .sheet(item: $sheet) { LogForm(kind: $0) }
  }
}
func recordTitle(_ entry: JSONValue) -> String {
  for key in ["title", "name", "activity"] where !entry[key].string.isEmpty {
    return entry[key].string.replacingOccurrences(of: "_", with: " ").capitalized
  }
  return "Daily check-in"
}
struct EntryView: View {
  @Environment(JournalStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let entry: JSONValue, category: String
  var current: JSONValue {
    let path =
      category == "Cardio"
      ? ["cardio", "sessions"]
      : category == "Food"
        ? ["nutrition", "meals"] : category == "Recovery" ? ["health", "checkins"] : ["sessions"]
    return path.reduce(store.state) { $0[$1] }.array.first { $0.id == entry.id } ?? entry
  }
  @State private var editing = false
  @State private var deleting = false
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        HealthCard { RecordDetails(value: current) }
        Button("Discuss with Coach", systemImage: "sparkles") {
          store.ask(
            "Discuss my \(recordTitle(entry)) on \(entry["date"].string). Read my journal first.")
        }
        if category == "Cardio" {
          Button("Edit activity", systemImage: "square.and.pencil") { editing = true }
        }
        Button("Delete entry", systemImage: "trash", role: .destructive) { deleting = true }
      }.padding(20)
    }.background(Color(.systemGroupedBackground)).navigationTitle(recordTitle(current))
      .navigationBarTitleDisplayMode(.inline)
      .sheet(isPresented: $editing) { NavigationStack { CardioForm(entry: current) } }
      .confirmationDialog("Delete this entry?", isPresented: $deleting, titleVisibility: .visible) {
        Button("Delete entry", role: .destructive) {
          Task {
            do {
              if category == "Cardio" {
                try await store.saveAction(
                  json(["kind": s("delete_cardio"), "cardioId": s(entry.id)]))
              } else {
                let path =
                  category == "Food"
                  ? ["nutrition", "meals"]
                  : category == "Recovery" ? ["health", "checkins"] : ["sessions"]
                let list = path.reduce(store.state) { $0[$1] }.array.filter { $0.id != entry.id }
                try await store.saveState(store.state.setting(path, to: .array(list)))
              }
              dismiss()
            } catch { store.handle(error) }
          }
        }
      } message: {
        Text("Only this entry will be removed from your account.")
      }
  }
}
struct RecordDetails: View {
  @Environment(JournalStore.self) private var store
  let value: JSONValue
  private let fields = [
    ("date", "Date"), ("activity", "Activity"), ("distanceKm", "Distance · km"),
    ("durationType", "Time basis"), ("averageHeartRate", "Average heart rate · bpm"),
    ("maxHeartRate", "Maximum heart rate · bpm"), ("effort", "Effort · /10"),
    ("elevationGainM", "Elevation · m"), ("caloriesKcal", "Reported activity energy · kcal"),
    ("energy", "Energy · /5"), ("soreness", "Soreness · /5"), ("waterMl", "Water · ml"),
    ("bodyweight", "Weight · kg"), ("calories", "Calories · kcal"), ("protein", "Protein · g"),
    ("carbs", "Carbs · g"), ("fat", "Fat · g"), ("goal", "Goal"),
  ]
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      if !value["title"].string.isEmpty { Text(value["title"].string).font(.headline) }
      if !value["name"].string.isEmpty { Text(value["name"].string).font(.headline) }
      if value["durationSeconds"].int > 0 {
        LabeledContent("Duration", value: duration(value["durationSeconds"].int))
      }
      if let hours = value["sleepHours"].double {
        LabeledContent("Sleep", value: duration(Int((hours * 3600).rounded())))
      }
      ForEach(fields, id: \.0) { key, label in
        if !value[key].isNull && !value[key].string.isEmpty {
          LabeledContent(label, value: value[key].string)
        }
      }
      ForEach(value["items"].array, id: \.self) { item in
        VStack(alignment: .leading, spacing: 6) {
          Text(item["name"].string).font(.headline)
          Text(item["portion"].string).foregroundStyle(.secondary)
          Text(
            "\(item["calories"].string) kcal · P \(item["protein"].string) g · C \(item["carbs"].string) g · F \(item["fat"].string) g"
          ).font(.caption)
        }
      }
      if value["estimated"].bool {
        Text("Estimated values — review portions and measurements.").font(.caption).foregroundStyle(
          .secondary)
      }
      ForEach(value["exercises"].array) { exercise in
        VStack(alignment: .leading, spacing: 8) {
          Text(store.exerciseName(exercise["exerciseId"].string)).font(.headline)
          ForEach(exercise["sets"].array) { set in
            HStack {
              Text("\(set["weight"].string) kg × \(set["reps"].string)")
              Spacer()
              Text(
                set["result"].string == "success"
                  ? "Made" : set["result"].string == "miss" ? "Miss" : "Planned"
              ).font(.caption).foregroundStyle(.secondary)
            }
          }
        }
      }
      forNotes("notes")
      forNotes("athleteNotes")
    }.font(.subheadline).textSelection(.enabled)
  }
  @ViewBuilder private func forNotes(_ key: String) -> some View {
    if !value[key].string.isEmpty {
      Divider()
      Text(value[key].string).foregroundStyle(.secondary)
    }
  }
}
