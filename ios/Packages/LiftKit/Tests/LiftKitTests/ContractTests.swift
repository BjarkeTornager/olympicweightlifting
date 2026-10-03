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

  @Test("Every kind of visual Coach draws decodes, with its own fields")
  func coachVisuals() throws {
    let history = try fixture("coach", as: Components.Schemas.CoachHistory.self)
    let visuals = try #require(history.turns.dropFirst().first?.visuals)
    #expect(visuals.map(\.kind) == ["line_chart", "progress", "stats", "comparison", "split", "calendar"])
    #expect(visuals[0].series?.first?.points.last?.value == 87.7 && visuals[0].target == 85)
    #expect(visuals[1].targets?.first?.target == 180)
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
