import LiftAPI
import LiftTheme
import SwiftUI

/// Train: what to do now (the ongoing workout or the next session), the
/// programmes, and every past session in full.
struct TrainView: View {
  @Environment(AppModel.self) private var app
  @State private var train = TrainModel()
  @State private var editing: ProgrammeEditorTarget?
  @State private var recentShown = 8

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        if let training = train.training {
          hero(training)
          progress(training)
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
      .padding(.horizontal, 16)
      .padding(.bottom, 24)
    }
    .background(Theme.background)
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
      VStack(alignment: .leading, spacing: 18) {
        HStack(spacing: 16) {
          ZStack {
            ProgressRing(progress: Double(logged) / Double(max(total, 1)), tint: Theme.attention, lineWidth: 8)
            Text("\(logged)/\(total)")
              .font(.system(.subheadline, design: .rounded, weight: .bold))
              .monospacedDigit()
          }
          .frame(width: 64, height: 64)
          VStack(alignment: .leading, spacing: 3) {
            Text("In progress").font(.caption.weight(.bold)).foregroundStyle(Theme.attention)
            Text(workout.title).font(.title2.weight(.bold))
            Text("\(logged) of \(total) sets logged").font(.subheadline).foregroundStyle(.secondary)
          }
        }
        NavigationLink(value: WorkoutRoute.active) {
          Label("Continue Workout", systemImage: "play.fill")
        }
        .buttonStyle(PrimaryButtonStyle())
      }
      .card()
    } else if let next = training.next {
      let programme = training.programmes.first { $0.id == next.programmeId }
      let day = programme?.days.first { $0.id == next.dayId }
      VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 12) {
          IconBadge(symbol: "dumbbell.fill", tint: Category.training.tint, size: 44)
          VStack(alignment: .leading, spacing: 1) {
            Text("Next · \(next.programmeName)")
              .font(.caption.weight(.bold)).foregroundStyle(Category.training.tint).lineLimit(1)
            Text(next.title).font(.title2.weight(.bold))
          }
        }
        SessionDots(position: next.position, count: next.count)
        if let day, !day.exercises.isEmpty {
          VStack(spacing: 10) {
            ForEach(Array(day.exercises.prefix(6).enumerated()), id: \.offset) { index, exercise in
              HStack(spacing: 12) {
                Text("\(index + 1)")
                  .font(.system(.caption, design: .rounded, weight: .bold))
                  .foregroundStyle(Category.training.tint)
                  .frame(width: 24, height: 24)
                  .background(Theme.fill, in: .circle)
                Text(exercise.name).font(.body.weight(.medium))
                Spacer(minLength: 8)
                Text(exercise.text)
                  .font(.system(.subheadline, design: .rounded))
                  .foregroundStyle(.secondary)
                  .monospacedDigit()
              }
            }
            if day.exercises.count > 6 {
              Text("+ \(day.exercises.count - 6) more")
                .font(.subheadline).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 36)
            }
          }
        }
        Button {
          Task { await train.start(next, app) }
        } label: {
          Label("Start Workout", systemImage: "play.fill")
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(!next.canStart)
      }
      .card()
    }
  }

  // MARK: Progress

  /// Bests and weeks are absent until the server that sends them has deployed.
  @ViewBuilder
  private func progress(_ training: Training) -> some View {
    let weeks = training.weeks ?? []
    let bests = training.bests ?? []
    if !weeks.isEmpty || !bests.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        SectionHeading("Progress").padding(.horizontal, 4)
        if let week = weeks.last {
          VStack(alignment: .leading, spacing: 14) {
            CardLabel(title: "This Week", symbol: "chart.bar.fill", tint: Category.training.tint)
            HStack {
              MiniValue(value: "\(week.sessions)", label: week.sessions == 1 ? "Session" : "Sessions")
              MiniValue(value: "\(week.sets)", label: "Sets")
              MiniValue(value: tonnes(week.tonnageKg), unit: "t", label: "Lifted")
            }
            Sparkline(values: weeks.map { $0.tonnageKg > 0 ? $0.tonnageKg : nil }, tint: Category.training.tint)
              .frame(height: 56)
            Text("Kilos lifted each week, last \(weeks.count) weeks")
              .font(.caption).foregroundStyle(.secondary)
          }
          .card()
        }
        if !bests.isEmpty {
          LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(bests, id: \.exerciseId) { best in
              BestTile(best: best)
            }
          }
        }
      }
    }
  }

  private func tonnes(_ kg: Double) -> String {
    (kg / 1000).formatted(.number.precision(.fractionLength(kg >= 10000 ? 0 : 1)))
  }

  // MARK: Programmes

  private func programmes(_ training: Training) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeading(title: "Programmes") {
        Button("New", systemImage: "plus") { editing = .new }
          .labelStyle(.titleAndIcon)
          .font(.subheadline.weight(.semibold))
      }
      .padding(.horizontal, 4)
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
      SectionHeading("Recent Sessions").padding(.horizontal, 4)
      if training.recent.isEmpty {
        Text("Finished workouts appear here with every set.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .card()
      } else {
        VStack(spacing: 0) {
          ForEach(Array(training.recent.prefix(recentShown).enumerated()), id: \.element.id) { index, session in
            NavigationLink(value: WorkoutRoute.session(session.id)) {
              HStack(spacing: 14) {
                DateBadge(day: session.date)
                VStack(alignment: .leading, spacing: 2) {
                  Text(session.title).font(.body.weight(.semibold)).foregroundStyle(.primary)
                  Text(
                    ["\(session.loggedSets) \(session.loggedSets == 1 ? "set" : "sets")", session.topSet]
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
            .buttonStyle(CardButtonStyle())
            if index < min(recentShown, training.recent.count) - 1 { Divider().padding(.leading, 58) }
          }
          if training.recent.count > recentShown {
            Divider()
            Button("Show All \(training.recent.count) Sessions") { recentShown = training.recent.count }
              .font(.subheadline.weight(.semibold))
              .frame(maxWidth: .infinity)
              .padding(.top, 12)
          }
        }
        .card(padding: 16)
      }
    }
  }
}

/// Where a session sits in its programme's cycle, as filled dots.
private struct SessionDots: View {
  let position: Int
  let count: Int

  var body: some View {
    HStack(spacing: 8) {
      HStack(spacing: 4) {
        ForEach(1...max(count, 1), id: \.self) { step in
          Capsule()
            .fill(step <= position ? Category.training.tint : Theme.track)
            .frame(width: step == position ? 22 : 12, height: 6)
        }
      }
      Text("Session \(position) of \(count)").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Session \(position) of \(count)")
  }
}

/// A main lift's heaviest made set.
private struct BestTile: View {
  let best: Components.Schemas.PersonalBest

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      CardLabel(title: best.name, symbol: "trophy.fill", tint: Theme.record)
      HStack(alignment: .firstTextBaseline, spacing: 3) {
        Text(best.weight.formatted())
          .font(.system(.title2, design: .rounded, weight: .bold))
          .monospacedDigit()
        Text("kg").font(.system(.footnote, design: .rounded, weight: .semibold)).foregroundStyle(.secondary)
      }
      Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card(padding: 14)
    .accessibilityElement(children: .combine)
  }

  private var detail: String {
    let when = best.date.flatMap { JournalDay.date($0) }.map { $0.formatted(.dateTime.day().month(.abbreviated)) }
    return [best.reps.map { "× \($0)" }, when ?? "Entered by you"].compactMap { $0 }.joined(separator: " · ")
  }
}

/// A session's date as a small calendar leaf.
private struct DateBadge: View {
  let day: String

  var body: some View {
    let date = JournalDay.date(day)
    VStack(spacing: 0) {
      Text(date?.formatted(.dateTime.month(.abbreviated)).uppercased() ?? "")
        .font(.system(size: 9, weight: .bold))
        .foregroundStyle(Category.training.tint)
      Text(date?.formatted(.dateTime.day()) ?? "–")
        .font(.system(.headline, design: .rounded, weight: .bold))
        .foregroundStyle(Color.primary)
    }
    .frame(width: 44, height: 44)
    .background(Theme.fill, in: .rect(cornerRadius: 11, style: .continuous))
    .accessibilityHidden(true)
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
          .foregroundStyle(programme.active ? Theme.accent : .secondary)
        Spacer()
        if programme.active {
          Text("Following")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.fill, in: .capsule)
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
