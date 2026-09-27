import Foundation
import LiftAPI
import Observation

typealias Training = Components.Schemas.Training
typealias WorkoutDetail = Components.Schemas.WorkoutDetail
typealias Programme = Components.Schemas.Programme

/// Train's state: programmes, the ongoing workout and recent sessions. Every
/// change is a journal action through the app's queue, then Train reloads.
@Observable
final class TrainModel {
  var training: Training?
  var loading = false
  var error: String?
  /// The set currently being saved, so its button can show progress.
  var busySet: String?

  func load(_ app: AppModel) async {
    loading = true
    defer { loading = false }
    do {
      training = try await app.client.getTraining(query: .init(date: JournalDay.string(.now))).value()
      error = nil
    } catch {
      self.error = await app.handle(error)
    }
  }

  /// Save one action, then reload Train and Today.
  func run(_ action: NativeAction, _ app: AppModel) async {
    await app.save(action)
    await load(app)
  }

  func start(_ next: Components.Schemas.NextTraining, _ app: AppModel) async {
    let today = JournalDay.string(.now)
    if next.builtIn {
      await run(.startProgramme(.init(kind: .startProgramme, dayId: next.dayId, date: today)), app)
    } else {
      await run(
        .startTrainingDay(
          .init(kind: .startTrainingDay, trainingProgramId: next.programmeId, dayId: next.dayId, date: today)),
        app)
    }
  }

  func start(day: Components.Schemas.ProgrammeDay, of programme: Programme, _ app: AppModel) async {
    let today = JournalDay.string(.now)
    if programme.builtIn {
      await run(.startProgramme(.init(kind: .startProgramme, dayId: day.id, date: today)), app)
    } else {
      await run(
        .startTrainingDay(
          .init(kind: .startTrainingDay, trainingProgramId: programme.id, dayId: day.id, date: today)),
        app)
    }
  }

  /// Made or missed: fills the exercise's next planned set.
  func log(
    exercise: Components.Schemas.WorkoutExercise, weight: Double, reps: Int, made: Bool, _ app: AppModel
  ) async {
    busySet = exercise.entryId
    defer { busySet = nil }
    await run(
      .logSets(
        .init(
          kind: .logSets, exerciseId: exercise.exerciseId,
          sets: [.init(weight: weight, reps: reps, result: made ? .success : .miss)])), app)
  }

  func correct(
    workout: WorkoutDetail, exercise: Components.Schemas.WorkoutExercise, set: Components.Schemas.WorkoutSet,
    weight: Double, reps: Int, made: Bool, _ app: AppModel
  ) async {
    await run(
      .correctWorkoutSet(
        .init(
          kind: .correctWorkoutSet, workoutId: workout.id, entryId: exercise.entryId, setId: set.id,
          setChanges: .init(weight: weight, reps: reps, result: made ? .success : .miss))), app)
  }

  func finish(_ app: AppModel) async {
    await run(.finishWorkout(.init(kind: .finishWorkout)), app)
  }

  func discard(_ app: AppModel) async {
    await run(.discardWorkout(.init(kind: .discardWorkout)), app)
  }

  func follow(_ programme: Programme, _ app: AppModel) async {
    await run(.useProgramme(.init(kind: .useProgramme, programmeId: programme.id)), app)
  }

  func save(_ input: Components.Schemas.ProgrammeInput, editing: Programme?, _ app: AppModel) async {
    if let editing {
      await run(
        .updateTrainingProgram(
          .init(kind: .updateTrainingProgram, trainingProgramId: editing.id, programChanges: input)), app)
    } else {
      await run(.createTrainingProgram(.init(kind: .createTrainingProgram, trainingProgram: input)), app)
    }
  }

  func delete(_ programme: Programme, _ app: AppModel) async {
    await run(.deleteTrainingProgram(.init(kind: .deleteTrainingProgram, trainingProgramId: programme.id)), app)
  }
}
