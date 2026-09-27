import LiftAPI
import SwiftUI

/// One programme: its days and exercises, with Start on each day. The
/// athlete's own programmes can be edited, followed or deleted; the built-in
/// one can be followed.
struct ProgrammeView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  let train: TrainModel
  let id: String
  @Binding var editing: ProgrammeEditorTarget?
  @State private var confirmingDelete = false

  private var programme: Programme? { train.training?.programmes.first { $0.id == id } }
  private var busy: Bool { train.training?.activeWorkout != nil }

  var body: some View {
    Group {
      if let programme {
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            header(programme)
            ForEach(Array(programme.days.enumerated()), id: \.element.id) { index, day in
              DayCard(number: index + 1, day: day, canStart: !busy) {
                Task { await train.start(day: day, of: programme, app) }
              }
            }
          }
          .padding(.horizontal, 20)
          .padding(.vertical, 12)
        }
        .navigationTitle(programme.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          if !programme.builtIn {
            ToolbarItem(placement: .topBarTrailing) {
              Menu {
                Button("Edit Programme", systemImage: "pencil") { editing = .edit(programme) }
                Button("Delete Programme", systemImage: "trash", role: .destructive) {
                  confirmingDelete = true
                }
              } label: {
                Label("More", systemImage: "ellipsis")
              }
            }
          }
        }
        .confirmationDialog(
          "Delete \(programme.name)?", isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
          Button("Delete Programme", role: .destructive) {
            Task {
              await train.delete(programme, app)
              dismiss()
            }
          }
        } message: {
          Text("Sessions you already trained stay in your history.")
        }
      } else {
        ContentUnavailableView("Programme not found", systemImage: "list.bullet.rectangle")
      }
    }
  }

  private func header(_ programme: Programme) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(programme.name).font(.largeTitle.weight(.bold))
      Text(
        [
          "\(programme.days.count) \(programme.days.count == 1 ? "day" : "days")",
          programme.weeks.map { "\($0) \($0 == 1 ? "week" : "weeks")" },
          programme.builtIn ? "Built in" : nil,
        ].compactMap { $0 }.joined(separator: " · ")
      )
      .foregroundStyle(.secondary)
      if let notes = programme.notes, !notes.isEmpty {
        Text(notes).font(.subheadline)
      }
      if programme.active {
        Label("You're following this programme", systemImage: "checkmark.circle.fill")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(.tint)
      } else {
        Button("Follow This Programme") { Task { await train.follow(programme, app) } }
          .buttonStyle(PrimaryButtonStyle())
      }
      if busy {
        Text("Finish or discard the workout in progress to start another day.")
          .font(.footnote).foregroundStyle(.secondary)
      }
    }
  }
}

/// A day of a programme: its exercises with sets, reps and load, and Start.
private struct DayCard: View {
  let number: Int
  let day: Components.Schemas.ProgrammeDay
  let canStart: Bool
  let start: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 2) {
        Text("DAY \(number)").font(.caption.weight(.bold)).foregroundStyle(.tint)
        Text(day.name).font(.headline)
        if let notes = day.notes, !notes.isEmpty {
          Text(notes).font(.subheadline).foregroundStyle(.secondary)
        }
      }
      if !day.exercises.isEmpty {
        VStack(spacing: 8) {
          ForEach(Array(day.exercises.enumerated()), id: \.offset) { _, exercise in
            HStack(alignment: .firstTextBaseline) {
              Text(exercise.name)
              Spacer(minLength: 12)
              Text(exercise.text)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
            }
          }
        }
      }
      ForEach(day.cardio, id: \.self) { line in
        Label(line, systemImage: "figure.run").font(.subheadline).foregroundStyle(.secondary)
      }
      Button("Start Day \(number)", action: start)
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .disabled(!canStart || day.exercises.isEmpty)
    }
    .card()
  }
}
