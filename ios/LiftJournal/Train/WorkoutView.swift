import LiftAPI
import SwiftUI

/// The ongoing workout. Each exercise shows its sets; the next planned set is
/// ready to log as Made or Miss with its weight and reps, logged sets can be
/// corrected, and a rest timer starts after each set.
struct WorkoutView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let train: TrainModel
  @State private var correcting: Correction?
  @State private var adding = false
  @State private var confirmingFinish = false
  @State private var restUntil: Date?

  struct Correction: Identifiable {
    let exercise: Components.Schemas.WorkoutExercise
    let set: Components.Schemas.WorkoutSet
    var id: String { self.set.id }
  }

  private var workout: WorkoutDetail? { train.training?.activeWorkout }

  var body: some View {
    Group {
      if let workout {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            header(workout)
            ForEach(workout.exercises, id: \.entryId) { exercise in
              ExerciseCard(exercise: exercise, busy: train.busySet == exercise.entryId) { weight, reps, made in
                Task {
                  await train.log(exercise: exercise, weight: weight, reps: reps, made: made, app)
                  restUntil = .now.addingTimeInterval(120)
                }
              } correct: { set in
                correcting = Correction(exercise: exercise, set: set)
              }
            }
            Button {
              adding = true
            } label: {
              Label("Add Exercise", systemImage: "plus")
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 14))
          }
          .padding(.horizontal, 20)
          .padding(.vertical, 12)
        }
        .safeAreaInset(edge: .bottom) {
          if let restUntil { RestTimer(until: restUntil) { self.restUntil = $0 } }
        }
        .navigationTitle(workout.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Finish") { confirmingFinish = true }
              .fontWeight(.semibold)
          }
          ToolbarItem(placement: .topBarTrailing) {
            Menu {
              Button("Discard Workout", systemImage: "trash", role: .destructive) {
                Task {
                  await train.discard(app)
                  dismiss()
                }
              }
              .disabled(workout.exercises.flatMap(\.sets).contains(where: \.logged))
            } label: {
              Label("More", systemImage: "ellipsis")
            }
          }
        }
        .confirmationDialog("Finish this workout?", isPresented: $confirmingFinish, titleVisibility: .visible) {
          Button("Finish Workout") {
            Task {
              await train.finish(app)
              dismiss()
            }
          }
        } message: {
          Text("Logged sets are saved to your history. Planned sets you didn't log are left out.")
        }
        .sheet(item: $correcting) { correction in
          SetEditor(
            title: correction.exercise.name, weight: correction.set.weight ?? 0,
            reps: correction.set.reps ?? 1, made: correction.set.result != "miss", saveTitle: "Save"
          ) { weight, reps, made in
            Task {
              await train.correct(
                workout: workout, exercise: correction.exercise, set: correction.set, weight: weight, reps: reps,
                made: made, app)
            }
          }
        }
        .sheet(isPresented: $adding) {
          AddExerciseSheet(exercises: train.training?.exercises ?? []) { exerciseId, weight, reps, made in
            Task {
              await train.run(
                .logSets(
                  .init(
                    kind: .logSets, exerciseId: exerciseId,
                    sets: [.init(weight: weight, reps: reps, result: made ? .success : .miss)])), app)
            }
          }
        }
      } else {
        ContentUnavailableView("No workout in progress", systemImage: "figure.strengthtraining.olympic")
      }
    }
    .sensoryFeedback(.success, trigger: app.saves)
  }

  private func header(_ workout: WorkoutDetail) -> some View {
    let sets = workout.exercises.flatMap(\.sets)
    let logged = sets.filter(\.logged).count
    return VStack(alignment: .leading, spacing: 8) {
      Text(JournalView.heading(workout.date)).font(.subheadline).foregroundStyle(.secondary)
      ProgressView(value: Double(logged), total: Double(max(sets.count, 1))) {
        Text("\(logged) of \(sets.count) sets logged").font(.subheadline.weight(.medium))
      }
      .tint(.accentColor)
    }
  }
}

