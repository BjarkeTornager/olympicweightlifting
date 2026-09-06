import SwiftUI

enum LogSheet: String, Identifiable {
  case cardio, food, checkin
  var id: String { rawValue }
}
struct LogForm: View {
  let kind: LogSheet
  var body: some View {
    NavigationStack {
      switch kind {
      case .cardio: CardioForm()
      case .food: FoodForm()
      case .checkin: CheckinForm()
      }
    }
  }
}
struct NumberRow: View {
  let title: String
  @Binding var value: String
  var body: some View {
    HStack {
      Text(title)
      Spacer()
      TextField("—", text: $value).multilineTextAlignment(.trailing).keyboardType(.decimalPad)
        .frame(minWidth: 60, maxWidth: 125).accessibilityLabel(title)
    }
  }
}
struct FormSave: ViewModifier {
  @Environment(JournalStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let title: String
  let save: () async throws -> Void
  @State private var saveError: String?
  func body(content: Content) -> some View {
    content.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
      .interactiveDismissDisabled(store.busy)
      .alert(
        "Could not save",
        isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })
      ) {
        Button("OK", role: .cancel) { saveError = nil }
      } message: {
        Text(saveError ?? "")
      }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }.disabled(store.busy)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            Task {
              do {
                try await save()
                dismiss()
              } catch {
                if (error as? ServiceError)?.status == 401 {
                  store.handle(error)
                } else {
                  saveError = error.localizedDescription
                }
              }
            }
          }.fontWeight(.semibold).disabled(!store.canSave)
        }
      }
  }
}
struct CardioForm: View {
  @Environment(JournalStore.self) private var store
  let entry: JSONValue
  @State private var activity: String
  @State private var date: Date
  @State private var hours: String
  @State private var minutes: String
  @State private var seconds: String
  @State private var distance: String
  @State private var unit = "km"
  @State private var title: String
  @State private var basis: String
  @State private var average: String
  @State private var maximum: String
  @State private var effort: String
  @State private var elevation: String
  @State private var calories: String
  @State private var notes: String
  init(entry: JSONValue = .null) {
    self.entry = entry
    _activity = State(
      initialValue: entry["activity"].string.isEmpty ? "running" : entry["activity"].string)
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    _date = State(initialValue: f.date(from: entry["date"].string) ?? .now)
    let total = entry["durationSeconds"].int
    _hours = State(initialValue: total >= 3600 ? "\(total / 3600)" : "")
    _minutes = State(initialValue: total > 0 ? "\((total % 3600) / 60)" : "")
    _seconds = State(initialValue: total % 60 > 0 ? "\(total % 60)" : "")
    _distance = State(initialValue: entry["distanceKm"].string)
    _title = State(initialValue: entry["title"].string)
    _basis = State(
      initialValue: entry["durationType"].string.isEmpty
        ? "unspecified" : entry["durationType"].string)
    _average = State(initialValue: entry["averageHeartRate"].string)
    _maximum = State(initialValue: entry["maxHeartRate"].string)
    _effort = State(initialValue: entry["effort"].string)
    _elevation = State(initialValue: entry["elevationGainM"].string)
    _calories = State(initialValue: entry["caloriesKcal"].string)
    _notes = State(initialValue: entry["notes"].string)
  }
  var body: some View {
    Form {
      Section {
        Picker("Activity", selection: $activity) {
          ForEach(
            [
              "running", "cycling", "walking", "swimming", "rowing", "hiking", "elliptical",
              "other",
            ], id: \.self
          ) { Text($0.capitalized).tag($0) }
        }
        DatePicker("Date", selection: $date, in: ...Date.now, displayedComponents: .date)
      }
      Section("Duration") {
        NumberRow(title: "Hours", value: $hours)
        NumberRow(title: "Minutes", value: $minutes)
        NumberRow(title: "Seconds", value: $seconds)
      }
      Section("Distance · optional") {
        NumberRow(title: "Distance", value: $distance)
        Picker("Unit", selection: $unit) {
          Text("Kilometres").tag("km")
          Text("Miles").tag("mi")
          Text("Metres").tag("m")
        }
      }
      Section {
        DisclosureGroup("More details") {
          TextField("Activity name", text: $title)
          Picker("Time basis", selection: $basis) {
            Text("Not specified").tag("unspecified")
            Text("Moving").tag("moving")
            Text("Elapsed").tag("elapsed")
          }
          NumberRow(title: "Average heart rate · bpm", value: $average)
          NumberRow(title: "Maximum heart rate · bpm", value: $maximum)
          NumberRow(title: "Effort · /10", value: $effort)
          NumberRow(title: "Elevation gain · m", value: $elevation)
          NumberRow(title: "Reported activity kcal", value: $calories)
          TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...6)
        }
      } footer: {
        Text(
          "Add measurements you know. Reported activity calories stay separate from food intake.")
      }
    }.modifier(
      FormSave(title: entry.isNull ? "Log activity" : "Edit activity") {
        let total = try enteredDuration(hours: hours, minutes: minutes, seconds: seconds)
        guard total > 0 else { throw ServiceError(message: "Enter the activity duration.") }
        let km = try checkedNumber(distance, name: "distance").double.map {
          $0 * (unit == "mi" ? 1.609344 : unit == "m" ? 0.001 : 1)
        }
        let data = json([
          "activity": s(activity), "date": s(dayString(date)), "durationSeconds": n(total),
          "distanceKm": km.map(JSONValue.number) ?? .null, "title": s(title),
          "durationType": s(basis), "averageHeartRate": try checkedNumber(average, name: "average"),
          "maxHeartRate": try checkedNumber(maximum, name: "maximum"),
          "effort": try checkedNumber(effort, name: "effort"),
          "elevationGainM": try checkedNumber(elevation, name: "elevation"),
          "caloriesKcal": try checkedNumber(calories, name: "calories"),
          "notes": s(notes),
        ])
        try await store.saveAction(
          entry.isNull
            ? json(["kind": s("record_cardio"), "cardio": data])
            : json(["kind": s("update_cardio"), "cardioId": s(entry.id), "changes": data]))
      })
  }
}
struct CheckinForm: View {
  @Environment(JournalStore.self) private var store
  @State private var date = Date.now
  @State private var hours = ""
  @State private var minutes = ""
  @State private var energy = ""
  @State private var soreness = ""
  @State private var water = ""
  @State private var weight = ""
  @State private var notes = ""
  var body: some View {
    Form {
      DatePicker(
        "Wake-up / check-in date", selection: $date, in: ...Date.now, displayedComponents: .date)
      Section("Sleep") {
        NumberRow(title: "Hours asleep", value: $hours)
        NumberRow(title: "Minutes asleep", value: $minutes)
      }
      Section("How you feel") {
        NumberRow(title: "Energy · /5", value: $energy)
        NumberRow(title: "Soreness · /5", value: $soreness)
      }
      Section("Daily totals") {
        NumberRow(title: "Water · ml", value: $water)
        NumberRow(title: "Bodyweight · kg", value: $weight)
        TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...6)
      }
    }.onAppear { populate() }.onChange(of: date) { _, _ in populate() }
      .modifier(
        FormSave(title: "Daily check-in") {
          var patch: [String: JSONValue] = ["date": s(dayString(date)), "notes": s(notes)]
          if !hours.isEmpty || !minutes.isEmpty {
            patch["sleepHours"] = n(try enteredDuration(hours: hours, minutes: minutes) / 3600)
          }
          for (key, text) in [
            ("energy", energy), ("soreness", soreness), ("waterMl", water), ("bodyweight", weight),
          ] where !text.isEmpty { patch[key] = try checkedNumber(text, name: key) }
          try await store.saveAction(json(["kind": s("record_checkin"), "checkin": json(patch)]))
        })
  }
  private func populate() {
    let entry =
      store.state["health"]["checkins"].array.first { $0["date"].string == dayString(date) }
      ?? .null
    if let sleep = entry["sleepHours"].double {
      let m = Int((sleep * 60).rounded())
      hours = "\(m / 60)"
      minutes = "\(m % 60)"
    } else {
      hours = ""
      minutes = ""
    }
    energy = entry["energy"].string
    soreness = entry["soreness"].string
    water = entry["waterMl"].string
    weight = entry["bodyweight"].string
    notes = entry["notes"].string
  }
}
struct FoodForm: View {
  @Environment(JournalStore.self) private var store
  @State private var date = Date.now
  @State private var name = ""
  @State private var portion = ""
  @State private var calories = ""
  @State private var protein = ""
  @State private var carbs = ""
  @State private var fat = ""
  @State private var notes = ""
  @State private var type = "lunch"
  @State private var classification = json(["foodGroups": .array([]), "ingredients": .array([])])
  var body: some View {
    Form {
      Section {
        TextField("Meal or food name", text: $name)
        TextField("Portion, e.g. 200 g", text: $portion)
        DatePicker("Date", selection: $date, in: ...Date.now, displayedComponents: .date)
        Picker("Meal", selection: $type) {
          ForEach(["breakfast", "lunch", "dinner", "snack"], id: \.self) {
            Text($0.capitalized).tag($0)
          }
        }
      }
      Section { NativeFoodTagEditor(value: $classification) }
      Section("Nutrition for this portion") {
        NumberRow(title: "Calories · kcal", value: $calories)
        NumberRow(title: "Protein · g", value: $protein)
        NumberRow(title: "Carbs · g", value: $carbs)
        NumberRow(title: "Fat · g", value: $fat)
      }
      Section {
        TextField("Notes", text: $notes, axis: .vertical)
      } footer: {
        Text(
          "Use package values when you know them. For estimates or a meal photo, ask Coach and review the portions before saving."
        )
      }
    }.modifier(
      FormSave(title: "Log food") {
        guard
          ![name, portion, calories, protein, carbs, fat].contains(where: {
            $0.trimmingCharacters(in: .whitespaces).isEmpty
          })
        else {
          throw ServiceError(
            message: "Enter the food, portion and nutrition values, or ask Coach for an estimate.")
        }
        let item = json([
          "name": s(name), "portion": s(portion), "classification": classification,
          "calories": try checkedNumber(calories, name: "calories"),
          "protein": try checkedNumber(protein, name: "protein"),
          "carbs": try checkedNumber(carbs, name: "carbs"),
          "fat": try checkedNumber(fat, name: "fat"),
        ])
        try await store.saveAction(
          json([
            "kind": s("record_meal"),
            "meal": json([
              "date": s(dayString(date)), "name": s(name), "type": s(type), "items": .array([item]),
              "source": s("manual"), "estimated": .bool(false), "notes": s(notes),
              "photoIds": .array([]),
            ]),
          ]))
      })
  }
}
