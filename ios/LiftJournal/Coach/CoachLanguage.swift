import Foundation

/// The language Coach writes and speaks in, in chat and in voice check-ins.
/// Chosen in Profile and kept on this iPhone; until then it follows the
/// iPhone's own language when that's Danish, and is English otherwise.
enum CoachLanguage: String, CaseIterable, Identifiable {
  case en, da

  static let key = "coachLanguage"

  var id: Self { self }

  var title: String {
    switch self {
    case .en: "English"
    case .da: "Dansk"
    }
  }

  static var deviceDefault: CoachLanguage {
    Locale.preferredLanguages.first?.hasPrefix("da") == true ? .da : .en
  }

  static var current: CoachLanguage {
    UserDefaults.standard.string(forKey: key).flatMap(CoachLanguage.init) ?? deviceDefault
  }
}
