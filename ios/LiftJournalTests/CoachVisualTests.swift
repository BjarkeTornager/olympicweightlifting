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

  @Test("Line chart labels thin to four, keeping the first and last")
  func sparseLabels() {
    let labels = (1...14).map { "Sep \($0)" }
    #expect(VisualLineChart.sparse(labels) == ["Sep 1", "Sep 5", "Sep 10", "Sep 14"])
    #expect(VisualLineChart.sparse(["a", "b"]) == ["a", "b"])
  }
}
