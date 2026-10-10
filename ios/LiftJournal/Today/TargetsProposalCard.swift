import LiftAPI
import LiftTheme
import SwiftUI

/// New daily targets the goals plan suggests, from the server: why, the
/// targets now and suggested, and the plan's notes. Nothing changes until
/// the athlete takes them; keeping the current ones means the plan suggests
/// again only once it moves on. One that sets a deficit without answers to
/// the low-energy questions asks them first, as the goals form does: taking
/// it needs an answer, and with a yes the plan holds the weight instead.
struct TargetsProposalCard: View {
  @Environment(AppModel.self) private var model
  let proposal: Components.Schemas.TargetsProposal
  @State private var saving = false
  @State private var answer: EnergyAnswer?

  typealias EnergyAnswer = Components.Schemas.TakeSuggestedTargetsAction.EnergyAnswerPayload

  var body: some View {
    let shown = Self.shown(proposal, answer: answer)
    VStack(alignment: .leading, spacing: 0) {
      Rectangle().fill(Theme.ink).frame(height: 1)
      Text("From your goals plan").foregroundStyle(Theme.ink).kicker()
        .padding(.vertical, 12)
      VStack(alignment: .leading, spacing: 6) {
        Text(proposal.title)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(Theme.ink)
        ForEach(proposal.reasons, id: \.self) {
          Paragraph($0, language: .english).folio(.note).foregroundStyle(Theme.ink)
        }
      }
      .fixedSize(horizontal: false, vertical: true)
      .accessibilityElement(children: .combine)
      VStack(spacing: 0) {
        ForEach(Self.rows(shown), id: \.label) { row in
          LabeledContent {
            Text(row.value).monospacedDigit().foregroundStyle(Theme.ink)
          } label: {
            Text(row.label).foregroundStyle(Theme.inkSecondary)
          }
          .font(.subheadline)
          .padding(.vertical, 6)
          .accessibilityElement(children: .combine)
        }
      }
      .padding(.top, 10)
      ForEach(Self.notes(proposal, answer: answer), id: \.self) {
        Paragraph($0, language: .english)
          .font(.footnote)
          .foregroundStyle(Theme.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 6)
      }
      if let check = proposal.energyCheck {
        energyCheck(check).padding(.top, 14)
      }
      HStack(spacing: 10) {
        Button("Use these targets") { choose(take: true) }
          .buttonStyle(PrimaryButtonStyle(height: 44, fullWidth: false))
          .disabled(proposal.energyCheck != nil && answer == nil)
        Button("Keep mine") { choose(take: false) }
          .buttonStyle(SecondaryButtonStyle())
      }
      .disabled(saving)
      .padding(.top, 14)
    }
  }

  /// The questions, an answer to choose, and what is kept and what a yes
  /// does.
  private func energyCheck(_ check: Components.Schemas.TargetsProposal.EnergyCheckPayload) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(check.title)
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(Theme.ink)
      ForEach(check.questions, id: \.self) {
        Paragraph($0, language: .english).folio(.note).foregroundStyle(Theme.ink)
      }
      Picker("Yes to any of these", selection: $answer) {
        Text("No").tag(EnergyAnswer?.some(.no))
        Text("Yes").tag(EnergyAnswer?.some(.yes))
        Text("Rather not say").tag(EnergyAnswer?.some(.preferNotToSay))
      }
      .pickerStyle(.segmented)
      .sensoryFeedback(.selection, trigger: answer)
      .accessibilityLabel("Yes to any of these")
      Paragraph(check.note, language: .english)
        .font(.footnote)
        .foregroundStyle(Theme.inkSecondary)
    }
    .fixedSize(horizontal: false, vertical: true)
  }

  private func choose(take: Bool) {
    saving = true
    Task {
      await model.chooseTargets(proposal, take: take, answer: answer)
      saving = false
    }
  }

  /// The suggestion as it would be saved: with a yes to the low-energy
  /// questions, the targets that hold the weight.
  static func shown(
    _ p: Components.Schemas.TargetsProposal, answer: EnergyAnswer?
  ) -> Components.Schemas.TargetsProposal {
    guard answer == .yes, let ifYes = p.energyCheck?.ifYes else { return p }
    var held = p
    held.suggested = ifYes
    return held
  }

  /// The plan's notes not already given as reasons, and the goals check the
  /// suggestion agrees, which a yes doesn't: the plan then holds the weight,
  /// and its own notes say why and who can help. An older server sends
  /// none for it, and the deficit's would contradict it.
  static func notes(_ p: Components.Schemas.TargetsProposal, answer: EnergyAnswer?) -> [String] {
    let held = answer == .yes && p.energyCheck != nil
    let notes = held ? p.energyCheck?.ifYesNotes ?? [] : p.notes
    return notes.filter { !p.reasons.contains($0) } + [held ? nil : p.followUp].compactMap { $0 }
  }

  /// "Energy  2,640 → 3,000 kcal", a line for each target that changes,
  /// and the goal when it does.
  static func rows(_ p: Components.Schemas.TargetsProposal) -> [(label: String, value: String)] {
    let goals = ["maintain": "Hold weight", "lose": "Lose weight", "gain": "Gain weight"]
    var rows: [(label: String, value: String)] = []
    if p.current.goal != p.suggested.goal {
      rows.append(
        ("Goal", "\(goals[p.current.goal] ?? p.current.goal) → \(goals[p.suggested.goal] ?? p.suggested.goal)"))
    }
    for (label, unit, now, next) in [
      ("Energy", "kcal", p.current.calories, p.suggested.calories),
      ("Protein", "g", p.current.protein, p.suggested.protein),
      ("Carbs", "g", p.current.carbs, p.suggested.carbs),
      ("Fat", "g", p.current.fat, p.suggested.fat),
    ] where now != next {
      let value = { (v: Double?) in v.map { "\(Format.number($0)) \(unit)" } ?? "none" }
      rows.append((label, "\(value(now)) → \(value(next))"))
    }
    return rows
  }
}
