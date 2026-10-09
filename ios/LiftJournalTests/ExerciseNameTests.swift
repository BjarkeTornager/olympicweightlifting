import Testing

@testable import LiftJournal

@Suite("Exercise names")
struct ExerciseNameTests {
  @Test("Names compare as the server compares them: plurals, DB and & read as the library's")
  func keys() {
    #expect(ExerciseName.key("Front squats") == ExerciseName.key("front squat"))
    #expect(ExerciseName.key("DB rows") == "dumbbell row")
    #expect(ExerciseName.key("Clean & jerk") == "clean and jerk")
    #expect(ExerciseName.key("custom:Bench presses") == "bench press")
    #expect(ExerciseName.key("Reverse flies") == "reverse fly")
    #expect(ExerciseName.key("biceps") == "bicep")
    // A vowel sign belongs to its letter, so these stay two names.
    #expect(ExerciseName.key("काल") != ExerciseName.key("किल"))
  }

  @Test("A new exercise is saved as one tidy line, refused rather than cut")
  func tidy() {
    #expect(ExerciseName.tidy("  standing   cable\treverse fly ") == "Standing cable reverse fly")
    #expect(ExerciseName.tidy("custom: custom:EZ-bar curl") == "EZ-bar curl")
    #expect(ExerciseName.tidy("rdl\u{200B} pause") == "Rdl pause")
    for blank in ["", "   ", "\u{3164}", "\u{0301}", "\u{2800}", "\u{FE0F}"] {
      #expect(ExerciseName.tidy(blank) == nil)
    }
    #expect(ExerciseName.tidy(String(repeating: "a", count: 120))?.utf16.count == 120)
    #expect(ExerciseName.tidy(String(repeating: "a", count: 121)) == nil)
  }
}
