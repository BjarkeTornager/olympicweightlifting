import LiftAPI
import LiftTheme
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
          VStack(alignment: .leading, spacing: Theme.Space.section) {
            header(programme)
            ForEach(Array(programme.days.enumerated()), id: \.element.id) { index, day in
              DaySection(number: index + 1, day: day, canStart: !busy) {
                Task { await train.start(day: day, of: programme, app) }
              }
            }
          }
          .padding(.horizontal, Theme.Space.gutter)
          .padding(.top, Theme.Space.s)
          .padding(.bottom, Theme.Space.l)
        }
        .background(Theme.background)
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
      Text(programme.name)
        .folio(.sectionTitle)
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
      Text(
        [
          "\(programme.days.count) \(programme.days.count == 1 ? "day" : "days")",
          programme.weeks.map { "\($0) \($0 == 1 ? "week" : "weeks")" },
          programme.builtIn ? "Built in" : nil,
        ].compactMap { $0 }.joined(separator: " · ")
      )
      .font(.subheadline)
      .foregroundStyle(Theme.inkSecondary)
      if let notes = programme.notes, !notes.isEmpty {
        Text(notes).font(.subheadline).foregroundStyle(Theme.ink)
      }
      if programme.active {
        Label("You're following this programme", systemImage: "checkmark")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(Theme.success)
      } else {
        Button("Follow This Programme") { Task { await train.follow(programme, app) } }
          .buttonStyle(PrimaryButtonStyle())
      }
      if busy {
        Text("Finish or discard the workout in progress to start another day.")
          .font(.footnote).foregroundStyle(Theme.inkSecondary)
      }
    }
  }
}

/// A day of a programme on its ink rule: its exercises with sets, reps and
/// load, any cardio, and Start.
private struct DaySection: View {
  let number: Int
  let day: Components.Schemas.ProgrammeDay
  let canStart: Bool
  let start: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Rectangle().fill(Theme.ink).frame(height: 1)
      Text("Day \(number)").label().padding(.top, 10)
      Text(day.name)
        .folio(.heading)
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 4)
      if let notes = day.notes, !notes.isEmpty {
        Text(notes).font(.subheadline).foregroundStyle(Theme.inkSecondary).padding(.top, 4)
      }
      if !day.exercises.isEmpty {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(day.exercises.enumerated()), id: \.offset) { index, exercise in
            if index > 0 { Hairline() }
            HStack(alignment: .firstTextBaseline) {
              Text(exercise.name).foregroundStyle(Theme.ink)
              Spacer(minLength: 12)
              Text(exercise.text)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(Theme.inkSecondary)
                .multilineTextAlignment(.trailing)
            }
            .padding(.vertical, 10)
            .accessibilityElement(children: .combine)
          }
        }
        .padding(.top, 8)
      }
      ForEach(day.cardio, id: \.self) { line in
        Label(line, systemImage: "figure.run")
          .font(.subheadline)
          .foregroundStyle(Theme.inkSecondary)
          .padding(.top, 6)
      }
      Button("Start Day \(number)", action: start)
        .buttonStyle(SecondaryButtonStyle())
        .disabled(!canStart || day.exercises.isEmpty)
        .padding(.top, 12)
    }
  }
}
