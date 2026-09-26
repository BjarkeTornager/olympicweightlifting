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
}
