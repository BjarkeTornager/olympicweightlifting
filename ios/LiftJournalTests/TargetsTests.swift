import Foundation
import LiftAPI
import Testing

@testable import LiftJournal

@Suite("Daily targets")
struct TargetsTests {
  let proposal = Components.Schemas.TargetsProposal(
    title: "Hold your weight from here",
    reasons: ["Your weight is about 81.2 kg now: you've reached your goal of 81 kg."],
    current: .init(goal: "lose", calories: 2550, protein: 175, carbs: 315, fat: 75),
    suggested: .init(goal: "maintain", calories: 3000, protein: 145, carbs: 415, fat: 85),
    maintain: true,
    notes: ["You've reached your goal weight, so the plan holds your weight there. Review your goals to set a new one."]
  )

  @Test("The suggestion shows each target that changes, with the goal")
  func rows() {
    let rows = TargetsProposalCard.rows(proposal)
    #expect(rows.map(\.label) == ["Goal", "Energy", "Protein", "Carbs", "Fat"])
    #expect(rows[0].value == "Lose weight → Hold weight")
    #expect(rows[1].value == "2,550 kcal → 3,000 kcal")
    // A target the plan sets no more reads as none.
    var noProtein = proposal
    noProtein.suggested.protein = nil
    noProtein.current.carbs = 415
    #expect(
      TargetsProposalCard.rows(noProtein).map(\.label) == ["Goal", "Energy", "Protein", "Fat"])
    #expect(TargetsProposalCard.rows(noProtein)[2].value == "175 g → none")
  }

  @Test("Taking or keeping sends the suggestion back as it was shown")
  func shown() {
    let sent = AppModel.shownTargets(proposal.suggested)
    #expect(sent.goal == .maintain)
    #expect(sent.calories == 3000 && sent.protein == 145 && sent.carbs == 415 && sent.fat == 85)
    var none = proposal.suggested
    none.protein = nil
    #expect(AppModel.shownTargets(none).protein == nil)
  }

  @Test("The food trend's target follows the one in force each day")
  func targetSteps() {
    let day = { (date: String, target: Double?) in
      Components.Schemas.TrendDay(
        date: date, sleepFromAppleHealth: false, cardioMinutes: 0, strengthSessions: 0, targetCalories: target)
    }
    let days = [day("2026-09-21", nil), day("2026-09-22", 2640), day("2026-09-23", 2550)]
    let steps = TrendView.targetSteps(days) { Format.target($0.targetCalories) }
    #expect(steps.map(\.date) == ["2026-09-22", "2026-09-23"])
    #expect(steps.map(\.value) == [2640, 2550])
    // A server from before daily targets: none, so today's target is drawn.
    #expect(TrendView.targetSteps([day("2026-09-21", nil)]) { Format.target($0.targetCalories) }.isEmpty)
  }
}
