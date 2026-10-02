import Foundation

/// Joining the live transcription's fragments into readable lines, as the
/// website does (appendLine and joinFragment in lib/voice-live.ts).
public enum LiveTranscript {
  /// Fragments usually carry their own spaces ("Did you " + "train?"), but a
  /// word sometimes arrives without one ("for" + "last night"). A space goes
  /// between words, numbers and after punctuation, but not inside a number
  /// such as 7.5.
  public static func join(_ text: String, _ next: String) -> String {
    guard let last = text.last, let first = next.first, !last.isWhitespace, !first.isWhitespace else {
      return text + next
    }
    if last == "." || last == ",", text.dropLast().last?.isNumber == true, first.isNumber {
      return text + next
    }
    let wordEnd = last.isLetter || last.isNumber || ".,!?;:…)".contains(last)
    let wordStart = first.isLetter || first.isNumber || first == "("
    return wordEnd && wordStart ? text + " " + next : text + next
  }

  /// Coach's words keep no em dashes, as on the server: an em dash, or a
  /// spaced en dash used as one, becomes a comma. An en dash in a range such
  /// as 3–5 stays.
  public static func withoutEmDashes(_ text: String) -> String {
    text.replacing(/\s*—\s*/, with: ", ")
      .replacing(" – ", with: ", ")
      .replacing(/, ([,.;:!?])/, with: { "\($0.output.1)" })
  }

  /// Whether a line ends a sentence. A completed turn starts a new line only
  /// then: the coach's reply sometimes arrives across two turns.
  public static func endsSentence(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespaces)
    let body = trimmed.reversed().drop { "\"”')]".contains($0) }
    return body.first.map { ".!?…".contains($0) } ?? false
  }
}