/// One exercise: its sets, and the next planned set ready to log.
private struct ExerciseCard: View {
  let exercise: Components.Schemas.WorkoutExercise
  let busy: Bool
  let log: (Double, Int, Bool) -> Void
  let correct: (Components.Schemas.WorkoutSet) -> Void

  @State private var weight: Double = 0
  @State private var reps: Int = 1

  private var next: Components.Schemas.WorkoutSet? { exercise.sets.first { !$0.logged } }
  private var lastLogged: Components.Schemas.WorkoutSet? { exercise.sets.last(where: \.logged) }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text(exercise.name).font(.headline)
        if let target = exercise.target {
          Text(target).font(.subheadline).foregroundStyle(.secondary)
        }
      }
      VStack(spacing: 0) {
        ForEach(Array(exercise.sets.enumerated()), id: \.element.id) { index, set in
          SetRow(number: index + 1, set: set, isNext: set.id == next?.id)
            .contentShape(.rect)
            .onTapGesture { if set.logged { correct(set) } }
          if index < exercise.sets.count - 1 { Divider() }
        }
      }
      if next != nil || exercise.sets.allSatisfy(\.logged) {
        logger
      }
    }
    .card()
    .onAppear(perform: prefill)
    .onChange(of: exercise.sets.filter(\.logged).count) { _, _ in prefill() }
  }

  private var logger: some View {
    VStack(spacing: 10) {
      HStack(spacing: 12) {
        NumberStepper(label: "kg", value: $weight, step: 2.5, range: 0...1000, fraction: true)
        NumberStepper(
          label: "reps", value: Binding(get: { Double(reps) }, set: { reps = Int($0) }), step: 1, range: 1...100,
          fraction: false)
      }
      HStack(spacing: 10) {
        Button {
          log(weight, reps, false)
        } label: {
          Label("Miss", systemImage: "xmark").frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .tint(.red)
        Button {
          log(weight, reps, true)
        } label: {
          Group {
            if busy {
              ProgressView().tint(.white)
            } else {
              Label(next == nil ? "Add Set" : "Made", systemImage: "checkmark")
            }
          }
          .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.borderedProminent)
      }
      .disabled(busy)
      .buttonBorderShape(.roundedRectangle(radius: 12))
    }
  }

  /// The next set starts from its plan, or from the last logged set.
  private func prefill() {
    let source = next.flatMap { $0.weight != nil ? $0 : nil } ?? lastLogged ?? next
    weight = source?.weight ?? 0
    reps = source?.reps ?? next?.reps ?? 1
  }
}

private struct SetRow: View {
  let number: Int
  let set: Components.Schemas.WorkoutSet
  let isNext: Bool

  var body: some View {
    HStack {
      Text("\(number)")
        .font(.subheadline.weight(.semibold).monospacedDigit())
        .foregroundStyle(.secondary)
        .frame(width: 24, alignment: .leading)
      Text(values)
        .font(.body.monospacedDigit())
        .foregroundStyle(set.logged ? .primary : .secondary)
      Spacer()
      if set.logged {
        Image(systemName: set.result == "miss" ? "xmark.circle.fill" : "checkmark.circle.fill")
          .foregroundStyle(set.result == "miss" ? .red : .green)
          .accessibilityLabel(set.result == "miss" ? "Missed" : "Made")
      } else if isNext {
        Text("Next").font(.caption.weight(.semibold)).foregroundStyle(.tint)
      }
    }
    .padding(.vertical, 9)
    .accessibilityElement(children: .combine)
  }

  private var values: String {
    let weight = set.weight.map { $0.formatted(.number.precision(.fractionLength(0...1))) + " kg" } ?? "Choose load"
    let reps = set.reps.map { "\($0)" } ?? "–"
    return "\(weight) × \(reps)"
  }
}

/// A value with − and + buttons and a field for typing it directly.
struct NumberStepper: View {
  let label: String
  @Binding var value: Double
  let step: Double
  let range: ClosedRange<Double>
  let fraction: Bool

