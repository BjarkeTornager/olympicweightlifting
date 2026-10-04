import LiftAPI
import SwiftUI

/// Which programme the editor is for: a new one, or one to change.
enum ProgrammeEditorTarget: Identifiable {
  case new
  case edit(Programme)

  var id: String {
    switch self {
    case .new: "new"
    case .edit(let programme): programme.id
    }
  }
}

/// Build or change a programme: its name, days, and each day's exercises
/// with sets, reps and an optional load.
struct ProgrammeEditor: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let train: TrainModel
  let target: ProgrammeEditorTarget
  @State private var draft: Draft
  @State private var saving = false

  init(train: TrainModel, target: ProgrammeEditorTarget) {
    self.train = train
    self.target = target
    switch target {
    case .new: _draft = State(initialValue: Draft())
    case .edit(let programme): _draft = State(initialValue: Draft(programme))
    }
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Name", text: $draft.name)
          TextField("Notes", text: $draft.notes, axis: .vertical)
            .lineLimit(1...4)
          Stepper(value: $draft.weeks, in: 0...104) {
            LabeledContent("Weeks", value: draft.weeks == 0 ? "Not set" : "\(draft.weeks)")
          }
        }
        .themedRows()
        Section {
          ForEach($draft.days) { $day in
            NavigationLink {
              DayEditor(day: $day, exercises: train.training?.exercises ?? [])
            } label: {
              VStack(alignment: .leading, spacing: 2) {
                Text(day.name.isEmpty ? "Untitled day" : day.name)
                Text(day.summary).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
              }
            }
          }
          .onDelete { draft.days.remove(atOffsets: $0) }
          .onMove { draft.days.move(fromOffsets: $0, toOffset: $1) }
          Button("Add Day", systemImage: "plus") {
            draft.days.append(Draft.Day(name: "Day \(draft.days.count + 1)"))
          }
          .disabled(draft.days.count >= 28)
        } header: {
          Text("Days")
        } footer: {
          Text("Leave a load empty to choose it when you train.")
        }
        .themedRows()
      }
      .themedList()
      .navigationTitle(isNew ? "New Programme" : "Edit Programme")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save", role: .confirm) { Task { await save() } }
            .disabled(!draft.valid || saving)
        }
      }
      .interactiveDismissDisabled(saving)
    }
  }

  private var isNew: Bool {
    if case .new = target { return true }
    return false
  }

  private func save() async {
    saving = true
    defer { saving = false }
    let editing: Programme? = if case .edit(let programme) = target { programme } else { nil }
    await train.save(draft.input, editing: editing, app)
    dismiss()
  }
}

/// A day's name and exercises.
private struct DayEditor: View {
  @Binding var day: ProgrammeEditor.Draft.Day
  let exercises: [Components.Schemas.ExerciseOption]
  @State private var picking = false

  var body: some View {
    Form {
      Section {
        TextField("Name", text: $day.name)
        TextField("Notes", text: $day.notes, axis: .vertical).lineLimit(1...4)
      }
      .themedRows()
      Section("Exercises") {
        ForEach($day.exercises) { $exercise in
          ExerciseEditor(exercise: $exercise)
        }
        .onDelete { day.exercises.remove(atOffsets: $0) }
        .onMove { day.exercises.move(fromOffsets: $0, toOffset: $1) }
        Button("Add Exercise", systemImage: "plus") { picking = true }
          .disabled(day.exercises.count >= 30)
      }
      .themedRows()
    }
    .themedList()
    .navigationTitle(day.name.isEmpty ? "Day" : day.name)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { EditButton() }
    .sheet(isPresented: $picking) {
      NavigationStack {
        ExercisePicker(exercises: exercises) { id, name in
          day.exercises.append(.init(exerciseId: id, name: name))
          picking = false
        }
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { picking = false } }
        }
      }
    }
  }
}

/// Sets, reps and load for one planned exercise.
private struct ExerciseEditor: View {
  @Binding var exercise: ProgrammeEditor.Draft.Exercise

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(exercise.name).font(.headline)
      HStack(spacing: 10) {
        NumberStepper(
          label: "sets", value: Binding(get: { Double(exercise.sets) }, set: { exercise.sets = Int($0) }),
          step: 1, range: 1...30, fraction: false)
        NumberStepper(
          label: "reps", value: Binding(get: { Double(exercise.reps) }, set: { exercise.reps = Int($0) }),
          step: 1, range: 1...100, fraction: false)
      }
      Toggle("Set a load", isOn: $exercise.hasWeight)
      if exercise.hasWeight {
        NumberStepper(label: "kg", value: $exercise.weight, step: 2.5, range: 0...1000, fraction: true)
      }
    }
    .padding(.vertical, 4)
  }
}

