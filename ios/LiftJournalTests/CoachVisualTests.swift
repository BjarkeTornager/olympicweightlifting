import Foundation
import LiftAPI
import SwiftUI
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

  @Test("A dish's picture is shown at 200, asked for again while drawn or the server is busy, and gone at 404")
  func pictureOutcome() {
    #expect(CoachPicture.outcome(status: 200) == .ready)
    for status in [202, 0, 429, 502, 503] { #expect(CoachPicture.outcome(status: status) == .drawing) }
    for status in [404, 401, 400] { #expect(CoachPicture.outcome(status: status) == .gone) }
    #expect(CoachPicture.interval == .milliseconds(1500))
    #expect(CoachPicture.patience == .seconds(45))
  }

  @Test("Line chart labels thin to four, keeping the first and last")
  func sparseLabels() {
    let labels = (1...14).map { "Sep \($0)" }
    #expect(VisualLineChart.sparse(labels) == ["Sep 1", "Sep 5", "Sep 10", "Sep 14"])
    #expect(VisualLineChart.sparse(["a", "b"]) == ["a", "b"])
  }

  static func visual(_ json: String) throws -> Visual {
    try JSONDecoder().decode(Visual.self, from: Data(json.utf8))
  }

  @Test("A letter's topic comes from its first figure that names an area, then from what Coach saved")
  func topic() throws {
    let sleep = try Self.visual(#"{"id":"a","kind":"bar_chart","title":"Sleep this week","unit":"h","points":[]}"#)
    let recipe = try Self.visual(#"{"id":"b","kind":"recipe","title":"Skyr bowl"}"#)
    let table = try Self.visual(#"{"id":"c","kind":"table","title":"Your plan","columns":["A"],"rows":[]}"#)
    #expect(VisualTint.topic(visuals: [table, sleep]) == .sleep)
    #expect(VisualTint.topic(visuals: [recipe]) == .food)
    #expect(VisualTint.topic(visuals: [table], receipts: ["Log breakfast"]) == .food)
    #expect(VisualTint.topic(visuals: [table], receipts: ["Goals updated"]) == nil)
    #expect(VisualTint.topic("Body fat this month") == .body)
    #expect(VisualTint.topic("Water today") == .water)
    #expect(VisualTint.topic("Steps") == .activity)
    // Energy is food, as VisualTint.of and Today colour it.
    #expect(VisualTint.topic("Energy, 19 Sep to 2 Oct") == .food)
    #expect(VisualTint.hatched("Fat") && !VisualTint.hatched("Body fat"))
  }

  @Test("Bars over days light the latest and label the extremes; bars over items are all lit")
  func bars() throws {
    #expect(VisualBars.isDays(["Sa 26", "Su 27", "Mo 28"]))
    #expect(VisualBars.isDays(["Mon", "Tue"]))
    #expect(VisualBars.isDays(["26 Sep", "27 Sep"]))
    #expect(VisualBars.isDays(["Week 39", "Week 40"]))
    #expect(!VisualBars.isDays(["Breakfast", "Lunch", "Dinner"]))
    #expect(!VisualBars.isDays(["Snatch", "Clean & jerk"]))
    #expect(!VisualBars.isDays(["Mon"]))
    #expect(VisualBars.labelled([7.4, 6.6, 8.1, 7.0, 6.2, 7.8, 7.25]) == [2, 4, 6])
    #expect(VisualBars.labelled([92, 118, 165], days: false) == [0, 1, 2])
    let week = try Self.visual(
      #"{"id":"a","kind":"bar_chart","title":"Sleep","unit":"h","points":[{"label":"Mo","value":7},{"label":"Tu","value":8},{"label":"We","value":6}]}"#
    )
    #expect(VisualBars.average(week) == 7)
    #expect(CoachVisualView.note(week) == "Average 7 h")
    let meals = try Self.visual(
      #"{"id":"b","kind":"bar_chart","title":"Protein by meal","unit":"g","points":[{"label":"Breakfast","value":30},{"label":"Lunch","value":42},{"label":"Dinner","value":50}]}"#
    )
    #expect(VisualBars.average(meals) == nil)
    #expect(CoachVisualView.note(meals) == "g")
  }

  @Test("Over many bars a value too near another is left out, the latest kept first")
  func thinnedLabels() {
    // Two weeks: the highest on Fr 25, the lowest on Th 1 beside today.
    let energy: [Double] = [2150, 1890, 2400, 2010, 1760, 2290, 2580, 1950, 2105, 1830, 2460, 2210, 1680, 1980]
    #expect(VisualBars.labelled(energy) == [6, 13])
    #expect(VisualBars.labelled(Array(repeating: 1, count: 10), days: false) == [0, 2, 4, 6, 8])
    // A month: a seventh of the plot apart.
    let month = (0..<30).map { Double($0 == 3 ? 9 : $0 == 27 ? 1 : 5) }
    #expect(VisualBars.labelled(month) == [29, 3])
    #expect(VisualBars.lean(0, of: 14) == .leading && VisualBars.lean(13, of: 14) == .trailing)
    #expect(VisualBars.lean(6, of: 14) == .center && VisualBars.lean(0, of: 1) == .center)
    #expect(VisualLineChart.sparse(Array(0..<14), count: 5) == [0, 3, 7, 10, 13])
  }

  @Test("A figure takes the colour of the area its title names, else the reply's")
  func figureTint() throws {
    let energy = try Self.visual(#"{"id":"a","kind":"bar_chart","title":"Energy this week","unit":"kcal","points":[]}"#)
    let table = try Self.visual(#"{"id":"b","kind":"table","title":"Your plan","columns":["A"],"rows":[]}"#)
    #expect(Figures.tint(energy, topic: .training) == Category.food.tint)
    #expect(Figures.tint(table, topic: .training) == Category.training.tint)
    #expect(Figures.tint(table, topic: nil) == nil)
  }

  @Test("Figures write hours as hours and minutes, and other amounts as numbers")
  func amounts() {
    #expect(VisualAmount.short(7.2, unit: "h") == "7 h 12")
    #expect(VisualAmount.short(8, unit: "hours") == "8 h")
    #expect(VisualAmount.short(1234, unit: "kcal") == "1,234")
    #expect(VisualAmount.long(112.5, unit: "g") == "112.5 g")
    #expect(VisualAmount.long(3, unit: "") == "3")
    // An average is whole from 100 up and for counts.
    #expect(VisualAmount.average(2092.5, unit: "kcal") == "2,093 kcal")
    #expect(VisualAmount.average(7457.14, unit: "steps") == "7,457 steps")
    #expect(VisualAmount.average(84.6, unit: "kcal") == "85 kcal")
    #expect(VisualAmount.average(70.84, unit: "kg") == "70.8 kg")
    #expect(VisualAmount.average(2.46, unit: "L") == "2.5 L")
    #expect(VisualAmount.average(7.2, unit: "h") == "7 h 12")
  }

  @Test("A progress meter counts a target in 20 round marks or fewer")
  func perMark() {
    #expect(VisualProgress.perMark(130) == 10)
    #expect(VisualProgress.perMark(1900) == 100)
    #expect(VisualProgress.perMark(8) == 0.5)
    #expect(VisualProgress.perMark(10000) == 500)
    #expect(VisualProgress.perMark(2450) == 200)
    #expect(VisualProgress.perMark(0) == 1)
  }

  @Test("A target that isn't one of the athlete's own says it is Coach's suggestion")
  func suggestedTarget() {
    let own = Components.Schemas.VisualTarget(label: "Protein", value: 116, target: 180, unit: "g")
    #expect(VisualProgress.scale(own, per: 10) == "One mark = 10 g")
    let steps = Components.Schemas.VisualTarget(
      label: "Steps", value: 6200, target: 8000, unit: "steps", suggested: true)
    #expect(VisualProgress.scale(steps, per: 500) == "One mark = 500 steps · Suggested by Coach")
  }

  @Test("A reply's figures are numbered in order; a recipe takes no number")
  func figureNumbers() throws {
    let chart = try Self.visual(#"{"id":"a","kind":"bar_chart","title":"Sleep","unit":"h","points":[]}"#)
    let recipe = try Self.visual(#"{"id":"b","kind":"recipe","title":"Skyr bowl"}"#)
    let table = try Self.visual(#"{"id":"c","kind":"table","title":"Plan","columns":["A"],"rows":[]}"#)
    #expect(CoachVisualView.numbers([chart, recipe, table]) == [1, nil, 2])
  }
}
