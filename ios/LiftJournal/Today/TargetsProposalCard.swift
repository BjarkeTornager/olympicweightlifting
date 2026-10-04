import LiftAPI
import LiftTheme
import SwiftUI

/// New daily targets the goals plan suggests, from the server: why, the
/// targets now and suggested, and the plan's notes. Nothing changes until
/// the athlete takes them; keeping the current ones means the plan suggests
/// again only once it moves on.
struct TargetsProposalCard: View {
  @Environment(AppModel.self) private var model
  let proposal: Components.Schemas.TargetsProposal
  @State private var saving = false

  var body: some View {
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
        ForEach(Self.rows(proposal), id: \.label) { row in
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
      ForEach(proposal.notes.filter { !proposal.reasons.contains($0) } + [proposal.followUp].compactMap { $0 }, id: \.self) {
        Paragraph($0, language: .english)
          .font(.footnote)
          .foregroundStyle(Theme.inkSecondary)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 6)
      }
      HStack(spacing: 10) {
        Button("Use these targets") { choose(take: true) }
          .buttonStyle(PrimaryButtonStyle(height: 44, fullWidth: false))
        Button("Keep mine") { choose(take: false) }
          .buttonStyle(SecondaryButtonStyle())
      }
      .disabled(saving)
      .padding(.top, 14)
    }
  }

  private func choose(take: Bool) {
    saving = true
    Task {
      await model.chooseTargets(proposal, take: take)
      saving = false
    }
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
