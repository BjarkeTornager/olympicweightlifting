import LiftAPI
import SwiftUI

/// Train: what to do now (the ongoing workout or the next session), the
/// programmes, and every past session in full.
struct TrainView: View {
  @Environment(AppModel.self) private var app
  @State private var train = TrainModel()
  @State private var editing: ProgrammeEditorTarget?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        if let training = train.training {
          hero(training)
          programmes(training)
          recent(training)
        } else if train.loading {
          ProgressView().frame(maxWidth: .infinity, minHeight: 300)
        } else {
          ContentUnavailableView(
            "Train isn't available", systemImage: "wifi.slash",
            description: Text(train.error ?? "Pull down to try again."))
        }
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 12)
    }
    .navigationTitle("Train")
    .navigationDestination(for: WorkoutRoute.self) { route in
      switch route {
      case .active: WorkoutView(train: train)
      case .session(let id): SessionView(id: id)
      case .programme(let id): ProgrammeView(train: train, id: id, editing: $editing)
      }
    }
    .refreshable { await train.load(app) }
    .task { if train.training == nil { await train.load(app) } }
    .onChange(of: app.today?.revision) { _, _ in Task { await train.load(app) } }
    .sheet(item: $editing) { target in
      ProgrammeEditor(train: train, target: target)
    }
  }

  // MARK: Now

  @ViewBuilder
  private func hero(_ training: Training) -> some View {
    if let workout = training.activeWorkout {
      let logged = workout.exercises.flatMap(\.sets).filter(\.logged).count
      let total = workout.exercises.flatMap(\.sets).count
      VStack(alignment: .leading, spacing: 14) {
        Text("IN PROGRESS").font(.caption.weight(.bold)).foregroundStyle(.orange)
        Text(workout.title).font(.title2.weight(.bold))
        ProgressView(value: Double(logged), total: Double(max(total, 1))) {
          Text("\(logged) of \(total) sets").font(.subheadline).foregroundStyle(.secondary)
        }
        .tint(.orange)
        NavigationLink(value: WorkoutRoute.active) {
          Text("Continue Workout")
        }
        .buttonStyle(PrimaryButtonStyle())
      }
      .card(padding: 20)
    } else if let next = training.next {
      let programme = training.programmes.first { $0.id == next.programmeId }
      let day = programme?.days.first { $0.id == next.dayId }
      VStack(alignment: .leading, spacing: 14) {
        Text("NEXT · \(next.programmeName.uppercased())")
          .font(.caption.weight(.bold)).foregroundStyle(.tint)
        Text(next.title).font(.title2.weight(.bold))
        if let day {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(day.exercises.prefix(5), id: \.exerciseId) { exercise in
              HStack {
                Text(exercise.name)
                Spacer()
                Text(exercise.text).foregroundStyle(.secondary).font(.subheadline)
              }
            }
            if day.exercises.count > 5 {
              Text("+ \(day.exercises.count - 5) more").font(.subheadline).foregroundStyle(.secondary)
            }
          }
        }
        Text("Session \(next.position) of \(next.count)").font(.footnote).foregroundStyle(.secondary)
        Button("Start Workout") { Task { await train.start(next, app) } }
          .buttonStyle(PrimaryButtonStyle())
          .disabled(!next.canStart)
      }
      .card(padding: 20)
    }
  }

  // MARK: Programmes

  private func programmes(_ training: Training) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeading(title: "Programmes") {
        Button("New", systemImage: "plus") { editing = .new }
          .labelStyle(.titleAndIcon)
          .font(.subheadline.weight(.semibold))
      }
      ScrollView(.horizontal) {
        HStack(spacing: 14) {
          ForEach(training.programmes, id: \.id) { programme in
            NavigationLink(value: WorkoutRoute.programme(programme.id)) {
              ProgrammeCard(programme: programme)
            }
            .buttonStyle(.plain)
          }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 2)
      }
      .scrollIndicators(.hidden)
      .scrollClipDisabled()
    }
  }

  // MARK: History

  private func recent(_ training: Training) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeading("Recent Sessions")
      if training.recent.isEmpty {
        Text("Finished workouts appear here with every set.")
          .foregroundStyle(.secondary)
      } else {
        VStack(spacing: 0) {
          ForEach(Array(training.recent.enumerated()), id: \.element.id) { index, session in
            NavigationLink(value: WorkoutRoute.session(session.id)) {
              HStack(spacing: 14) {
                IconBadge(symbol: "figure.strengthtraining.olympic", tint: .blue, size: 36)
                VStack(alignment: .leading, spacing: 2) {
                  Text(session.title).font(.body.weight(.semibold)).foregroundStyle(.primary)
                  Text(
                    [
                      JournalView.heading(session.date),
                      "\(session.loggedSets) \(session.loggedSets == 1 ? "set" : "sets")", session.topSet,
                    ]
                      .compactMap { $0 }.joined(separator: " · ")
                  )
                  .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
              }
              .padding(.vertical, 12)
              .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if index < training.recent.count - 1 { Divider().padding(.leading, 50) }
          }
        }
      }
    }
  }
}

enum WorkoutRoute: Hashable {
  case active
  case session(String)
  case programme(String)
}

private struct ProgrammeCard: View {
  let programme: Programme

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Image("tab-train-fill")
          .renderingMode(.template)
          .foregroundStyle(programme.active ? Color.accentColor : .secondary)
        Spacer()
        if programme.active {
          Text("Following")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Color.accentColor.opacity(0.12), in: .capsule)
            .foregroundStyle(.tint)
        }
      }
      Text(programme.name).font(.headline).lineLimit(2).foregroundStyle(.primary)
      Text("\(programme.days.count) \(programme.days.count == 1 ? "day" : "days")\(programme.builtIn ? " · Built in" : "")")
        .font(.subheadline).foregroundStyle(.secondary)
    }
    .frame(width: 200, height: 118, alignment: .topLeading)
    .card()
  }
}
