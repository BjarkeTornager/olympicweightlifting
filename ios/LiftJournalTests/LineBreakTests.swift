import Foundation
import SwiftUI
import Testing

@testable import LiftJournal

@Suite("Line breaks")
struct LineBreakTests {
  static let space = "\u{00A0}"
  static let soft: Character = "\u{00AD}"

  @Test("A paragraph's last two words share a line, unless they are too long to")
  func lastWords() {
    #expect(
      LineBreaks.keepLastWords("Most other nights fell between seven and eight hours.")
        == "Most other nights fell between seven and eight\(Self.space)hours.")
    #expect(
      LineBreaks.keepLastWords("Søvnkvaliteten hænger fint sammen med hvilepulsen.")
        == "Søvnkvaliteten hænger fint sammen med\(Self.space)hvilepulsen.")
    // Strong marks don't count towards the length.
    #expect(LineBreaks.keepLastWords("It was **7 h 15 min**") == "It was **7 h 15\(Self.space)min**")
    #expect(LineBreaks.keepLastWords("Call ended.") == "Call ended.")
    #expect(
      LineBreaks.keepLastWords("Lowered resting heart extraordinarily consistently")
        == "Lowered resting heart extraordinarily consistently")
    // A line break before the last word stays as it is.
    #expect(LineBreaks.keepLastWords("First line\nsecond") == "First line\nsecond")
    #expect(LineBreaks.keepLastWords("Three short words", within: 0) == "Three short words")
  }

  @Test("Figures stay with their units, and days with their months, in English and Danish")
  func figures() {
    let s = Self.space
    #expect(
      LineBreaks.keepFigures("Your longest night was 8 h 6 min on 28 September.")
        == "Your longest night was 8\(s)h\(s)6\(s)min on 28\(s)September.")
    #expect(
      LineBreaks.keepFigures("Din længste nat var 8 t 6 min den 28. september.")
        == "Din længste nat var 8\(s)t\(s)6\(s)min den 28.\(s)september.")
    #expect(LineBreaks.keepFigures("Drink 250 ml, then 1,900 kcal") == "Drink 250\(s)ml, then 1,900\(s)kcal")
    #expect(LineBreaks.keepFigures("From September 28 on") == "From September\(s)28 on")
    // A word that only starts like a unit is left alone.
    #expect(LineBreaks.keepFigures("Rest 2 minutes and 30 sekunder") == "Rest 2 minutes and 30 sekunder")
    #expect(LineBreaks.keepFigures("Week 40 and 3 more") == "Week 40 and 3 more")
  }

  @Test("Long words take soft hyphens at the dictionary's breaks, away from their ends")
  func hyphens() {
    for (word, language) in [
      ("Søvnregelmæssighed", LineBreaks.Language.danish), ("styrketræningen", .danish),
      ("recommendations", .english), ("International", .english),
    ] {
      let set = LineBreaks.hyphenate(word, language: language, last: 12)
      #expect(set.filter { $0 != Self.soft } == word)
      #expect(set.contains(Self.soft), "\(word) has no break")
      for piece in set.split(separator: Self.soft) {
        #expect(piece.count >= 3, "\(set) breaks \(piece.count) letters from a break or an end")
      }
    }
    // Short words, links, addresses and code are left whole.
    for text in ["Søvn og puls", "https://example.com/restitution", "anna@restitution.dk", "`hydrationTarget`"] {
      #expect(LineBreaks.hyphenate("\(text) i dag", language: .danish, from: 8) == "\(text) i dag")
    }
  }

  @Test("A paragraph's last two words stay whole, unless one may not fit a line at the largest sizes")
  func lastLine() {
    let text = "Søvnkvaliteten hænger fint sammen med hvilepulsen"
    let large = LineBreaks.paragraph(text, language: .danish)
    #expect(large.hasSuffix("med\(Self.space)hvilepulsen"))
    #expect(!large.hasPrefix("Søvnkvaliteten "), "a long word earlier on is hyphenated")
    let largest = LineBreaks.paragraph(
      "Det handler om søvnregelmæssighed", language: .danish, size: .accessibility3)
    #expect(largest.hasPrefix("Det handler om "))
    #expect(largest.contains(Self.soft))
    // A pair too long to share a line at the largest sizes stays apart.
    #expect(LineBreaks.paragraph(text, language: .danish, size: .accessibility3).hasSuffix("med hvilepulsen"))
  }

  @Test("A title keeps its words whole; a paragraph is set in full")
  func titles() {
    let title = LineBreaks.title("Søvnregelmæssighed og restitution")
    #expect(!title.contains(Self.soft))
    #expect(title == "Søvnregelmæssighed og\(Self.space)restitution")
    let paragraph = LineBreaks.paragraph("Din længste nat var 8 t 6 min. Søvnregelmæssighed er vigtig.", language: .danish)
    #expect(paragraph.contains(Self.soft))
    #expect(paragraph.hasSuffix("er\(Self.space)vigtig."))
    #expect(paragraph.contains("8\(Self.space)t\(Self.space)6\(Self.space)min"))
  }

  @Test("Coach's language is told from the reply")
  func language() {
    #expect(
      LineBreaks.language(of: "Du har registreret søvn alle syv nætter i denne uge, og søvnkvaliteten er god.")
        == .danish)
    #expect(
      LineBreaks.language(of: "You logged sleep on all seven nights this week, and the quality was good.")
        == .english)
  }
}
