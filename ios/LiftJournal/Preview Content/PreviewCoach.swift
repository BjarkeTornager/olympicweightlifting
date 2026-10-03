#if DEBUG
  import Foundation
  import LiftAPI
  import UIKit

  /// Synthetic Coach conversations for SwiftUI previews: a week of sleep as a
  /// figure, a recipe with its picture, the queue's two states and a voice
  /// call. Nothing here is sent anywhere.
  extension PreviewData {
    static let pictureID = "0d4e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a40"

    static var sleepFigure: Visual {
      visual(
        """
        {"id": "fig-sleep", "kind": "bar_chart", "title": "Sleep, 26 Sep to 2 Oct", "unit": "h",
         "points": [{"label": "Sa 26", "value": 7.4}, {"label": "Su 27", "value": 6.6},
                    {"label": "Mo 28", "value": 8.1}, {"label": "Tu 29", "value": 7.0},
                    {"label": "We 30", "value": 6.2}, {"label": "Th 1", "value": 7.8},
                    {"label": "Fr 2", "value": 7.25}]}
        """)
    }

    static var recipe: Visual {
      visual(
        """
        {"id": "fig-recipe", "kind": "recipe", "title": "Salmon rice bowl", "servings": 2, "minutes": 25,
         "ingredients": [{"item": "Salmon fillet", "amount": "2 × 125 g"}, {"item": "Jasmine rice", "amount": "150 g"},
                         {"item": "Edamame", "amount": "100 g"}, {"item": "Cucumber", "amount": "½"},
                         {"item": "Soy sauce", "amount": "2 tbsp"}, {"item": "Sesame seeds", "amount": "1 tsp"}],
         "steps": ["Rinse the rice and cook it with 300 ml of water for 12 minutes.",
                   "Roast the salmon at 200 °C for 10 to 12 minutes, until it flakes.",
                   "Slice the cucumber, warm the edamame, and build the bowls on the rice."],
         "nutrition": {"kcal": 612, "protein": 42, "carbs": 58, "fat": 18},
         "pictureId": "\(pictureID)"}
        """)
    }

    /// A drawn stand-in for the dish's AI picture: a bowl of rice, salmon,
    /// edamame and cucumber from above.
    static var dishPicture: UIImage {
      let size = CGSize(width: 800, height: 600)
      return UIGraphicsImageRenderer(size: size).image { context in
        let cg = context.cgContext
        UIColor(red: 0.55, green: 0.42, blue: 0.32, alpha: 1).setFill()
        cg.fill(CGRect(origin: .zero, size: size))
        for row in stride(from: 0, to: 600, by: 46) {
          UIColor(red: 0.5, green: 0.38, blue: 0.29, alpha: 1).setFill()
          cg.fill(CGRect(x: 0, y: CGFloat(row), width: 800, height: 3))
        }
        let centre = CGPoint(x: 400, y: 300)
        func disc(_ point: CGPoint, _ radius: CGFloat, _ colour: UIColor) {
          colour.setFill()
          cg.fillEllipse(in: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
        }
        cg.setShadow(offset: CGSize(width: 0, height: 14), blur: 30, color: UIColor.black.withAlphaComponent(0.35).cgColor)
        disc(centre, 250, UIColor(red: 0.16, green: 0.2, blue: 0.27, alpha: 1))
        cg.setShadow(offset: .zero, blur: 0, color: nil)
        disc(centre, 226, UIColor(red: 0.95, green: 0.93, blue: 0.88, alpha: 1))
        // Salmon, sliced.
        UIColor(red: 0.96, green: 0.48, blue: 0.33, alpha: 1).setFill()
        for index in 0..<4 {
          let slice = UIBezierPath(
            roundedRect: CGRect(x: 250 + CGFloat(index) * 44, y: 150, width: 38, height: 150), cornerRadius: 16)
          slice.fill()
        }
        UIColor(red: 1, green: 0.78, blue: 0.68, alpha: 1).setStroke()
        for index in 0..<4 {
          let line = UIBezierPath()
          line.move(to: CGPoint(x: 258 + CGFloat(index) * 44, y: 170))
          line.addLine(to: CGPoint(x: 280 + CGFloat(index) * 44, y: 280))
          line.lineWidth = 4
          line.stroke()
        }
        // Edamame and cucumber.
        for index in 0..<14 {
          let angle = Double(index) * 0.45
          disc(
            CGPoint(x: 470 + 60 * cos(angle) * Double(index % 3 + 1) / 3, y: 380 + 40 * sin(angle)), 14,
            UIColor(red: 0.42, green: 0.62, blue: 0.27, alpha: 1))
        }
        for index in 0..<5 {
          let point = CGPoint(x: 280 + CGFloat(index) * 30, y: 400 + CGFloat(index % 2) * 26)
          disc(point, 30, UIColor(red: 0.62, green: 0.78, blue: 0.48, alpha: 1))
          disc(point, 22, UIColor(red: 0.86, green: 0.93, blue: 0.78, alpha: 1))
        }
        for index in 0..<40 {
          disc(
            CGPoint(x: 260 + CGFloat((index * 37) % 290), y: 160 + CGFloat((index * 53) % 300)), 3,
            UIColor(white: index % 2 == 0 ? 0.98 : 0.15, alpha: 1))
        }
      }
    }

    /// A message that couldn't be sent, and one waiting behind it.
    static func queuedCoach() -> CoachModel {
      let coach = CoachModel()
      coach.queue = [
        .init(
          id: UUID(), text: "What should I eat before tomorrow's session?", photos: [], sentAt: .now,
          account: "preview", failure: CoachModel.unreachableText),
        .init(id: UUID(), text: "Also log a flat white", photos: [], sentAt: .now, account: "preview"),
      ]
      return coach
    }

    /// Coach with today's thread: a week of sleep, a recipe with its
    /// picture, and the queue's two states.
    static func coach() -> CoachModel {
      let coach = queuedCoach()
      coach.turns = coachTurns
      coach.loaded = true
      CoachPicture.cache.setObject(dishPicture, forKey: pictureID as NSString)
      return coach
    }

    static var coachTurns: [CoachTurn] {
      let format = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
      let first = (Date.now - 1500).formatted(format)
      let second = (Date.now - 600).formatted(format)
      let json = """
        [{"id": "turn-sleep", "question": "How did I sleep this week?", "fromVoice": false, "photoIds": [],
          "createdAt": "\(first)", "status": "done",
          "reply": "You logged sleep on all 7 nights this week, averaging **7 h 12 min** from 26 September to 2 October.\\n\\nYour longest night was **8 h 6 min** on 28 September. The shortest was **6 h 12 min** on 30 September. Most other nights fell between 7 and 8 hours, including **7 h 15 min** last night.",
          "receipts": [], "visuals": [\(sleepJSON)]},
         {"id": "turn-recipe", "question": "Something with salmon for dinner? Show me a picture.", "fromVoice": false,
          "photoIds": [], "createdAt": "\(second)", "status": "done",
          "reply": "A quick bowl that keeps protein high after today's session. The picture is drawn for the card.",
          "receipts": [], "visuals": [\(recipeJSON)]}]
        """
      return (try? JSONDecoder().decode([CoachTurn].self, from: Data(json.utf8))) ?? []
    }

    /// A call with Coach answering two saves and asking the next question.
    static var callLines: [VoiceCall.Line] {
      [
        .init(
          id: "l1", role: .you,
          text: "Slept about seven hours. Yoghurt and granola for breakfast, rye bread with egg at lunch."),
        .init(id: "l2", role: .save, text: "Sleep", state: .saved),
        .init(id: "l3", role: .save, text: "Meal", state: .saved),
        .init(id: "l4", role: .save, text: "Meal", state: .saved),
        .init(
          id: "l5", role: .coach,
          text: "Noted, both meals are in with Undo. Sleep matches Apple Health. How's your energy been today?"),
      ]
    }

    private static var sleepJSON: String {
      String(decoding: (try? JSONEncoder().encode(sleepFigure)) ?? Data(), as: UTF8.self)
    }

    private static var recipeJSON: String {
      String(decoding: (try? JSONEncoder().encode(recipe)) ?? Data(), as: UTF8.self)
    }

    private static func visual(_ json: String) -> Visual {
      // The JSON above is fixed and valid.
      try! JSONDecoder().decode(Visual.self, from: Data(json.utf8))
    }
  }
#endif
