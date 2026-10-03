import Foundation
import LiftAPI
import Testing

@testable import LiftJournal

@Suite("Voice call")
struct VoiceCallTests {
  typealias Line = VoiceCall.Line

  /// A card as the action route returns it (flattenVisual).
  static var recipeJSON: [String: Any] {
    [
      "id": "6c1f2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b", "kind": "recipe", "title": "Salmon rice bowl",
      "servings": 2, "minutes": 25,
      "ingredients": [
        ["item": "Salmon fillet", "amount": "250 g"], ["item": "Rice", "amount": "150 g"],
        ["item": "Cucumber", "amount": "1"], ["item": "Soy sauce", "amount": "2 tbsp"], ["item": "Sesame seeds"],
      ],
      "steps": ["Cook the rice.", "Pan-fry the salmon."],
      "nutrition": ["kcal": 620, "protein": 42],
    ]
  }

  @Test("Only what was said is stored as the transcript, never a save or a card")
  func transcript() throws {
    let card = try #require(VoiceCall.card(Self.recipeJSON))
    let lines = [
      Line(id: "1", role: .coach, text: "Sure, I'll put it on your screen."),
      Line(id: "2", role: .card, text: card.title, visual: card),
      Line(id: "3", role: .save, text: "Meal", state: .saved),
      Line(id: "4", role: .you, text: "Thanks"),
    ]
    #expect(
      VoiceCall.transcriptEntries(lines) == [
        ["role": "coach", "text": "Sure, I'll put it on your screen."], ["role": "you", "text": "Thanks"],
      ])
    #expect(lines.filter(\.spoken).map(\.id) == ["1", "4"])
  }

  @Test("A call that starts afresh after a drop hears the cards on screen, with their ids")
  func recap() throws {
    let card = try #require(VoiceCall.card(Self.recipeJSON))
    let lines = [
      Line(id: "1", role: .you, text: "What should I cook?"),
      Line(id: "2", role: .coach, text: "A salmon rice bowl."),
      Line(id: "card-1", role: .card, text: card.title, visual: card),
      Line(id: "3", role: .save, text: "Meal", state: .saved),
      Line(id: "4", role: .you, text: "What does it look like?"),
    ]
    #expect(
      VoiceCall.recap(lines)
        == """
        Athlete: What should I cook?
        Coach: A salmon rice bowl.
        (Card on screen: Salmon rice bowl, recipe, card_id card-1)
        Athlete: What does it look like?
        """)
  }

  @Test("The card in an action's reply decodes as the thread's visual; anything else is no card")
  func card() throws {
    let card = try #require(VoiceCall.card(Self.recipeJSON))
    #expect(card.kind == "recipe" && card.servings == 2)
    #expect(card.ingredients?.count == 5)
    #expect(VoiceCall.card(nil) == nil)
    #expect(VoiceCall.card(["kind": "recipe"]) == nil)
    #expect(VoiceCall.card("text") == nil)
  }

  @Test("A compact card offers the rest only when it leaves something out")
  func compact() throws {
    let recipe = try #require(VoiceCall.card(Self.recipeJSON))
    #expect(CoachVisualView.more(recipe) == "Full recipe")
    // A quick idea with a few ingredients and nothing else is shown whole.
    let idea = try #require(
      VoiceCall.card([
        "id": "i", "kind": "recipe", "title": "Skyr bowl", "servings": 1,
        "ingredients": [["item": "Skyr", "amount": "200 g"], ["item": "Berries"]],
      ]))
    #expect(CoachVisualView.more(idea) == nil)
    let rows = (1...8).map { ["Day \($0)", "\($0)"] }
    let long = try #require(
      VoiceCall.card(["id": "t", "kind": "table", "title": "Sleep", "columns": ["Day", "Hours"], "rows": rows]))
    #expect(CoachVisualView.more(long) == "Show all")
    let short = try #require(
      VoiceCall.card([
        "id": "t", "kind": "table", "title": "Sleep", "columns": ["Day", "Hours"], "rows": Array(rows.prefix(6)),
      ]))
    #expect(CoachVisualView.more(short) == nil)
  }

  @Test("A card's sheet closes before the camera opens, never both at once")
  func presentation() throws {
    let card = try #require(VoiceCall.card(Self.recipeJSON))
    let line = Line(id: "c", role: .card, text: card.title, visual: card)
    var over = CallPresentation()
    over.cameraRequested(true)
    #expect(over.camera && over.card == nil)
    // While the camera is up, a card doesn't open on top of it.
    over.expand(line)
    #expect(over.card == nil)
    over.cameraRequested(false)
    #expect(!over.camera)

    over.expand(line)
    #expect(over.card == line)
    // The coach opens the camera with the recipe open: the sheet goes first.
    over.cameraRequested(true)
    #expect(over.card == nil && !over.camera)
    over.sheetDismissed(cameraWaiting: true)
    #expect(over.camera)
    // The athlete closing the sheet themselves leaves the camera shut.
    over = CallPresentation()
    over.expand(line)
    over.card = nil
    over.sheetDismissed(cameraWaiting: false)
    #expect(!over.camera)
  }

  @Test("A picture added to a card on screen updates that card where it is")
  func picture() throws {
    let card = try #require(VoiceCall.card(Self.recipeJSON))
    #expect(VoiceCall.displayTools == ["show_card", "show_picture"])
    var lines = [Line(id: "1", role: .coach, text: "Here it is.")]
    lines = VoiceCall.placing(card, id: "card-1", in: lines)
    lines.append(Line(id: "2", role: .coach, text: "A picture's on its way."))
    #expect(lines.map(\.id) == ["1", "card-1", "2"])
    var json = Self.recipeJSON
    json["pictureId"] = "5a0c9e1d-7b3f-4e62-8d14-2f6a9c3b7e58"
    let drawn = try #require(VoiceCall.card(json))
    lines = VoiceCall.placing(drawn, id: "card-1", in: lines)
    #expect(lines.map(\.id) == ["1", "card-1", "2"])
    #expect(lines[1].visual?.pictureId == "5a0c9e1d-7b3f-4e62-8d14-2f6a9c3b7e58")
    // Another card is its own line.
    lines = VoiceCall.placing(card, id: "card-2", in: lines)
    #expect(lines.filter { $0.role == .card }.map(\.id) == ["card-1", "card-2"])
    // What ElevenLabs is told once the picture settles.
    #expect(
      VoiceCall.pictureNote(title: "Salmon rice bowl", ready: true)
        == "(The picture of Salmon rice bowl is now on the athlete's screen.)")
    #expect(VoiceCall.pictureNote(title: "Salmon rice bowl", ready: false).contains("couldn't be drawn"))
  }

  @Test("The end of the call counts saves and cards")
  func ended() {
    #expect(VoiceCallView.ended(saved: 0, cards: 0) == "Call ended.")
    #expect(VoiceCallView.ended(saved: 2, cards: 0) == "Call ended · 2 saved. Everything is in Coach, with Undo.")
    #expect(
      VoiceCallView.ended(saved: 2, cards: 1) == "Call ended · 2 saved · 1 card. Everything is in Coach, with Undo.")
    #expect(VoiceCallView.ended(saved: 0, cards: 2) == "Call ended · 2 cards. Everything is in Coach.")
  }

  @Test("The saves after a line gather in one row, between what was said and the cards")
  func rows() {
    let lines = [
      Line(id: "1", role: .you, text: "Slept seven hours, oats for breakfast."),
      Line(id: "2", role: .save, text: "Sleep", state: .saved),
      Line(id: "3", role: .save, text: "Meal", state: .saving),
      Line(id: "4", role: .coach, text: "Both are in."),
      Line(id: "5", role: .save, text: "Drink", state: .failed),
    ]
    let rows = TranscriptRow.rows(lines)
    #expect(rows.map(\.id) == ["1", "2", "4", "5"])
    guard case .saves(let saves) = rows[1] else {
      Issue.record("expected the saves together")
      return
    }
    #expect(saves.map(\.text) == ["Sleep", "Meal"])
  }

  @Test("The call shows the question Coach last asked, if its latest line asked one")
  func question() {
    let asked = [
      Line(id: "1", role: .coach, text: "Noted. How did you sleep? And what did you eat?"),
      Line(id: "2", role: .you, text: "Fine."),
    ]
    #expect(VoiceCallView.question(asked) == "And what did you eat?")
    #expect(VoiceCallView.question([Line(id: "1", role: .coach, text: "Both are in.")]) == nil)
    #expect(VoiceCallView.question([]) == nil)
  }
}
