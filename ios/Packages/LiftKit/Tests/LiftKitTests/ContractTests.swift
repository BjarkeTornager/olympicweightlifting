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

  @Test func journalDays() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
    let date = JournalDay.date("2026-03-29", calendar: calendar)!
    #expect(JournalDay.string(date, calendar: calendar) == "2026-03-29")
    #expect(JournalDay.date("2026-3", calendar: calendar) == nil)
  }
}
