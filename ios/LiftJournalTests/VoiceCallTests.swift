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

  @Test("The end of the call counts saves and cards")
  func ended() {
    #expect(VoiceCallView.ended(saved: 0, cards: 0) == "Call ended.")
    #expect(VoiceCallView.ended(saved: 2, cards: 0) == "Call ended · 2 saved. Everything is in Coach, with Undo.")
    #expect(
      VoiceCallView.ended(saved: 2, cards: 1) == "Call ended · 2 saved · 1 card. Everything is in Coach, with Undo.")
    #expect(VoiceCallView.ended(saved: 0, cards: 2) == "Call ended · 2 cards. Everything is in Coach.")
  }
}
