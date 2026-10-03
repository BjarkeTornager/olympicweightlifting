import Foundation
import LiftAPI

/// The standfirst under Today's date: a plain, unsigned account of what has
/// been logged so far, and how last night's sleep compares with the
/// athlete's own week. Written on the device from Today's record. It never
/// mentions targets, gaps or deficits, and says nothing when there is
/// nothing to say.
struct DaySummary: Equatable {
  /// Each activity's kind, in the order they were logged ("running").
  var activities: [String] = []
  var workouts = 0
  var meals = 0
  var checkedIn = false
  var sleepHours: Double?
  /// The average of the nights before, from the last week.
  var sleepAverage: Double?

  /// Within this many minutes, last night reads as close to the average.
  static let closeTo = 15
  /// About two lines of the standfirst at the default text size. A longer
  /// summary drops the minutes from the sleep sentence, then the sentence.
  static let limit = 80

  init(
    activities: [String] = [], workouts: Int = 0, meals: Int = 0, checkedIn: Bool = false,
    sleepHours: Double? = nil, sleepAverage: Double? = nil
  ) {
    self.activities = activities
    self.workouts = workouts
    self.meals = meals
    self.checkedIn = checkedIn
    self.sleepHours = sleepHours
    self.sleepAverage = sleepAverage
  }

  init(today: Today, sleepAverage: Double?) {
    let done = Set(today.strengthToday.map(\.id))
    let active = today.activeWorkout.map { done.contains($0.id) ? 0 : 1 } ?? 0
    self.init(
      activities: today.activities.map(\.activity), workouts: today.strengthToday.count + active,
      meals: today.nutrition.meals.count,
      checkedIn: today.checkin.map { $0.energy != nil || $0.soreness != nil } ?? false,
      sleepHours: today.sleep.hours, sleepAverage: sleepAverage)
  }

  /// One or two short sentences, or nil when nothing is logged yet.
  var text: String? {
    let logged = logged
    for sleep in [sleep(exact: true), sleep(exact: false), nil] {
      let text = [logged, sleep].compactMap { $0 }.joined(separator: " ")
      if text.count <= Self.limit || sleep == nil { return text.isEmpty ? nil : text }
    }
    return logged
  }

  /// "A run and two meals so far.", or "One meal so far." when there is
  /// only one thing to count.
  private var logged: String? {
    var kinds: [(noun: Noun, count: Int)] = []
    for activity in activities {
      let noun = Noun.activity(activity)
      if let index = kinds.firstIndex(where: { $0.noun == noun }) {
        kinds[index].count += 1
      } else {
        kinds.append((noun, 1))
      }
    }
    if workouts > 0 { kinds.append((.workout, workouts)) }
    if meals > 0 { kinds.append((.meal, meals)) }
    if checkedIn { kinds.append((.checkin, 1)) }
    guard !kinds.isEmpty else { return nil }
    let phrases = kinds.map { $0.noun.phrase($0.count, alone: kinds.count == 1) }
    let list =
      phrases.count == 1
      ? phrases[0] : phrases.dropLast().joined(separator: ", ") + " and " + phrases[phrases.count - 1]
    return list.prefix(1).uppercased() + list.dropFirst() + " so far."
  }

  /// "Sleep was close to your weekly average.", or by how much it was longer
  /// or shorter, `exact`ly or not.
  private func sleep(exact: Bool) -> String? {
    guard let hours = sleepHours, let average = sleepAverage, hours > 0, average > 0 else { return nil }
    let minutes = Int(((hours - average) * 60).rounded())
    if abs(minutes) <= Self.closeTo { return "Sleep was close to your weekly average." }
    let by = exact ? "\(Self.duration(abs(minutes))) " : ""
    return "Sleep was \(by)\(minutes > 0 ? "longer" : "shorter") than your weekly average."
  }

  /// "40 min", "1 h", "1 h 5 min".
  private static func duration(_ minutes: Int) -> String {
    let (hours, rest) = (minutes / 60, minutes % 60)
    return [hours > 0 ? "\(hours) h" : nil, rest > 0 ? "\(rest) min" : nil].compactMap { $0 }.joined(separator: " ")
  }

  private enum Noun: Equatable {
    case run, walk, ride, swim, row, hike, elliptical, activity, workout, meal, checkin

    static func activity(_ kind: String) -> Noun {
      switch kind {
      case "running": .run
      case "walking": .walk
      case "cycling": .ride
      case "swimming": .swim
      case "rowing": .row
      case "hiking": .hike
      case "elliptical": .elliptical
      default: .activity
      }
    }

    /// "a run" in a list, "one run" on its own ("A run so far." reads as
    /// unfinished), and "two runs".
    func phrase(_ count: Int, alone: Bool) -> String {
      let (article, one, many): (String, String, String) =
        switch self {
        case .run: ("a", "run", "runs")
        case .walk: ("a", "walk", "walks")
        case .ride: ("a", "ride", "rides")
        case .swim: ("a", "swim", "swims")
        case .row: ("a", "rowing session", "rowing sessions")
        case .hike: ("a", "hike", "hikes")
        case .elliptical: ("an", "elliptical session", "elliptical sessions")
        case .activity: ("an", "activity", "activities")
        case .workout: ("a", "workout", "workouts")
        case .meal: ("a", "meal", "meals")
        case .checkin: ("a", "check-in", "check-ins")
        }
      guard count == 1 else { return "\(Format.count(count)) \(many)" }
      return "\(alone ? Format.count(1) : article) \(one)"
    }
  }
}

/// The issue line over Today's masthead: the wordmark, then "Nº 13 · Week
/// 40".
/// Each day of the journal is an issue, counted from the day of its first
/// record, which the server sends, so the count carries on across installs.
/// From a server that doesn't send it yet, it counts from the first day the
/// journal was opened on this iPhone.
enum Issue {
  /// Which issue `day` is, when the journal began on `first`: 1 on the first
  /// day.
  static func number(first: Date, day: Date, calendar: Calendar = .current) -> Int {
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: first), to: calendar.startOfDay(for: day))
    return max(1, (days.day ?? 0) + 1)
  }

  /// The day the issues count from: that of the journal's first record
  /// (Today's `firstRecordDate`), or the first day on this iPhone when the
  /// server doesn't say.
  static func first(record: String?, device: Date?, calendar: Calendar = .current) -> Date? {
    record.flatMap { JournalDay.date($0, calendar: calendar) } ?? device
  }

  /// The ISO 8601 week, as diaries and planners number them.
  static func week(_ date: Date) -> Int {
    Calendar(identifier: .iso8601).component(.weekOfYear, from: date)
  }

  /// The first day of this account's journal on this iPhone, remembered the
  /// first time it is asked for.
  static func firstDay(account: String, today: Date = .now) -> Date {
    let key = "issueStart.\(account)"
    if let saved = UserDefaults.standard.string(forKey: key), let date = JournalDay.date(saved) {
      return date
    }
    UserDefaults.standard.set(JournalDay.string(today), forKey: key)
    return today
  }
}