/// Every exercise the journal knows, searchable and grouped by kind, the
/// athlete's own first, and any other name typed, to add as their own.
struct ExercisePicker: View {
  let exercises: [Components.Schemas.ExerciseOption]
  let pick: (String, String) -> Void
  @State private var query = ""

  static let own = "Your exercises"

  private static func keys(_ e: Components.Schemas.ExerciseOption) -> [String] {
    ([e.name] + (e.aliases ?? [])).map(ExerciseName.key)
  }

  private var groups: [(String, [Components.Schemas.ExerciseOption])] {
    let words = ExerciseName.key(query).split(separator: " ")
    let shown = exercises.filter { e in
      let names = Self.keys(e)
      return words.allSatisfy { word in names.contains { $0.contains(word) } }
    }
    let grouped = Dictionary(grouping: shown, by: \.category)
    return grouped.keys.sorted { ($0 == Self.own ? 0 : 1, $0) < ($1 == Self.own ? 0 : 1, $1) }
      .map { ($0, grouped[$0]!) }
  }

  /// The typed name as a new exercise, unless an exercise already has it.
  private var newName: String? {
    guard let name = ExerciseName.tidy(query) else { return nil }
    let key = ExerciseName.key(name)
    return exercises.contains { Self.keys($0).contains(key) } ? nil : name
  }

  var body: some View {
    List {
      ForEach(groups, id: \.0) { category, options in
        Section(category.capitalized) {
          ForEach(options, id: \.id) { option in
            Button(option.name) { pick(option.id, option.name) }
              .foregroundStyle(.primary)
          }
        }
        .themedRows()
      }
      if let newName {
        Section {
          Button("Add “\(newName)” as a new exercise", systemImage: "plus") {
            pick("custom:" + newName, newName)
          }
        } footer: {
          Text("It becomes your own exercise, kept in your journal, not added to the library.")
        }
        .themedRows()
      }
    }
    .themedList()
    .overlay {
      if groups.isEmpty && newName == nil { ContentUnavailableView.search(text: query) }
    }
    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Find an exercise")
    .navigationTitle("Exercises")
    .navigationBarTitleDisplayMode(.inline)
  }
}

extension ProgrammeEditor {
  /// The editor's working copy, turned into a ProgrammeInput on save.
  struct Draft {
    var name = ""
    var notes = ""
    var weeks = 0
    var days: [Day] = [Day(name: "Day 1")]

    struct Day: Identifiable {
      let id: String
      var serverId: String?
      var name: String
      var notes = ""
      var exercises: [Exercise] = []

      init(name: String) {
        id = UUID().uuidString
        self.name = name
      }

      var summary: String {
        exercises.isEmpty
          ? "No exercises yet"
          : exercises.map { "\($0.name) \($0.sets)×\($0.reps)" }.joined(separator: ", ")
      }
    }

    struct Exercise: Identifiable {
      let id = UUID()
      var exerciseId: String
      var name: String
      var sets = 3
      var reps = 3
      var repsMax: Int?
      var hasWeight = false
      var weight: Double = 0
      var restSeconds: Int?
      var targetRpe: Double?
      var notes: String?
    }

    init() {}

    init(_ programme: Programme) {
      name = programme.name
      notes = programme.notes ?? ""
      weeks = programme.weeks ?? 0
      days = programme.days.map { day in
        var draft = Day(name: day.name)
        draft.serverId = day.id
        draft.notes = day.notes ?? ""
        draft.exercises = day.exercises.map { e in
          Exercise(
            exerciseId: e.exerciseId, name: e.name, sets: e.sets, reps: e.reps, repsMax: e.repsMax,
            hasWeight: e.weight != nil, weight: e.weight ?? 0, restSeconds: e.restSeconds,
            targetRpe: e.targetRpe, notes: e.notes)
        }
        return draft
      }
    }

    var valid: Bool {
      !name.trimmingCharacters(in: .whitespaces).isEmpty && !days.isEmpty
        && days.allSatisfy { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    var input: Components.Schemas.ProgrammeInput {
      .init(
        name: name.trimmingCharacters(in: .whitespaces),
        notes: notes.isEmpty ? nil : notes,
        weeks: weeks == 0 ? nil : weeks,
        days: days.map { day in
          .init(
            id: day.serverId,
            name: day.name.trimmingCharacters(in: .whitespaces),
            notes: day.notes.isEmpty ? nil : day.notes,
            exercises: day.exercises.map { e in
              .init(
                exerciseId: e.exerciseId, sets: e.sets, reps: e.reps,
                repsMax: e.repsMax.flatMap { $0 >= e.reps ? $0 : nil },
                weight: e.hasWeight ? e.weight : nil, restSeconds: e.restSeconds,
                targetRpe: e.targetRpe, notes: e.notes)
            })
        })
    }
  }
}
