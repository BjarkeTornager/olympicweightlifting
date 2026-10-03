import Foundation
import NaturalLanguage
import SwiftUI

/// Where lines may break in Coach's words and other running text. SwiftUI's
/// Text breaks greedily: neither it nor UIKit's push-out strategy keeps a
/// paragraph's last word off a line of its own, and it hyphenates only a
/// word wider than the line. So the text itself says where not to break,
/// with non-breaking spaces, and where a long word may, with soft hyphens.
enum LineBreaks {
  /// The language a passage is written in, for its hyphenation and line
  /// breaking.
  enum Language: Equatable {
    case english, danish

    var locale: Locale { Locale(identifier: self == .danish ? "da_DK" : "en_GB") }
    var typesetting: Locale.Language { Locale.Language(identifier: self == .danish ? "da" : "en") }
  }

  /// Coach writes in English or Danish. A passage too short to tell goes
  /// by the language Coach was asked to use.
  static func language(of text: String) -> Language {
    let recognizer = NLLanguageRecognizer()
    recognizer.languageConstraints = [.english, .danish]
    recognizer.processString(text)
    let hypotheses = recognizer.languageHypotheses(withMaximum: 2)
    if let best = hypotheses.max(by: { $0.value < $1.value }), best.value >= 0.8 {
      return best.key == .danish ? .danish : .english
    }
    return CoachLanguage.current == .da ? .danish : .english
  }

  /// A paragraph of body text at a text size: figures kept with their
  /// units, long words hyphenated in its language, and its last two words
  /// kept together and left whole, so the last line never holds a word, or
  /// the end of one, alone. Markdown passes through: the marks are left as
  /// they are.
  static func paragraph(_ text: String, language: Language, size: DynamicTypeSize = .large) -> String {
    let words = hyphenate(keepFigures(text), language: language, from: size.longWord, last: size.longLastWord)
    return keepLastWords(words, within: size.wordsTogether)
  }

  /// A title or a heading: figures and the last two words kept together,
  /// and no word broken.
  static func title(_ text: String, size: DynamicTypeSize = .large) -> String {
    keepLastWords(keepFigures(text), within: size.wordsTogether)
  }

  // MARK: Spaces

