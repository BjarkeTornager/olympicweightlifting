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

  init(train: TrainModel = TrainModel()) {
    _train = State(initialValue: train)
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: Theme.Space.section) {
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
      .padding(.horizontal, Theme.Space.gutter)
      .padding(.top, 8)
      .padding(.bottom, Theme.Space.l)
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

  /// The workout in progress or the next session, set like the Ledger: a
  /// heavy rule, a kicker, the title in the serif, and its sets counted in
  /// marks.
  @ViewBuilder
  private func hero(_ training: Training) -> some View {
    if let workout = training.activeWorkout {
      let sets = workout.exercises.flatMap(\.sets)
      let logged = sets.filter(\.logged).count
      VStack(alignment: .leading, spacing: 0) {
        Rectangle().fill(Theme.ink).frame(height: 2)
        NavigationLink(value: WorkoutRoute.active) {
          VStack(alignment: .leading, spacing: 0) {
            HStack {
              CardLabel(title: "In progress", key: Category.training.tint)
              Spacer(minLength: 0)
              GoArrow()
            }
            Text(workout.title)
              .folio(.sectionTitle)
              .foregroundStyle(Theme.ink)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.top, 8)
            SetCount(logged: logged, total: sets.count).padding(.top, 10)
          }
          .padding(.top, 13)
          .contentShape(.rect)
        }
        .buttonStyle(CardButtonStyle())
        NavigationLink(value: WorkoutRoute.active) {
          Label("Continue Workout", systemImage: "play.fill")
        }
        .buttonStyle(PrimaryButtonStyle())
        .padding(.top, 18)
      }
    } else if let next = training.next {
      let programme = training.programmes.first { $0.id == next.programmeId }
      let day = programme?.days.first { $0.id == next.dayId }
      VStack(alignment: .leading, spacing: 0) {
        Rectangle().fill(Theme.ink).frame(height: 2)
        CardLabel(title: "Next · \(next.programmeName)", key: Category.training.tint).padding(.top, 13)
        Text(next.title)
          .folio(.sectionTitle)
          .foregroundStyle(Theme.ink)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 8)
        SessionDots(position: next.position, count: next.count).padding(.top, 10)
        if let day, !day.exercises.isEmpty {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(day.exercises.prefix(6).enumerated()), id: \.offset) { index, exercise in
              if index > 0 { Hairline() }
              HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("\(index + 1)")
                  .font(.footnote.weight(.semibold).monospacedDigit())
                  .foregroundStyle(Theme.inkSecondary)
                  .frame(minWidth: 18, alignment: .leading)
                Text(exercise.name).font(.body).foregroundStyle(Theme.ink)
                Spacer(minLength: 8)
                Text(exercise.text)
                  .font(.subheadline.monospacedDigit())
                  .foregroundStyle(Theme.inkSecondary)
                  .multilineTextAlignment(.trailing)
              }
              .padding(.vertical, 10)
              .accessibilityElement(children: .combine)
            }
            if day.exercises.count > 6 {
              Hairline()
              Text("And \(Format.count(day.exercises.count - 6)) more")
                .folio(.note)
                .foregroundStyle(Theme.inkSecondary)
                .padding(.vertical, 10)
            }
          }
          .padding(.top, 12)
        }
        Button {
          Task { await train.start(next, app) }
        } label: {
          Label("Start Workout", systemImage: "play.fill")
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(!next.canStart)
        .padding(.top, 16)
      }
    }
  }

  // MARK: Progress

  /// Bests and weeks are absent until the server that sends them has deployed.
  @ViewBuilder
  private func progress(_ training: Training) -> some View {
    let weeks = training.weeks ?? []
    let bests = training.bests ?? []
    if !weeks.isEmpty || !bests.isEmpty {
      VStack(alignment: .leading, spacing: 0) {
        FolioSection("Progress", meta: weeks.isEmpty ? nil : "This week")
        if let week = weeks.last {
          CellGrid(columns: 3) {
            MiniValue(value: Format.number(week.sessions), label: week.sessions == 1 ? "Session" : "Sessions")
            MiniValue(value: Format.number(week.sets), label: "Sets")
            MiniValue(value: tonnes(week.tonnageKg), unit: "t", label: "Lifted")
          }
          .padding(.top, 4)
          Sparkline(values: weeks.map { $0.tonnageKg > 0 ? $0.tonnageKg : nil }, tint: Category.training.tint)
            .frame(height: 56)
            .padding(.top, 8)
          Text(
            weeks.count == 1
              ? "Kilos lifted this week" : "Kilos lifted each week, the last \(Format.count(weeks.count)) weeks")
            .font(.footnote)
            .foregroundStyle(Theme.inkSecondary)
            .padding(.top, 8)
        }
        if !bests.isEmpty {
          Text("Personal bests")
            .foregroundStyle(Theme.ink)
            .kicker()
            .padding(.top, weeks.isEmpty ? 16 : 28)
          CellGrid {
            ForEach(bests, id: \.exerciseId) { best in
              BestCell(best: best)
            }
          }
          .overlay(alignment: .top) { Hairline() }
          .padding(.top, 10)
        }
      }
    }
  }

  private func tonnes(_ kg: Double) -> String {
    Format.decimal(kg / 1000, digits: kg >= 10000 ? 0 : 1)
  }

  // MARK: Programmes

  private func programmes(_ training: Training) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      FolioSection(title: "Programmes") {
        Button("New", systemImage: "plus") { editing = .new }
          .labelStyle(.titleAndIcon)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(Theme.accent)
      }
      ScrollView(.horizontal) {
        HStack(alignment: .top, spacing: 14) {
          ForEach(training.programmes, id: \.id) { programme in
            NavigationLink(value: WorkoutRoute.programme(programme.id)) {
              ProgrammeCard(programme: programme)
            }
            .buttonStyle(CardButtonStyle())
          }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 1)
      }
      .scrollIndicators(.hidden)
      .scrollClipDisabled()
    }
  }

  // MARK: History

  private func recent(_ training: Training) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      FolioSection("Recent sessions", meta: training.recent.isEmpty ? nil : "Every set")
      if training.recent.isEmpty {
        Text("Finished workouts appear here with every set.")
          .folio(.note)
          .foregroundStyle(Theme.inkSecondary)
          .padding(.top, 14)
      } else {
        ForEach(Array(training.recent.prefix(recentShown).enumerated()), id: \.element.id) { index, session in
          if index > 0 { Hairline() }
          NavigationLink(value: WorkoutRoute.session(session.id)) {
            EntryRow(
              lead: .word(Self.day(session.date)), title: session.title,
              meta: ["\(session.loggedSets) \(session.loggedSets == 1 ? "set" : "sets")", session.topSet]
                .compactMap { $0 }.joined(separator: " · "),
              opens: true)
          }
          .buttonStyle(CardButtonStyle())
        }
        if training.recent.count > recentShown {
          Button("Show All \(training.recent.count) Sessions") { recentShown = training.recent.count }
            .buttonStyle(SecondaryButtonStyle())
            .padding(.top, 8)
        }
      }
    }
  }

  /// A session's day in the margin: "26 Sep".
  private static func day(_ day: String) -> String {
    JournalDay.date(day)?.formatted(.dateTime.day().month(.abbreviated).locale(Format.locale)) ?? day
  }
}