  var body: some View {
    HStack(spacing: 0) {
      Button {
        value = max(range.lowerBound, value - step)
      } label: {
        Image(systemName: "minus").frame(width: 36, height: 40)
      }
      VStack(spacing: 0) {
        TextField(
          label, value: $value,
          format: .number.precision(.fractionLength(0...(fraction ? 2 : 0)))
        )
        .keyboardType(fraction ? .decimalPad : .numberPad)
        .multilineTextAlignment(.center)
        .font(.title3.weight(.semibold).monospacedDigit())
        Text(label).font(.caption2).foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity)
      Button {
        value = min(range.upperBound, value + step)
      } label: {
        Image(systemName: "plus").frame(width: 36, height: 40)
      }
    }
    .buttonStyle(.borderless)
    .padding(.vertical, 4)
    .background(Color(.tertiarySystemFill), in: .rect(cornerRadius: 12))
    .sensoryFeedback(.selection, trigger: value)
  }
}

/// Correct one logged set.
struct SetEditor: View {
  @Environment(\.dismiss) private var dismiss
  let title: String
  @State var weight: Double
  @State var reps: Int
  @State var made: Bool
  let saveTitle: String
  let save: (Double, Int, Bool) -> Void

  var body: some View {
    NavigationStack {
      Form {
        Section {
          NumberStepper(label: "kg", value: $weight, step: 2.5, range: 0...1000, fraction: true)
          NumberStepper(
            label: "reps", value: Binding(get: { Double(reps) }, set: { reps = Int($0) }), step: 1,
            range: 0...100, fraction: false)
          Picker("Result", selection: $made) {
            Text("Made").tag(true)
            Text("Missed").tag(false)
          }
          .pickerStyle(.segmented)
        }
      }
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button(saveTitle, role: .confirm) {
            save(weight, reps, made)
            dismiss()
          }
        }
      }
    }
    .presentationDetents([.medium])
  }
}

/// Pick an exercise and log its first set.
private struct AddExerciseSheet: View {
  @Environment(\.dismiss) private var dismiss
  let exercises: [Components.Schemas.ExerciseOption]
  let add: (String, Double, Int, Bool) -> Void
  @State private var chosen: (id: String, name: String)?

  var body: some View {
    NavigationStack {
      if let chosen {
        SetEditor(title: chosen.name, weight: 20, reps: 5, made: true, saveTitle: "Log Set") { weight, reps, made in
          add(chosen.id, weight, reps, made)
          dismiss()
        }
      } else {
        ExercisePicker(exercises: exercises) { id, name in chosen = (id, name) }
          .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel", role: .cancel) { dismiss() } }
          }
      }
    }
  }
}

/// A countdown between sets, above the tab bar.
private struct RestTimer: View {
  let until: Date
  let change: (Date?) -> Void

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      let left = max(0, Int(until.timeIntervalSince(context.date).rounded()))
      HStack(spacing: 14) {
        Image(systemName: left == 0 ? "bell.fill" : "timer")
          .foregroundStyle(left == 0 ? .orange : .accentColor)
          .symbolEffect(.bounce, value: left == 0)
        VStack(alignment: .leading, spacing: 0) {
          Text(left == 0 ? "Rest over" : "Rest").font(.caption).foregroundStyle(.secondary)
          Text(Duration.seconds(left).formatted(.time(pattern: .minuteSecond)))
            .font(.title3.weight(.semibold).monospacedDigit())
        }
        Spacer()
        Button("+30 s") { change(until.addingTimeInterval(30)) }
          .buttonStyle(.bordered)
        Button("Done", systemImage: "xmark") { change(nil) }
          .labelStyle(.iconOnly)
          .buttonStyle(.bordered)
      }
      .padding(.horizontal, 16)
      .padding(.vertical, 10)
      .glassEffect(.regular, in: .rect(cornerRadius: 22))
      .padding(.horizontal, 16)
      .padding(.bottom, 8)
      .sensoryFeedback(.warning, trigger: left == 0)
    }
  }
}