  /// The last two words share a line when they are short enough to fit one
  /// together (`within` letters, marks aside), so a paragraph never ends on
  /// one word alone. A text of two words or fewer is left as it is.
  static func keepLastWords(_ text: String, within: Int = 20) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    // Only an ordinary space between them: a line break stays.
    guard within > 0, let last = trimmed.lastIndex(where: { $0 == " " || $0 == "\n" }), trimmed[last] == " "
    else { return text }
    let before = trimmed[..<last]
    guard let previous = before.lastIndex(where: { $0 == " " || $0 == "\n" }) else { return text }
    let pair = trimmed[trimmed.index(after: previous)...].filter { !"*_`\u{00AD}".contains($0) }
    guard pair.count <= within else { return text }
    var result = trimmed
    result.replaceSubrange(last...last, with: "\u{00A0}")
    return result
  }

  /// "8 h 6 min", "250 ml", "1,900 kcal", "28 September" and "28.
  /// september" never break inside.
  static func keepFigures(_ text: String) -> String {
    var result = text
    for (pattern, template) in figureRules {
      result = pattern.stringByReplacingMatches(
        in: result, range: NSRange(result.startIndex..., in: result), withTemplate: template)
    }
    return result
  }

  private static let units =
    "h|t|min|sek|s|ms|kg|g|mg|µg|mcg|IU|kcal|cal|kJ|km|m|cm|ml|dl|cl|L|l|bpm|%|°C|°|reps?|sets?|gange|sæt|×|x"
  private static let months =
    "January|February|March|April|May|June|July|August|September|October|November|December|"
    + "januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december|"
    + "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|jan|feb|mar|apr|jun|jul|aug|sep|okt|nov|dec"

  /// A figure and its unit; an hour and the minutes after it; a day and its
  /// month, with or without the Danish full stop.
  private static let figureRules: [(NSRegularExpression, String)] = [
    (#"(\d) (?=(?:\#(units))(?![\p{L}\d]))"#, "$1\u{00A0}"),
    (#"(?<=\d[\x{00A0} ](?:h|t)) (?=\d)"#, "\u{00A0}"),
    (#"(?<![\d.,])(\d{1,2}\.?) (?=(?:\#(months))(?![\p{L}]))"#, "$1\u{00A0}"),
    (#"(?<=\b(?:\#(months))) (?=\d{1,2}(?![\d:.,]\d))"#, "\u{00A0}"),
  ].map { pattern, template in
    // The patterns are fixed and valid.
    (try! NSRegularExpression(pattern: pattern), template)
  }

  // MARK: Hyphens

  /// Soft hyphens at the dictionary's breaks in words of `from` letters or
  /// more, at least three letters from either end and from each other, so a
  /// long English or Danish word can break in a narrow column instead of
  /// leaving a short line. The last two words take them only from `last`
  /// letters: a paragraph's last line is better whole. Links, addresses and
  /// code are left whole. For body text only: titles never break inside a
  /// word.
  static func hyphenate(_ text: String, language: Language, from: Int = 12, last: Int = .max) -> String {
    let locale = language.locale as CFLocale
    guard CFStringIsHyphenationAvailableForLocale(locale) else { return text }
    // The words, each with the spaces after it.
    var words: [(word: String, space: String)] = [("", "")]
    for character in text {
      if character.isWhitespace {
        words[words.count - 1].space.append(character)
      } else {
        if !words[words.count - 1].space.isEmpty { words.append(("", "")) }
        words[words.count - 1].word.append(character)
      }
    }
    return words.enumerated().map { index, piece in
      let ending = index >= words.count - 2
      return hyphenate(token: piece.word, from: ending ? last : from, locale: locale) + piece.space
    }
    .joined()
  }

  private static func hyphenate(token: String, from: Int, locale: CFLocale) -> String {
    guard token.count >= from, !token.contains(where: { "/@`=<>\\".contains($0) }), !token.contains("](")
    else { return token }
    var result = ""
    var word = ""
    for character in token {
      if character.isLetter {
        word.append(character)
      } else {
        result += breaks(word, from: from, locale: locale)
        word = ""
        result.append(character)
      }
    }
    return result + breaks(word, from: from, locale: locale)
  }

  private static func breaks(_ word: String, from: Int, locale: CFLocale) -> String {
    let letters = Array(word)
    guard letters.count >= from else { return word }
    let string = word as CFString
    let length = CFStringGetLength(string)
    var points: [Int] = []
    var limit = length
    while limit > 0 {
      let point = CFStringGetHyphenationLocationBeforeIndex(
        string, limit, CFRange(location: 0, length: length), 0, locale, nil)
      if point == kCFNotFound || point <= 0 { break }
      points.append(point)
      limit = point
    }
    // In UTF-16 offsets; the letters here are all single code units except
    // in rare cases, where the word is left whole.
    guard length == letters.count else { return word }
    var kept: [Int] = []
    for point in points.sorted() where point >= 3 && length - point >= 3 {
      if let previous = kept.last, point - previous < 3 { continue }
      kept.append(point)
    }
    var result = ""
    for (index, letter) in letters.enumerated() {
      if kept.contains(index) { result.append("\u{00AD}") }
      result.append(letter)
    }
    return result
  }
}

/// A paragraph of plain text with its line breaks set
/// (`LineBreaks.paragraph`), in its language: told from the text when not
/// given, as Coach's words are. For running text only; a title keeps its
/// words whole (`LineBreaks.title`).
struct Paragraph: View {
  let text: String
  var language: LineBreaks.Language?
  @Environment(\.dynamicTypeSize) private var typeSize

  init(_ text: String, language: LineBreaks.Language? = nil) {
    self.text = text
    self.language = language
  }

  var body: some View {
    let language = language ?? LineBreaks.language(of: text)
    Text(LineBreaks.paragraph(text, language: language, size: typeSize))
      .typesettingLanguage(language.typesetting)
  }
}

/// At the accessibility sizes a line holds only a few words: fewer letters
/// are kept together, and shorter words are hyphenated, so a word is broken
/// at a syllable rather than wherever the line ends.
extension DynamicTypeSize {
  /// How many letters the last two words of a paragraph may have to be
  /// kept together.
  fileprivate var wordsTogether: Int { isAccessibilitySize ? 12 : 20 }
  /// The shortest word that is hyphenated.
  fileprivate var longWord: Int { isAccessibilitySize ? 8 : 12 }
  /// The shortest of the last two words that is hyphenated: never at the
  /// default sizes, where any word fits a line, and only a word that may
  /// not at the largest.
  fileprivate var longLastWord: Int { isAccessibilitySize ? 12 : .max }
}