/// Sets logged against sets planned, counted in marks of one set each.
struct SetCount: View {
  let logged: Int
  let total: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .firstTextBaseline, spacing: 5) {
        Text("\(logged)").folio(.hero).foregroundStyle(Theme.ink).contentTransition(.numericText())
        Text(logged == 1 ? "set" : "sets").unit()
        Spacer(minLength: 6)
        if total > 0 {
          Text("of \(Text("\(total)").fontWeight(.semibold).foregroundStyle(Theme.ink))")
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(Theme.inkSecondary)
        }
      }
      .lineLimit(1)
      if total > 0 {
        IsotypeMeter(
          value: Double(logged), target: Double(total), unit: 1, tint: Category.training.tint,
          markWidth: total > 30 ? 4 : 7, height: 32
        )
        .padding(.top, 12)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Sets")
    .accessibilityValue(total > 0 ? "\(logged) of \(total) logged" : "\(logged) logged")
  }
}

/// Where a session sits in its programme's cycle, as marks.
private struct SessionDots: View {
  let position: Int
  let count: Int

  var body: some View {
    HStack(spacing: 8) {
      HStack(spacing: 4) {
        ForEach(1...max(count, 1), id: \.self) { step in
          RoundedRectangle(cornerRadius: Theme.Radius.mark)
            .fill(step <= position ? Category.training.tint : Theme.track)
            .frame(width: step == position ? 22 : 12, height: 6)
        }
      }
      Text("Session \(position) of \(count)").font(.footnote).foregroundStyle(Theme.inkSecondary)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Session \(position) of \(count)")
  }
}

/// A main lift's heaviest made set.
private struct BestCell: View {
  let best: Components.Schemas.PersonalBest

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      CardLabel(title: best.name, key: Theme.record)
      Measure(value: Format.decimal(best.weight), unit: "kg").foregroundStyle(Theme.ink)
      Text(detail).font(.footnote).foregroundStyle(Theme.inkSecondary).lineLimit(1)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }

  private var detail: String {
    let when = best.date.flatMap { JournalDay.date($0) }.map {
      $0.formatted(.dateTime.day().month(.abbreviated).locale(Format.locale))
    }
    return [best.reps.map { "× \($0)" }, when ?? "Entered by you"].compactMap { $0 }.joined(separator: " · ")
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
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Image("tab-train-fill")
          .renderingMode(.template)
          .foregroundStyle(programme.active ? Theme.ink : Theme.inkSecondary)
          .accessibilityHidden(true)
        Spacer()
        if programme.active {
          Label("Following", systemImage: "checkmark")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Theme.fill, in: .capsule)
            .foregroundStyle(Theme.success)
        }
      }
      Text(programme.name)
        .folio(.entry)
        .foregroundStyle(Theme.ink)
        .lineLimit(2)
        .multilineTextAlignment(.leading)
      Text("\(programme.days.count) \(programme.days.count == 1 ? "day" : "days")\(programme.builtIn ? " · Built in" : "")")
        .font(.subheadline).foregroundStyle(Theme.inkSecondary)
    }
    .frame(width: 200, alignment: .topLeading)
    .frame(minHeight: 118, alignment: .topLeading)
    .card()
    .accessibilityElement(children: .combine)
  }
}

#if DEBUG
  #Preview("Train") {
    let train = TrainModel()
    train.training = PreviewData.training()
    return NavigationStack { TrainView(train: train) }.environment(AppModel())
  }

  #Preview("Train, in progress, dark") {
    let train = TrainModel()
    train.training = PreviewData.training(active: true)
    return NavigationStack { TrainView(train: train) }.environment(AppModel()).preferredColorScheme(.dark)
  }
#endif
