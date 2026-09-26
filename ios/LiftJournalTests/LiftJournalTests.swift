import LiftAPI
import Testing
import UIKit

@testable import LiftJournal

@Suite("App")
struct LiftJournalTests {
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
}
