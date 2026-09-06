import SwiftUI

struct TrainingView: View {
  @Environment(JournalStore.self) private var store
  @State private var mode = "Strength"
  @State private var cardio = false
  var body: some View {
    List {
      Picker("Training type", selection: $mode) {
        Text("Strength").tag("Strength")
        Text("Cardio").tag("Cardio")
      }.pickerStyle(.segmented).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
      if mode == "Cardio" {
        Section {
          Button("Log activity", systemImage: "plus.circle.fill") { cardio = true }
          Button("Log with Coach", systemImage: "sparkles") {
            store.ask("Help me log my completed cardio activity.")
          }
        }
        CardioWeek().listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
        ForEach(
          store.state["cardio"]["sessions"].array.sorted { $0["date"].string > $1["date"].string }
            .prefix(20)
        ) { entry in
          NavigationLink {
            EntryView(entry: entry, category: "Cardio")
          } label: {
            VStack(alignment: .leading, spacing: 5) {
              Text(recordTitle(entry)).font(.headline)
              Text("\(entry["date"].string) · \(duration(entry["durationSeconds"].int))").font(
                .caption
              ).foregroundStyle(.secondary)
            }
          }
        }
      } else {
        if !store.state["activeWorkout"].isNull {
          Section("In progress") {
            NavigationLink {
              WorkoutView()
            } label: {
              VStack(alignment: .leading, spacing: 6) {
                Label(store.state["activeWorkout"]["title"].string, systemImage: "play.circle.fill")
                  .font(.headline)
                Text("Your saved workout is ready to continue.").font(.caption).foregroundStyle(
                  .secondary)
              }
            }
          }
        }
        Section("Your programmes") {
          ForEach(store.programmes) { programme in
            NavigationLink {
              ProgrammeView(programme: programme)
            } label: {
              VStack(alignment: .leading, spacing: 5) {
                Text(programme["title"].string).font(.headline)
                Text("\(programme["exercises"].array.count) exercises").font(.caption)
                  .foregroundStyle(.secondary)
              }
            }
          }
        }
        NavigationLink {
          ExerciseLibraryView()
        } label: {
          Label("Exercise guides", systemImage: "play.rectangle")
        }
      }
    }.navigationTitle("Train").refreshable { await store.refresh() }.sheet(isPresented: $cardio) {
      LogForm(kind: .cardio)
    }
  }
}
struct ProgrammeView: View {
  @Environment(JournalStore.self) private var store
  let programme: JSONValue
  @State private var opened = false
  var body: some View {
    List {
      Section {
        Text(programme["title"].string).font(.title2.bold())
        if !programme["focus"].string.isEmpty {
          Text(programme["focus"].string).foregroundStyle(.secondary)
        }
      }
      ForEach(programme["exercises"].array, id: \.self) { exercise in
        VStack(alignment: .leading, spacing: 7) {
          Text(store.exerciseName(exercise["exerciseId"].string)).font(.headline)
          Text(
            "\((exercise["sets"]["default"].isNull ? exercise["sets"].string : exercise["sets"]["default"].string)) sets · \(exercise["reps"].string) reps"
          ).font(
            .subheadline
          ).foregroundStyle(.secondary)
        }
      }
      Section {
        Button("Start workout", systemImage: "play.fill") {
          Task {
            do {
              try await store.saveAction(
                json([
                  "kind": s("start_programme"), "dayId": s(programme.id), "date": s(dayString()),
                ]))
              opened = true
            } catch { store.handle(error) }
          }
        }.disabled(!store.canSave || !store.state["activeWorkout"].isNull)
      }
      if !store.state["activeWorkout"].isNull {
        NavigationLink("Continue saved workout") { WorkoutView() }
      }
    }.navigationTitle("Programme").navigationDestination(isPresented: $opened) { WorkoutView() }
  }
}
struct WorkoutView: View {
  @Environment(JournalStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var selected: JSONValue?
  @State private var finishing = false
  var workout: JSONValue { store.state["activeWorkout"] }
  var body: some View {
    List {
      Section {
        Text(workout["title"].string).font(.title2.bold())
        Text(workout["date"].string).font(.caption).foregroundStyle(.secondary)
      }
      ForEach(workout["exercises"].array) { exercise in
        Section(store.exerciseName(exercise["exerciseId"].string)) {
          if !exercise["coachCue"].string.isEmpty {
            Text(exercise["coachCue"].string).font(.subheadline).foregroundStyle(.secondary)
          }
          ForEach(Array(exercise["sets"].array.enumerated()), id: \.element.id) { index, set in
            HStack {
              Text("\(index + 1)").foregroundStyle(.secondary).frame(width: 24)
              Text("\(set["weight"].string) kg × \(set["reps"].string)").monospacedDigit()
              Spacer()
              Image(
                systemName: set["result"].string == "success"
                  ? "checkmark.circle.fill"
                  : set["result"].string == "miss" ? "xmark.circle" : "circle"
              ).foregroundStyle(set["result"].string == "miss" ? .orange : Color.liftTeal)
            }
          }
          Button("Log next set", systemImage: "plus.circle") { selected = exercise }.disabled(
            !store.canSave)
          NavigationLink("Technique & video") {
            ExerciseGuide(
              exercise: store.exercises.first { $0.id == exercise["exerciseId"].string } ?? .null)
          }
        }
      }
      Section {
        Button("Finish workout", systemImage: "checkmark.circle.fill") { finishing = true }
          .disabled(!store.canSave)
      }
    }.navigationTitle("Workout").navigationBarTitleDisplayMode(.inline)
      .sheet(item: $selected) { exercise in NavigationStack { SetForm(exercise: exercise) } }
      .confirmationDialog(
        "Finish and save this workout?", isPresented: $finishing, titleVisibility: .visible
      ) {
        Button("Finish workout") {
          Task {
            do {
              try await store.saveAction(json(["kind": s("finish_workout")]))
              dismiss()
            } catch { store.handle(error) }
          }
        }
      } message: {
        Text("Only logged sets are included in your history.")
      }
  }
}
struct SetForm: View {
  @Environment(JournalStore.self) private var store
  let exercise: JSONValue
  @State private var weight: String
  @State private var reps: String
  @State private var rpe = ""
  @State private var result = "success"
  init(exercise: JSONValue) {
    self.exercise = exercise
    let next =
      exercise["sets"].array.first { $0["result"].string.isEmpty } ?? exercise["sets"].array.last
      ?? .null
    _weight = State(initialValue: next["weight"].string)
    _reps = State(initialValue: next["reps"].string)
  }
  var body: some View {
    Form {
      Section {
        Text(store.exerciseName(exercise["exerciseId"].string)).font(.headline)
        NumberRow(title: "Weight · kg", value: $weight)
        NumberRow(title: "Repetitions", value: $reps)
        NumberRow(title: "RPE · optional", value: $rpe)
        Picker("Result", selection: $result) {
          Text("Made").tag("success")
          Text("Miss").tag("miss")
        }.pickerStyle(.segmented)
      }
    }
    .modifier(
      FormSave(title: "Log set") {
        var set: [String: JSONValue] = [
          "weight": try checkedNumber(weight, name: "weight"),
          "reps": try checkedNumber(reps, name: "reps"), "result": s(result),
        ]
        if !rpe.isEmpty { set["rpe"] = try checkedNumber(rpe, name: "rpe") }
        try await store.saveAction(
          json([
            "kind": s("log_sets"), "exerciseId": s(exercise["exerciseId"].string),
            "sets": .array([json(set)]),
          ]))
      })
  }
}
struct ExerciseLibraryView: View {
  @Environment(JournalStore.self) private var store
  @State private var search = ""
  var body: some View {
    List(
      store.exercises.filter {
        search.isEmpty || $0["name"].string.localizedCaseInsensitiveContains(search)
      }
    ) { exercise in NavigationLink(exercise["name"].string) { ExerciseGuide(exercise: exercise) } }
    .navigationTitle("Exercise guides").searchable(text: $search)
  }
}
struct ExerciseGuide: View {
  let exercise: JSONValue
  var body: some View {
    List {
      Text(exercise["purpose"].string)
      Section("Technique cues") { ForEach(exercise["cues"].array, id: \.self) { Text($0.string) } }
      if exercise["videoId"].string.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression)
        != nil,
        let url = URL(string: "https://www.youtube.com/watch?v=\(exercise["videoId"].string)")
      {
        Link(destination: url) {
          Label("Watch technique video", systemImage: "play.rectangle.fill")
        }
      }
    }.navigationTitle(exercise["name"].string).navigationBarTitleDisplayMode(.inline)
  }
}
