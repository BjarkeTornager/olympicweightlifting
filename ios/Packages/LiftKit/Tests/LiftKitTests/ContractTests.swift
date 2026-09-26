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
    #expect(history.turns.first?.receipts.first?.state == "saved")
  }

  @Test("An unknown enum value from a newer server still decodes")
  func tolerant() throws {
    let json = #"{"id":"a","date":"2026-09-26","kind":"yoga-class","title":"Yoga","detail":"","fromAppleHealth":false,"somethingNew":1}"#
    let item = try JSONDecoder().decode(Components.Schemas.JournalItem.self, from: Data(json.utf8))
    #expect(item.kind == "yoga-class")
  }

  @Test func journalDays() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
    let date = JournalDay.date("2026-03-29", calendar: calendar)!
    #expect(JournalDay.string(date, calendar: calendar) == "2026-03-29")
    #expect(JournalDay.date("2026-3", calendar: calendar) == nil)
  }
}
