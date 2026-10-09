import Foundation

/// How the picker compares and saves exercise names, the same way the server
/// does (lib/exercises.ts), so a typed name finds the library's exercise and
/// anything else is saved once as the athlete's own.
enum ExerciseName {
  /// The longest name the server accepts, in UTF-16 units.
  static let maxLength = 120

  /// Compares names, never shown: "Front squats" and "front squat", "DB row"
  /// and "dumbbell row", "Clean & jerk" and "clean and jerk" share one key.
  static func key(_ value: String) -> String {
    var text = visible(value.precomposedStringWithCanonicalMapping.lowercased())
    while text.hasPrefix("custom:") { text.removeFirst("custom:".count) }
    text = text.replacingOccurrences(of: "&", with: " and ")
    let words = text.unicodeScalars
      .map { isWordPart($0) ? String($0) : " " }
      .joined()
      .split(separator: " ")
      .map { $0 == "db" ? "dumbbell" : singular(String($0)) }
    return words.joined(separator: " ")
  }

  /// The name of a new exercise as it is saved: one line of single spaces
  /// without invisible characters, a capital first letter and the rest as
  /// typed ("RDL", "EZ-bar"). Nil when it has no letter or number to show, or
  /// is too long, rather than cut.
  static func tidy(_ raw: String) -> String? {
    var name = visible(raw.precomposedStringWithCanonicalMapping)
      .unicodeScalars
      .filter { !CharacterSet.controlCharacters.subtracting(.whitespacesAndNewlines).contains($0) }
      .map { CharacterSet.whitespacesAndNewlines.contains($0) ? " " : String($0) }
      .joined()
      .split(separator: " ")
      .joined(separator: " ")
    while name.lowercased().hasPrefix("custom:") {
      name = String(name.dropFirst("custom:".count)).trimmingCharacters(in: .whitespaces)
    }
    guard let first = name.first else { return nil }
    name = first.uppercased() + name.dropFirst()
    guard name.unicodeScalars.contains(where: isLetterOrNumber), name.utf16.count <= maxLength
    else { return nil }
    return name
  }

  /// Letters, combining marks and numbers make words; a combining mark
  /// belongs to its letter, so it still tells two names apart.
  private static func isWordPart(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .nonspacingMark, .spacingMark, .enclosingMark: true
    default: isLetterOrNumber(scalar)
    }
  }

  private static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
    switch scalar.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
      .decimalNumber, .letterNumber, .otherNumber:
      true
    default: false
    }
  }

  /// Without the characters a name never shows: format characters such as
  /// zero-width spaces, variation selectors, and the blank filler letters
  /// and braille blank that pass for a name while showing nothing.
  private static func visible(_ value: String) -> String {
    String(
      String.UnicodeScalarView(
        value.unicodeScalars.filter { scalar in
          let v = scalar.value
          return scalar.properties.generalCategory != .format
            && !(0xFE00...0xFE0F).contains(v) && !(0xE0100...0xE01EF).contains(v)
            && ![0x115F, 0x1160, 0x3164, 0xFFA0, 0x2800].contains(v)
        }))
  }

  /// A word in the singular: squats, presses, crunches and flies are squat,
  /// press, crunch and fly.
  private static func singular(_ word: String) -> String {
    if word.count < 3 || ["ss", "us", "is"].contains(where: word.hasSuffix) { return word }
    if word.hasSuffix("ies") && word.count > 4 { return word.dropLast(3) + "y" }
    if ["sses", "shes", "ches", "xes", "zes"].contains(where: word.hasSuffix) { return String(word.dropLast(2)) }
    return word.hasSuffix("s") ? String(word.dropLast()) : word
  }
}
