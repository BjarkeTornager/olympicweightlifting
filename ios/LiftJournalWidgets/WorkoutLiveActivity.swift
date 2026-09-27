import ActivityKit
import LiftActivity
import SwiftUI
import WidgetKit

@main
struct LiftJournalWidgets: WidgetBundle {
  var body: some Widget {
    WorkoutLiveActivity()
  }
}

/// The workout in progress on the lock screen and in the Dynamic Island. The
/// rest countdown is drawn by the system, so it runs while the phone is
/// locked; once rest is over the activity goes stale and says so.
struct WorkoutLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
      // A dark card with light text reads on any wallpaper, like the island.
      LockScreenView(context: context)
        .environment(\.colorScheme, .dark)
        .activityBackgroundTint(.black.opacity(0.6))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label {
            Text(context.state.exercise).lineLimit(1)
          } icon: {
            Image(systemName: "dumbbell.fill")
          }
          .font(.headline)
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          RestClock(state: context.state, stale: context.isStale)
            .font(.title2.weight(.semibold))
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 6) {
            Text(context.state.next).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            SessionProgress(state: context.state, stale: context.isStale)
          }
          .padding(.horizontal, 4)
        }
      } compactLeading: {
        Image(systemName: "dumbbell.fill")
          .foregroundStyle(.tint)
      } compactTrailing: {
        RestClock(state: context.state, stale: context.isStale, compact: true)
          .frame(maxWidth: 52)
      } minimal: {
        if context.state.resting(), !context.isStale, let ends = context.state.restEnds {
          Text(timerInterval: .now...ends, countsDown: true)
            .monospacedDigit()
            .font(.caption2.weight(.semibold))
        } else {
          Image(systemName: "dumbbell.fill")
        }
      }
      .keylineTint(.accentColor)
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<WorkoutActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 2) {
          Label(context.attributes.title, systemImage: "dumbbell.fill")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
          Text(context.state.exercise)
            .font(.headline)
            .lineLimit(1)
          Text(context.state.next)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
        Spacer(minLength: 12)
        VStack(alignment: .trailing, spacing: 2) {
          Text(label)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
          RestClock(state: context.state, stale: context.isStale)
            .font(.system(.title, design: .rounded, weight: .semibold))
        }
      }
      SessionProgress(state: context.state, stale: context.isStale)
    }
    .padding(16)
  }

  private var label: String {
    if context.state.restEnds == nil { return "Sets" }
    return context.isStale || !context.state.resting() ? "Rest over" : "Rest"
  }
}

/// The rest countdown, or the sets done when not resting.
private struct RestClock: View {
  let state: WorkoutActivityAttributes.ContentState
  let stale: Bool
  var compact = false

  var body: some View {
    if let ends = state.restEnds, state.resting(), !stale {
      Text(timerInterval: .now...ends, countsDown: true)
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
    } else if state.restEnds != nil {
      Image(systemName: "bell.fill").foregroundStyle(.orange)
    } else {
      Text(compact ? "\(state.loggedSets)/\(state.totalSets)" : "\(state.loggedSets) of \(state.totalSets)")
        .monospacedDigit()
    }
  }
}

/// A bar filling as the rest runs, or with the sets logged.
private struct SessionProgress: View {
  let state: WorkoutActivityAttributes.ContentState
  let stale: Bool

  var body: some View {
    if let ends = state.restEnds, let started = state.restStarted, state.resting(), !stale, started < ends {
      ProgressView(timerInterval: started...ends, countsDown: false) {
        EmptyView()
      } currentValueLabel: {
        EmptyView()
      }
      .tint(.accentColor)
    } else {
      ProgressView(value: Double(state.loggedSets), total: Double(max(state.totalSets, 1)))
        .tint(.accentColor)
    }
  }
}
