import Foundation
import NaturalLanguage
import SwiftUI
import UIKit

/// Where lines may break in Coach's words and other running text. SwiftUI's
/// Text breaks greedily: neither it nor UIKit's push-out strategy keeps a
/// paragraph's last word off a line of its own. So the text itself says
/// where not to break, with non-breaking spaces. Nor has it a hyphenation
/// setting: a word is hyphenated only when it holds a soft hyphen, and then
/// at any of the system dictionary's breaks for the typesetting language,
/// not only at its soft hyphens. So the soft hyphens choose which words may
/// break, at the same dictionary's breaks, and the paragraph's language is
/// set beside them (`typesettingLanguage`) for the dictionary to match.
enum LineBreaks {
  /// The language a passage is written in, for its hyphenation and line
  /// breaking.
  enum Language: Equatable {
    case english, danish

    var locale: Locale { Locale(identifier: self == .danish ? "da_DK" : "en_GB") }
    var typesetting: Locale.Language { Locale.Language(identifier: self == .danish ? "da" : "en") }

    /// The language Coach was asked to use.
    static var coach: Language { CoachLanguage.current == .da ? .danish : .english }
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
    return .coach
  }

  /// A paragraph of body text at a text size: figures kept with their
  /// units, long words hyphenated in its language, and its last two words
  /// kept together and left whole, so the last line never holds a word, or
  /// the end of one, alone. While Coach is still writing it (not
  /// `finished`), its end is left alone and every word is treated alike, so
  /// the lines above don't move as each word arrives. Markdown passes
  /// through: the marks are left as they are.
  static func paragraph(
    _ text: String, language: Language, size: DynamicTypeSize = .large, finished: Bool = true
  ) -> String {
    guard finished else {
      let long = size.longWord
      return hyphenate(keepFigures(text), language: language, long: long, longLast: long)
    }
    // A finished paragraph is set once: a reply is drawn again with every
    // piece Coach sends, and on every scroll.
    let key = "\(language) \(size) \(text)" as NSString
    if let set = paragraphs.object(forKey: key) { return set as String }
    let long = size.longWord
    // The last two words break only at the accessibility sizes, and only
    // when one may not fit a line whole: a paragraph's last line is better
    // whole.
    let words = hyphenate(
      keepFigures(text), language: language, long: long, longLast: size.isAccessibilitySize ? long : { _ in false })
    let set = keepLastWords(words, within: size.wordsTogether)
    paragraphs.setObject(set as NSString, forKey: key)
    return set
  }

  private static let paragraphs = NSCache<NSString, NSString>()

