import Foundation
import LiftAPI
import LiftActivity
import LiftTheme
import SwiftUI
import Testing
import UIKit

@testable import LiftJournal

@Suite("App")
struct LiftJournalTests {
  @Test("The asset catalog's accent colour matches the theme's, as UIKit tints with it")
  func accentColour() throws {
    let asset = try #require(UIColor(named: "AccentColor", in: .main, compatibleWith: nil))
    for style in [UIUserInterfaceStyle.light, .dark] {
      let traits = UITraitCollection(userInterfaceStyle: style)
      var a: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
      var b: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
      asset.resolvedColor(with: traits).getRed(&a.0, green: &a.1, blue: &a.2, alpha: &a.3)
      UIColor(Theme.accent).resolvedColor(with: traits).getRed(&b.0, green: &b.1, blue: &b.2, alpha: &b.3)
      #expect(abs(a.0 - b.0) < 0.005 && abs(a.1 - b.1) < 0.005 && abs(a.2 - b.2) < 0.005, "\(style.rawValue)")
    }
  }

  @Test("Appearance: System follows the iPhone, Light and Dark override it, and the choice is stored by name")
  func appearance() {
    #expect(Appearance.system.style == .unspecified)
    #expect(Appearance.light.style == .light)
    #expect(Appearance.dark.style == .dark)
    #expect(Appearance.allCases.map(\.title) == ["System", "Light", "Dark"])
    #expect(Appearance(rawValue: "dark") == .dark)
  }

  @Test("Photos are resized to at most 1280 pixels before upload")
  func photoSize() throws {
    let image = UIGraphicsImageRenderer(size: CGSize(width: 4000, height: 3000)).image { context in
      UIColor.systemTeal.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 4000, height: 3000))
    }
    let data = try #require(CoachModel.jpeg(image))
    let resized = try #require(UIImage(data: data))
    #expect(max(resized.size.width * resized.scale, resized.size.height * resized.scale) == 1280)
  }

  @Test("Coach replies keep line breaks and inline emphasis")
  func markdown() {
    let text = CoachReplyFormat.attributed("**Saved.**\nAbout 300 kcal")
    #expect(String(text.characters) == "Saved.\nAbout 300 kcal")
  }

  @Test("The lock screen shows the next set to do and the session's progress")
  func workoutActivity() throws {
    let json = """
      {"id":"w1","title":"Snatch + Back Squat","date":"2026-09-27","finished":false,"exercises":[
        {"entryId":"e1","exerciseId":"snatch","name":"Snatch","sets":[
          {"id":"s1","weight":60,"reps":2,"result":"made","logged":true},
          {"id":"s2","weight":62.5,"reps":2,"result":"","logged":false}]},
        {"entryId":"e2","exerciseId":"squat","name":"Back squat","sets":[
          {"id":"s3","reps":1,"result":"","logged":false}]}]}
      """
    var workout = try JSONDecoder().decode(WorkoutDetail.self, from: Data(json.utf8))
    let ends = Date.now.addingTimeInterval(90)
    let state = WorkoutActivityController.contentState(workout, restStarted: .now, restEnds: ends)
    #expect(state.exercise == "Snatch")
    // Written as the server writes it, whatever the iPhone's region.
    #expect(state.next == "Set 2 of 2 · 62.5 kg × 2")
    #expect(state.loggedSets == 1 && state.totalSets == 3)
    #expect(state.resting())
    #expect(!state.resting(at: ends))

    workout.exercises[0].sets[1].logged = true
    let squat = WorkoutActivityController.contentState(workout, restStarted: nil, restEnds: nil)
    #expect(squat.next == "Set 1 of 1 · 1 rep")
    #expect(!squat.resting())

    workout.exercises[1].sets[0].logged = true
    let done = WorkoutActivityController.contentState(workout, restStarted: nil, restEnds: nil)
    #expect(done.exercise == "Back squat" && done.next == "All planned sets logged")
  }

  @Test("Preview data decodes")
  func preview() {
    #expect(PreviewData.today?.hydration.totalMl == 750)
  }

  @Test("Coach replies parse into the same blocks the website renders")
  func markdownBlocks() {
    let blocks = MarkdownBlock.parse(
      """
      ### Your week

      You trained **4 times**.
      Protein was low.

      - Strength
      - Cardio
        - two runs

      | Day | Sleep |
      | --- | --- |
      | Mon | 7 h |

      1. Eat more
      2. Rest

      > Logged only
      """)
    #expect(blocks.count == 6)
    #expect(blocks[0] == .heading("Your week"))
    #expect(blocks[1] == .paragraph("You trained **4 times**.\nProtein was low."))
    guard case .list(false, _, let items) = blocks[2] else {
      Issue.record("expected a bullet list")
      return
    }
    #expect(items.map(\.text) == ["Strength", "Cardio"])
    #expect(items[1].children == [.list(ordered: false, start: 1, items: [.init(text: "two runs", children: [])])])
    #expect(blocks[3] == .table(header: ["Day", "Sleep"], rows: [["Mon", "7 h"]]))
    guard case .list(true, 1, let steps) = blocks[4] else {
      Issue.record("expected a numbered list")
      return
    }
    #expect(steps.count == 2)
    #expect(blocks[5] == .quote("Logged only"))
    #expect(MarkdownBlock.cells(#"| a \| b | `x|y` |"#) == ["a | b", "`x|y`"])
  }

  @Test("Copying a Coach reply copies its words as written, not as typeset")
  func plainReply() {
    let reply = "## Søvn\n\nDu sov **7 t 12 min**, efter dagens styrketræning.\n\n1. Spis *tidligere*\n2. Gå i seng kl. 22\n\n| Dag | kcal |\n| --- | --- |\n| Man | 1,900 |"
    let plain = CoachReplyFormat.plain(reply)
    #expect(plain == "Søvn\n\nDu sov 7 t 12 min, efter dagens styrketræning.\n\n1. Spis tidligere\n2. Gå i seng kl. 22\n\nDag\tkcal\nMan\t1,900")
    #expect(!plain.contains("\u{00AD}") && !plain.contains("\u{00A0}"))
  }

  @Test("A table's columns of figures are set flush right, its words and labels flush left")
  func tableFigures() {
    let rows = [["Monday", "980", "Rest", "−2 bpm"], ["Tuesday", "1,900", "Squats", "-"]]
    #expect(DataTable.figureColumns(rows, count: 4) == [1, 3])
    #expect(DataTable.figureColumns([["1", "2"]], count: 2) == [1])
  }

  @Test("Coach's strong words are set in weight 500 New York, not bold")
  func letterEmphasis() {
    let text = CoachReplyFormat.letter("You slept **7 h 12 min** on *average*.", size: 18)
    // The figure keeps together: its spaces don't break.
    #expect(String(text.characters) == "You slept 7\u{00A0}h\u{00A0}12\u{00A0}min on average.")
    // The emphasis is carried by the run's font, so Text adds no bold.
    let strong = text.runs.first { String(text[$0.range].characters) == "7\u{00A0}h\u{00A0}12\u{00A0}min" }
    #expect(strong != nil)
    #expect(text.runs.allSatisfy { $0.inlinePresentationIntent == nil })
  }

  @Test("A saved change's margin note takes the key of its area")
  func confirmationKey() {
    #expect(AppModel.category(AppModel.drink(ml: 250)) == .water)
    #expect(
      AppModel.category(.recordCheckin(.init(kind: .recordCheckin, checkin: .init(date: "2026-10-02")))) == .checkin)
  }
}
