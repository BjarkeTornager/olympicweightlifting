import Foundation
import LiftAPI
import Testing

@testable import LiftJournal

@Suite("Coach visuals")
struct CoachVisualTests {
  typealias Day = Components.Schemas.VisualDay

  @Test("Calendar days fall on their weekday, with the days Coach left out blank")
  func calendarLayout() {
    // Training on Wednesday 16 and Friday 18 September: Thursday stays empty.
    let (offset, cells) = VisualCalendar.layout([
      Day(date: "2026-09-18", level: 3),
      Day(date: "2026-09-16", level: 2, label: "Snatch"),
    ])
    #expect(offset == 2)
    #expect(
      cells == [
        .init(date: "2026-09-16", number: 16, level: 2, label: "Snatch"),
        .init(date: "2026-09-17", number: 17, level: nil, label: nil),
        .init(date: "2026-09-18", number: 18, level: 3, label: nil),
      ])
  }

  @Test("A calendar across a month end stops at six weeks")
  func calendarLimit() {
    let (offset, cells) = VisualCalendar.layout([
      Day(date: "2026-08-31", level: 1), Day(date: "2026-12-01", level: 1),
    ])
    #expect(offset == 0)
    #expect(cells.count == 42)
    #expect(cells.map(\.number).prefix(2) == [31, 1])
    #expect(VisualCalendar.layout([]).cells.isEmpty)
  }

  @Test("A recipe decodes, with its servings, time and nutrition read as on the website")
  func recipe() throws {
    let json = #"""
      {"id":"v","kind":"recipe","title":"Skyr bowl","servings":1,
       "ingredients":[{"item":"Skyr","amount":"200 g"},{"item":"Honey"}],
       "nutrition":{"kcal":240,"protein":22,"fat":4},"pictureId":"0d4e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a40"}
      """#
    let visual = try JSONDecoder().decode(Visual.self, from: Data(json.utf8))
    #expect(visual.kind == "recipe" && visual.steps == nil && visual.minutes == nil)
    #expect(visual.ingredients?.map(\.item) == ["Skyr", "Honey"])
    #expect(visual.pictureId == "0d4e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a40")
    #expect(VisualRecipe.meta(servings: visual.servings ?? 1, minutes: visual.minutes) == "1 serving")
    #expect(VisualRecipe.meta(servings: 2, minutes: 25) == "2 servings · 25 min")
    #expect(VisualRecipe.meta(servings: 4, minutes: 60) == "4 servings · 1 h")
    #expect(VisualRecipe.meta(servings: 4, minutes: 75) == "4 servings · 1 h 15 min")
    // Only the values Coach gave, in a fixed order.
    #expect(
      VisualRecipe.nutrition(visual.nutrition) == [
        .init(label: "Calories", value: "240 kcal"), .init(label: "Protein", value: "22 g"),
        .init(label: "Fat", value: "4 g"),
      ])
    #expect(VisualRecipe.nutrition(nil).isEmpty)
  }

  @Test("Line chart labels thin to four, keeping the first and last")
  func sparseLabels() {
    let labels = (1...14).map { "Sep \($0)" }
    #expect(VisualLineChart.sparse(labels) == ["Sep 1", "Sep 5", "Sep 10", "Sep 14"])
    #expect(VisualLineChart.sparse(["a", "b"]) == ["a", "b"])
  }
}