  /// A title or a heading: figures and the last two words kept together,
  /// and no word broken. While it is still being written (not `finished`),
  /// only its figures.
  static func title(_ text: String, size: DynamicTypeSize = .large, finished: Bool = true) -> String {
    finished ? keepLastWords(keepFigures(text), within: size.wordsTogether) : keepFigures(text)
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

  /// "8 h 6 min", "250 ml", "1,900 kcal", "3 × 5", "10 to 12", "28
  /// September" and "28. september" never break inside.
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

  /// A figure and its unit; an hour and the minutes after it; sets by reps;
  /// a range; a day and its month, with or without the Danish full stop.
  private static let figureRules: [(NSRegularExpression, String)] = [
    (#"(\d) (?=(?:\#(units))(?![\p{L}\d]))"#, "$1\u{00A0}"),
    (#"(?<=\d[\x{00A0} ](?:h|t)) (?=\d)"#, "\u{00A0}"),
    (#"(?<=\d[\x{00A0} ][×x]) (?=\d)"#, "\u{00A0}"),
    (#"(?<=\d) (?=(?:to|til) \d)"#, "\u{00A0}"),
    (#"(?<=\d\x{00A0}(?:to|til)) (?=\d)"#, "\u{00A0}"),
    (#"(?<![\d.,])(\d{1,2}\.?) (?=(?:\#(months))(?![\p{L}]))"#, "$1\u{00A0}"),
    (#"(?<=\b(?:\#(months))) (?=\d{1,2}(?![\d:.,]\d))"#, "\u{00A0}"),
  ].map { pattern, template in
    // The patterns are fixed and valid.
    (try! NSRegularExpression(pattern: pattern), template)
  }

  // MARK: Hyphens

  /// Soft hyphens at the dictionary's breaks in words of `from` letters or
  /// more, and in the last two words only from `last` letters.
  static func hyphenate(_ text: String, language: Language, from: Int = 12, last: Int = .max) -> String {
    hyphenate(text, language: language, long: { $0.count >= from }, longLast: { $0.count >= last })
  }

  /// Soft hyphens at the dictionary's breaks in the `long` words, at least
  /// two letters from the start and three from the end, so a long English
  /// or Danish word can break in a narrow column instead of leaving a short
  /// line. Every break is kept, the joint of a compound ("styrke-træning")
  /// with the rest: a line uses one at most, and the system breaks such a
  /// word at any of them anyway. The last two words take them only when
  /// `longLast`. Links, addresses and code are left whole. For body text
  /// only: titles never break inside a word.
  static func hyphenate(
    _ text: String, language: Language, long: (String) -> Bool, longLast: (String) -> Bool
  ) -> String {
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
      return hyphenate(token: piece.word, long: ending ? longLast : long, locale: locale) + piece.space
    }
    .joined()
  }

  private static func hyphenate(token: String, long: (String) -> Bool, locale: CFLocale) -> String {
    guard !token.contains(where: { "/@`=<>\\".contains($0) }), !token.contains("]("),
      long(token.filter { !"*_".contains($0) })
    else { return token }
    var result = ""
    var word = ""
    for character in token {
      if character.isLetter {
        word.append(character)
      } else {
        result += breaks(word, long: long, locale: locale)
        word = ""
        result.append(character)
      }
    }
    return result + breaks(word, long: long, locale: locale)
  }

  private static func breaks(_ word: String, long: (String) -> Bool, locale: CFLocale) -> String {
    let letters = Array(word)
    guard letters.count >= 5, long(word) else { return word }
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
    let kept = Set(points.filter { $0 >= 2 && length - $0 >= 3 })
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

/// At the accessibility sizes a line of Coach's serif holds only 13 to 23
/// letters in a phone's narrowest column: fewer letters are kept together,
/// and only a word that may not fit a line whole is hyphenated, so it
/// breaks at a syllable rather than wherever the line ends. A word that
/// fits is better moved to the next line whole.
extension DynamicTypeSize {
  /// How many letters the last two words of a paragraph may have to be
  /// kept together: about two thirds of a line.
  fileprivate var wordsTogether: Int {
    switch self {
    case .accessibility1: 16
    case .accessibility2: 14
    case .accessibility3: 12
    case .accessibility4: 10
    case .accessibility5: 9
    default: 20
    }
  }

  /// The words that are hyphenated: at the default sizes, where a line
  /// holds over 30 letters, those of 12 letters or more; at the
  /// accessibility sizes, only those wider than a line of Coach's serif in
  /// the narrowest column, whatever their letters ("restitutionen" fits at
  /// AX5, "edamamebønner" does not).
  fileprivate var longWord: (String) -> Bool {
    guard isAccessibilitySize else { return { $0.count >= 12 } }
    let font = LineBreaks.serif(self)
    return { ($0 as NSString).size(withAttributes: [.font: font]).width > LineBreaks.narrowestMeasure }
  }
}

extension LineBreaks {
  /// The narrowest column Coach writes in: a 375 pt phone's, less the
  /// page's gutters and the letter's margin.
  fileprivate static let narrowestMeasure: CGFloat = 375 - 2 * 20 - 14

  /// Coach's serif at a text size, as `folio(.coach)` sets it.
  fileprivate static func serif(_ size: DynamicTypeSize) -> UIFont {
    let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(size))
    let points = UIFontMetrics(forTextStyle: .body).scaledValue(for: 18, compatibleWith: traits)
    let system = UIFont.systemFont(ofSize: points)
    return UIFont(descriptor: system.fontDescriptor.withDesign(.serif) ?? system.fontDescriptor, size: points)
  }
}
