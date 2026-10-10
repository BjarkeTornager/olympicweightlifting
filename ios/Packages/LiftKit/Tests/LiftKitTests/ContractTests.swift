import Foundation
import Testing

@testable import LiftAPI

/// The server writes these fixtures with its own view builders
/// (lib/native-fixtures.ts). If the app cannot decode them, the contract
/// between the server and installed builds is broken.
@Suite("Server responses decode")
struct ContractTests {
  func fixture<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
    let url = try #require(Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: "json"))
    return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
  }

  @Test func today() throws {
    let today = try fixture("today", as: Components.Schemas.Today.self)
    #expect(today.sleep.text == "7 h 30 min")
    #expect(today.sleep.fromAppleHealth)
    #expect(today.vitals?.restingHeartRate == 52)
    #expect(today.hydration.totalMl == 750)
    #expect(today.hydration.drinks.map(\.kind) == ["water", "coffee"])
    let run = try #require(today.activities.first)
    #expect(run.fromAppleHealth && run.averageHeartRate == 148 && run.distanceKm == 10)
    #expect(today.nutrition.meals.first?.name == "Oats with berries")
    // The day the journal began, for the issue number.
    #expect(today.journalStartDate == "2026-09-24")
  }

  @Test("Today decodes from a server that doesn't send the day the journal began yet")
  func todayFromOlderServer() throws {
    let url = try #require(Bundle.module.url(forResource: "Fixtures/today", withExtension: "json"))
    var json = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    json["journalStartDate"] = nil
    let older = try JSONDecoder().decode(
      Components.Schemas.Today.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(older.journalStartDate == nil && older.date == "2026-09-26")
  }

  @Test("Today carries Coach's note on short sleep, and the average from five nights")
  func todayShortSleep() throws {
    let today = try fixture("today-short-sleep", as: Components.Schemas.Today.self)
    #expect(today.sleep.nights == 7)
    #expect(today.sleep.averageHours != nil)
    let note = try #require(today.sleepNote)
    #expect(note.id == "sleep-short")
    #expect(note.observation.contains("7 logged nights"))
    #expect(!note.prompt.isEmpty)
    // One night is too few for an average, and no note.
    let plain = try fixture("today", as: Components.Schemas.Today.self)
    #expect(plain.sleep.nights == 1 && plain.sleep.averageHours == nil && plain.sleepNote == nil)
  }

  @Test("Today carries the goals plan's suggested targets beside the saved ones")
  func todayTargets() throws {
    let today = try fixture("today-targets", as: Components.Schemas.Today.self)
    #expect(today.nutrition.targetCalories == 2550)
    let proposal = try #require(today.targetsProposal)
    #expect(proposal.title == "Hold your weight from here")
    #expect(proposal.maintain)
    #expect(proposal.current.goal == "lose" && proposal.current.calories == 2550)
    #expect(proposal.suggested.goal == "maintain" && proposal.suggested.calories == 3000)
    #expect(proposal.reasons.first?.contains("you've reached your goal of 81 kg") == true)
    #expect(today.body?.bodyweightFromAppleHealth == false)
    // Holding the weight asks no health questions.
    #expect(proposal.energyCheck == nil)
    // None without a suggestion.
    #expect(try fixture("today", as: Components.Schemas.Today.self).targetsProposal == nil)
  }

  @Test("A suggestion that sets a deficit carries the low-energy questions, and what a yes holds")
  func todayTargetsCheck() throws {
    let today = try fixture("today-targets-check", as: Components.Schemas.Today.self)
    let proposal = try #require(today.targetsProposal)
    #expect(proposal.reasons == ["Your weight is about 63.1 kg now, above the 62 kg you aim to hold."])
    #expect(proposal.suggested.goal == "lose" && proposal.suggested.calories == 1960)
    let check = try #require(proposal.energyCheck)
    #expect(check.questions.count == 3)
    #expect(check.note.hasPrefix("Optional, and not a diagnosis."))
    #expect(check.ifYes.goal == "maintain" && check.ifYes.calories == 2300)
    // With a yes, the held plan's notes replace the deficit's.
    #expect(check.ifYesNotes?.first?.hasPrefix("You answered yes to one of the questions") == true)
  }

  @Test("Today's food reads as the website words it, and nothing passes a target below the minimum")
  func todayFood() throws {
    let food = try fixture("today-food", as: Components.Schemas.Today.self).nutrition
    #expect(food.estimated == true && food.complete == true)
    #expect(food.hideOverTarget == true)
    #expect(food.caloriesProgress?.target == "about 1,300\u{00a0}kcal")
    #expect(food.caloriesProgress?.status == nil)
    #expect(food.proteinProgress?.status == "Reached")
    #expect(food.carbsProgress?.target == "about 130 to 150\u{00a0}g")
    #expect(food.targetNote?.contains("below your estimated minimum") == true)
    // Without targets, none of it.
    let plain = try fixture("today", as: Components.Schemas.Today.self).nutrition
    #expect(plain.caloriesProgress == nil && plain.hideOverTarget == nil && plain.targetNote == nil)
  }

  @Test("Trends say which days are complete, and the week's complete-day average")
  func trendsFood() throws {
    let trends = try fixture("trends-food", as: Components.Schemas.Trends.self)
    #expect(trends.days.suffix(3).allSatisfy { $0.foodComplete == true })
    #expect(trends.days.first?.foodComplete == nil)
    #expect(trends.foodWeek?.completeDays == 3)
    #expect(trends.foodWeek?.text.hasPrefix("3 complete days in the last 7") == true)
    // Each day's own drinks target.
    #expect(trends.days.allSatisfy { $0.waterTargetMl == trends.waterTargetMl })
  }

  @Test("Trends rows carry the targets in force each day")
  func trendTargets() throws {
    let trends = try fixture("trends-targets", as: Components.Schemas.Trends.self)
    #expect(trends.days.map(\.targetCalories) == [2640, 2640, 2640, 2550, 2550, 2550, 2550])
    #expect(trends.targetCalories == 2550)
  }

  @Test func journal() throws {
    let feed = try fixture("journal", as: Components.Schemas.JournalFeed.self)
    #expect(Set(feed.items.map(\.kind)).isSuperset(of: ["cardio", "meal", "sleep", "vitals", "strength"]))
    #expect(feed.items.first?.date == "2026-09-26")
  }

  @Test func coach() throws {
    let history = try fixture("coach", as: Components.Schemas.CoachHistory.self)
    let receipt = try #require(history.turns.first?.receipts.first)
    #expect(receipt.state == "saved")
    // What was saved, item by item, for the receipt to show when opened.
    let entry = try #require(receipt.entries?.first)
    #expect(entry.title == "Breakfast: Oats with berries")
    #expect(entry.lines.map(\.label) == ["Oats", "Berries"])
    #expect(entry.lines.first?.note == "80 g")
  }

  @Test("A targets review shows the goal and every target, with what it was")
  func coachTargets() throws {
    let history = try fixture("coach", as: Components.Schemas.CoachHistory.self)
    let receipt = try #require(
      history.turns.flatMap(\.receipts).first { $0.title == "Update your daily nutrition targets" })
    #expect(receipt.state == "pending")
    let lines = try #require(receipt.entries?.first?.lines)
    #expect(lines.map(\.label) == ["Goal", "Energy", "Protein", "Carbs", "Fat"])
    #expect(lines[0].value == "Lose weight" && lines[0].note == nil)
    // Only calories changed: the old value sits under the label.
    #expect(lines[1].value == "2400 kcal" && lines[1].note == "Was 2350 kcal")
    #expect(lines[2].value == "176 g" && lines[2].note == nil)
  }

  @Test("A goals review carries the plan's own notes, as the server's plan wrote them")
  func coachGoals() throws {
    let history = try fixture("coach", as: Components.Schemas.CoachHistory.self)
    let receipt = try #require(history.turns.flatMap(\.receipts).first { $0.title == "Set your goals" })
    #expect(receipt.state == "pending")
    // A 16-year-old who wants to lose weight: the plan holds it, and says why.
    #expect(receipt.detail.hasPrefix("Hold around 60 kg."))
    #expect(receipt.detail.contains("Under 18 the plan doesn't set a calorie deficit"))
    #expect(receipt.detail.contains("talk it through with a parent, your coach or a doctor"))
    #expect(receipt.entries?.first?.lines.first?.value == "Maintain weight")
    // The same note on its own, for the receipt to show in full.
    #expect(receipt.notes?.count == 1)
    #expect(receipt.notes?.first?.hasPrefix("Under 18 the plan doesn't set a calorie deficit") == true)
  }

  @Test("Today's goals bring the plan's notes, and decode without them")
  func todayGoalNotes() throws {
    let url = try #require(Bundle.module.url(forResource: "Fixtures/today", withExtension: "json"))
    var json = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    var body = try #require(json["body"] as? [String: Any])
    #expect(try fixture("today", as: Components.Schemas.Today.self).body?.goalNotes == nil)
    body["goalNotes"] = ["Your target date has passed, so the plan holds your weight for now."]
    json["body"] = body
    let today = try JSONDecoder().decode(
      Components.Schemas.Today.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(today.body?.goalNotes?.first?.hasPrefix("Your target date has passed") == true)
  }

  @Test("Every kind of visual Coach draws decodes, with its own fields")
  func coachVisuals() throws {
    let history = try fixture("coach", as: Components.Schemas.CoachHistory.self)
    let visuals = try #require(history.turns.dropFirst().first?.visuals)
    #expect(visuals.map(\.kind) == ["line_chart", "progress", "stats", "comparison", "split", "calendar"])
    #expect(visuals[0].series?.first?.points.last?.value == 87.7 && visuals[0].target == 85)
    #expect(visuals[1].targets?.first?.target == 180 && visuals[1].targets?.first?.suggested == nil)
    #expect(visuals[1].targets?.last?.suggested == true)
    #expect(visuals[2].stats?.first?.trend == "up")
    #expect(visuals[3].afterLabel == "This week" && visuals[3].comparisons?.first?.higherIsBetter == true)
    #expect(visuals[4].parts?.map(\.value) == [464, 604])
    #expect(visuals[5].days?.first?.level == 3 && visuals[5].legend == "Darker is more training")
  }

  @Test("A recipe card decodes with its ingredients, steps and nutrition")
  func coachRecipe() throws {
    let history = try fixture("coach", as: Components.Schemas.CoachHistory.self)
    let recipe = try #require(history.turns.last?.visuals?.first)
    #expect(recipe.kind == "recipe" && recipe.servings == 2 && recipe.minutes == 25)
    #expect(recipe.ingredients?.first?.item == "Salmon fillet" && recipe.ingredients?.first?.amount == "250 g")
    // An ingredient may come without an amount.
    #expect(recipe.ingredients?.last?.item == "Spring onion" && recipe.ingredients?.last?.amount == nil)
    #expect(recipe.steps?.count == 4)
    #expect(recipe.nutrition?.kcal == 625 && recipe.nutrition?.protein == 37 && recipe.nutrition?.fat == 21)
    #expect(recipe.pictureId == "5a0c9e1d-7b3f-4e62-8d14-2f6a9c3b7e58")
  }

  @Test("A visual streamed mid-reply reads as the saved one will")
  func streamedVisual() throws {
    let event = #"""
      {"type":"CUSTOM","name":"coach.visual","value":{"id":"v1","content":{"kind":"progress","title":"Today","targets":[{"label":"Water","value":1.5,"target":3,"unit":"L"}]}}}
      """#
    let visual = try #require(CoachStream.visual(fromCustom: event))
    #expect(visual.id == "v1" && visual.kind == "progress" && visual.targets?.first?.unit == "L")
    #expect(CoachStream.visual(fromCustom: #"{"type":"CUSTOM","name":"other","value":{}}"#) == nil)
  }

  @Test("An unknown enum value from a newer server still decodes")
  func tolerant() throws {
    let json = #"{"id":"a","date":"2026-09-26","kind":"yoga-class","title":"Yoga","detail":"","fromAppleHealth":false,"somethingNew":1}"#
    let item = try JSONDecoder().decode(Components.Schemas.JournalItem.self, from: Data(json.utf8))
    #expect(item.kind == "yoga-class")
  }

  @Test("The workout in progress says why each load, where rest starts, and the day's recovery")
  func workoutInProgress() throws {
    let workout = try fixture("workout", as: Components.Schemas.WorkoutDetail.self)
    #expect(workout.recovery == "auto" && workout.techniqueCheck == false)
    #expect(workout.recoveryHint?.hasPrefix("You slept 5 h 30 min before this session.") == true)
    let snatch = workout.exercises[0]
    #expect(snatch.progression?.status == "confirm" && snatch.restSeconds == 180)
    #expect(workout.exercises[1].progression?.resetWeight == 72)
    #expect(workout.exercises[2].sets[0].rpe == 7)
    // A load the athlete chooses needs no reason; an accessory rests 90 s.
    #expect(workout.exercises[3].progression == nil && workout.exercises[3].restSeconds == 90)
  }

  @Test("Train decodes from a server that hasn't deployed its newest fields yet")
  func trainingFromOlderServer() throws {
    let url = try #require(Bundle.module.url(forResource: "Fixtures/training", withExtension: "json"))
    var json = try #require(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let current = try fixture("training", as: Components.Schemas.Training.self)
    #expect(current.weeks?.count == 8)
    json["bests"] = nil
    json["weeks"] = nil
    let older = try JSONDecoder().decode(
      Components.Schemas.Training.self, from: JSONSerialization.data(withJSONObject: json))
    #expect(older.bests == nil && older.weeks == nil)
  }

  @Test("The exercise list has the library's other names and the athlete's own exercises")
  func exerciseOptions() throws {
    let training = try fixture("training", as: Components.Schemas.Training.self)
    let rdl = try #require(training.exercises.first { $0.id == "romanian_deadlift" })
    #expect(rdl.aliases?.contains("RDL") == true)
    let own = try #require(training.exercises.first { $0.category == "Your exercises" })
    #expect(own.id == "custom:Standing cable reverse fly" && own.name == "Standing cable reverse fly")
    #expect(own.aliases == nil)
  }

  @Test("A response this build can't read is told apart from other failures")
  func unreadable() {
    let decoding = DecodingError.keyNotFound(
      Components.Schemas.Training.CodingKeys.bests, .init(codingPath: [], debugDescription: ""))
    #expect(APIFailure.unreadable(decoding))
    #expect(!APIFailure.unreadable(URLError(.timedOut)))
    #expect(!APIFailure.unreadable(APIFailure(status: 500, message: "")))
  }

  @Test("A dropped connection is told apart from Coach or the server refusing")
  func coachInterruption() {
    #expect(CoachFailure.isInterruption(URLError(.networkConnectionLost)))
    #expect(CoachFailure.isInterruption(CoachFailure(message: "", status: 0, interrupted: true)))
    #expect(!CoachFailure.isInterruption(CoachFailure(message: "Please wait a minute", status: 429)))
    #expect(!CoachFailure.isInterruption(URLError(.badServerResponse)))
    #expect(!CoachFailure.isInterruption(CancellationError()))
  }

  @Test("A request that never left the phone is an ordinary failure, not a dropped reply")
  func coachUnreachable() {
    let offline = CoachFailure(message: "", status: 0, connection: .notConnectedToInternet)
    #expect(CoachFailure.isUnreachable(offline))
    #expect(CoachFailure.isOffline(offline))
    #expect(!CoachFailure.isInterruption(offline))
    let serverDown = CoachFailure(message: "", status: 0, connection: .cannotConnectToHost)
    #expect(CoachFailure.isUnreachable(serverDown))
    #expect(!CoachFailure.isOffline(serverDown))
    // A photo upload's failure, unwrapped from the generated client.
    #expect(CoachFailure.isOffline(URLError(.notConnectedToInternet)))
    #expect(CoachFailure.isUnreachable(URLError(.cannotFindHost)))
    // The server may already have these.
    #expect(!CoachFailure.isUnreachable(URLError(.networkConnectionLost)))
    #expect(!CoachFailure.isUnreachable(URLError(.timedOut)))
    #expect(!CoachFailure.isUnreachable(CoachFailure(message: "", status: 0, interrupted: true)))
  }

  @Test("RUN_ERROR carries the server's status code, so a 409 or 429 is told apart")
  func coachRunError() throws {
    var reader = CoachStream.Reader()
    #expect(try reader.read(#"data: {"type":"STEP_STARTED","stepName":"Reading your journal"}"#) == .step("Reading your journal"))
    #expect(try reader.read(": keep-alive") == nil)
    do {
      _ = try reader.read(#"data: {"type":"RUN_ERROR","message":"Sync your latest journal changes","code":"409"}"#)
      Issue.record("RUN_ERROR should throw")
    } catch let failure as CoachFailure {
      #expect(failure.status == 409)
      #expect(failure.message == "Sync your latest journal changes")
      #expect(!failure.interrupted)
    }
    var old = CoachStream.Reader()
    do {
      _ = try old.read(#"data: {"type":"RUN_ERROR","message":"Coach failed"}"#)
      Issue.record("RUN_ERROR should throw")
    } catch let failure as CoachFailure {
      #expect(failure.status == 0)
    }
  }

  @Test("A stream that ends without RUN_FINISHED is a dropped reply")
  func coachStreamEnd() throws {
    var reader = CoachStream.Reader()
    #expect(try reader.read(#"data: {"type":"TEXT_MESSAGE_START"}"#) == .step("Writing"))
    #expect(try reader.read(#"data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Hi"}"#) == .reply("Hi"))
    #expect(throws: CoachFailure.self) { try reader.end() }
    #expect(try reader.read(#"data: {"type":"RUN_FINISHED"}"#) == .finished)
    try reader.end()
  }

  @Test func journalDays() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
    let date = JournalDay.date("2026-03-29", calendar: calendar)!
    #expect(JournalDay.string(date, calendar: calendar) == "2026-03-29")
    #expect(JournalDay.date("2026-3", calendar: calendar) == nil)
  }
}
