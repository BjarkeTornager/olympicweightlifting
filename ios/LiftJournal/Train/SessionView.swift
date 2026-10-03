import LiftAPI
import LiftTheme
import SwiftUI

/// A finished session in full: every exercise with each set as it was done.
struct SessionView: View {
  @Environment(AppModel.self) private var app
  let id: String
  @State private var workout: WorkoutDetail?
  @State private var error: String?

  var body: some View {
    Group {
      if let workout {
        List {
          Section {
            LabeledContent("Date", value: JournalView.heading(workout.date))
            LabeledContent("Sets logged", value: "\(workout.exercises.flatMap(\.sets).filter(\.logged).count)")
            if let notes = workout.notes, !notes.isEmpty {
              Text(notes).foregroundStyle(Theme.inkSecondary)
            }
          }
          .themedRows()
          ForEach(workout.exercises, id: \.entryId) { exercise in
            Section {
              ForEach(Array(exercise.sets.filter(\.logged).enumerated()), id: \.element.id) { index, set in
                HStack {
                  Text("\(index + 1)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.inkSecondary)
                    .frame(width: 24, alignment: .leading)
                  Text(Self.values(set)).monospacedDigit()
                  Spacer()
                  Image(systemName: set.result == "miss" ? "xmark.circle.fill" : "checkmark.circle.fill")
                    .foregroundStyle(set.result == "miss" ? Theme.danger : Theme.success)
                    .accessibilityLabel(set.result == "miss" ? "Missed" : "Made")
                }
                .accessibilityElement(children: .combine)
              }
              if let notes = exercise.notes, !notes.isEmpty {
                Text(notes).font(.footnote).foregroundStyle(Theme.inkSecondary)
              }
            } header: {
              Text(exercise.name)
            }
            .themedRows()
          }
        }
        .themedList()
        .navigationTitle(workout.title)
      } else if let error {
        ContentUnavailableView("Session unavailable", systemImage: "wifi.slash", description: Text(error))
      } else {
        ProgressView()
      }
    }
    .navigationBarTitleDisplayMode(.inline)
    .task(id: id) { await load() }
  }

  static func values(_ set: Components.Schemas.WorkoutSet) -> String {
    let weight = set.weight.map { Format.decimal($0) + " kg" } ?? "–"
    return "\(weight) × \(set.reps.map(String.init) ?? "–")"
  }

  private func load() async {
    do {
      workout = try await app.client.getWorkout(path: .init(id: id)).value()
      error = nil
    } catch {
      self.error = await app.handle(error)
    }
  }
}
