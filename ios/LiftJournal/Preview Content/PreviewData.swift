#if DEBUG
  import Foundation
  import LiftAPI

  /// Synthetic data for SwiftUI previews. The JSON is written by the server
  /// (`npm run openapi`) and, as a development asset, never ships in an archive.
  enum PreviewData {
    static var today: Today? {
      guard let url = Bundle.main.url(forResource: "preview-today", withExtension: "json"),
        let data = try? Data(contentsOf: url)
      else { return nil }
      return try? JSONDecoder().decode(Today.self, from: data)
    }

    /// The seven days up to the preview's today, for the small charts and
    /// the Journal's register.
    static var week: Components.Schemas.Trends {
      let end = today.flatMap { JournalDay.date($0.date) } ?? .now
      let sleep = [7.4, 6.6, 8.1, 7.0, 6.2, 7.8, 7.5]
      let heart = [54, 56, 53, 55, 57, 53, 52]
      let steps = [9120, 6400, 11800, 7300, 5200, 10400, 9120]
      let weight: [Double?] = [81.9, 82.2, nil, 81.8, 81.6, nil, 81.4]
      let days = (0..<7).map { index in
        let day = Calendar.current.date(byAdding: .day, value: index - 6, to: end) ?? end
        return Components.Schemas.TrendDay(
          date: JournalDay.string(day), sleepHours: sleep[index], sleepFromAppleHealth: true,
          restingHeartRate: heart[index], steps: steps[index], waterMl: index == 2 ? nil : 1800 + index * 120,
          calories: 1700 + Double(index * 60), protein: 110, bodyweight: weight[index],
          cardioMinutes: [0, 0, 34, 40, 25, 0, 50][index], strengthSessions: index == 3 ? 1 : 0)
      }
      return .init(days: days, targetCalories: 1900, targetProtein: 130, waterTargetMl: 2850)
    }

    static var journal: [Components.Schemas.JournalItem] {
      let end = today.flatMap { JournalDay.date($0.date) } ?? .now
      let todayString = JournalDay.string(end)
      let yesterday = JournalDay.string(Calendar.current.date(byAdding: .day, value: -1, to: end) ?? end)
      return [
        .init(
          id: "run", date: todayString, kind: "cardio", title: "Outdoor Run",
          detail: "50 min · 10 km · 148 bpm avg · 612 kcal", fromAppleHealth: true, hasRoute: true,
          activity: "running"),
        .init(
          id: "oats", date: todayString, kind: "meal", title: "Oats with berries",
          detail: "Breakfast · 300 kcal · 11 g protein", fromAppleHealth: false),
        .init(
          id: "sleep", date: todayString, kind: "sleep", title: "Sleep", detail: "7 h 30 min",
          fromAppleHealth: true),
        .init(
          id: "checkin", date: todayString, kind: "checkin", title: "Check-in",
          detail: "Energy 4/5 · soreness 2/5 · 81.4 kg", fromAppleHealth: false),
        .init(
          id: "salad", date: yesterday, kind: "meal", title: "Chicken salad with quinoa",
          detail: "Lunch · 610 kcal · 42 g protein", fromAppleHealth: false),
        .init(
          id: "squat", date: yesterday, kind: "strength", title: "Snatch + Back Squat",
          detail: "18 sets · Back squat 120 kg × 3", fromAppleHealth: false),
      ]
    }

    /// Train with a programme to follow, recent sessions and bests; with
    /// `active`, a workout in progress.
    static func training(active: Bool = false) -> Training? {
      let workout = """
        "activeWorkout": {"id": "w1", "title": "Snatch + Back Squat", "date": "2026-09-26", "finished": false,
          "recovery": "auto", "techniqueCheck": false,
          "recoveryHint": "You slept 5 h 30 min before this session. Under 6 hours can lower performance, so you may want to hold today’s loads.",
          "exercises": [
            {"entryId": "e1", "exerciseId": "snatch", "name": "Snatch", "target": "5 × 2 at 70 kg", "restSeconds": 180,
             "progression": {"status": "increase", "reason": "All prescribed sets and reps were made, the top set at RPE 8. The program automatically adds 2 kg total (1 kg per side)."},
             "sets": [{"id": "s1", "weight": 70, "reps": 2, "result": "success", "logged": true},
                      {"id": "s2", "weight": 70, "reps": 2, "result": "miss", "logged": true},
                      {"id": "s3", "weight": 70, "reps": 2, "result": "success", "logged": false},
                      {"id": "s4", "weight": 70, "reps": 2, "result": "success", "logged": false}]},
            {"entryId": "e2", "exerciseId": "squat", "name": "Back Squat", "target": "4 × 5 at 110 kg", "restSeconds": 180,
             "progression": {"status": "hold", "reason": "The previous workout included a miss. Repeat this load. Two sessions in a row at 110 kg ended with a miss or an RPE above 8. A common coaching convention, not a rule, is to reset to about 90%: 99 kg. Take the reset, or repeat 110 kg.", "resetWeight": 99},
             "sets": [{"id": "s5", "weight": 110, "reps": 5, "result": "success", "logged": false},
                      {"id": "s6", "weight": 110, "reps": 5, "result": "success", "logged": false}]}]},
        """
      let json = """
        {"revision": 3, \(active ? workout : "")
         "next": {"programmeId": "base", "programmeName": "Stability & Power Base", "dayId": "d1",
                  "title": "Snatch + Back Squat", "position": 1, "count": 4, "builtIn": true, "canStart": true},
         "programmes": [{"id": "base", "name": "Stability & Power Base", "builtIn": true, "active": true, "weeks": 4,
           "days": [{"id": "d1", "name": "Snatch + Back Squat", "cardio": [], "exercises": [
             {"exerciseId": "snatch", "name": "Snatch", "sets": 5, "reps": 2, "text": "5 × 2 at 70 kg"},
             {"exerciseId": "squat", "name": "Back Squat", "sets": 4, "reps": 5, "text": "4 × 5 at 110 kg"},
             {"exerciseId": "pull", "name": "Snatch Pull", "sets": 3, "reps": 3, "text": "3 × 3"}]}]},
           {"id": "mine", "name": "Summer Strength", "builtIn": false, "active": false, "days": []}],
         "recent": [{"id": "r1", "title": "Clean & Jerk", "date": "2026-09-24", "exercises": 3, "loggedSets": 14,
                     "topSet": "Clean & jerk 92 kg × 1"},
                    {"id": "r2", "title": "Snatch + Back Squat", "date": "2026-09-22", "exercises": 3,
                     "loggedSets": 18}],
         "bests": [{"exerciseId": "snatch", "name": "Snatch", "weight": 78, "reps": 1, "date": "2026-09-12"},
                   {"exerciseId": "cj", "name": "Clean & Jerk", "weight": 96, "reps": 1}],
         "weeks": [{"start": "2026-08-31", "sessions": 2, "sets": 30, "tonnageKg": 6200},
                   {"start": "2026-09-07", "sessions": 3, "sets": 41, "tonnageKg": 8100},
                   {"start": "2026-09-14", "sessions": 0, "sets": 0, "tonnageKg": 0},
                   {"start": "2026-09-21", "sessions": 3, "sets": 44, "tonnageKg": 9050}],
         "exercises": []}
        """
      return try? JSONDecoder().decode(Training.self, from: Data(json.utf8))
    }
  }
#endif
