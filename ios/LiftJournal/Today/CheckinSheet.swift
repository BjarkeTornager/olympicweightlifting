import LiftAPI
import SwiftUI

/// Energy, soreness and bodyweight for today. Only what the athlete sets is
/// sent, so a check-in never clears values recorded elsewhere.
struct CheckinSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let existing: Components.Schemas.Checkin?

  @State private var energy: Int?
  @State private var soreness: Int?
  @State private var bodyweight = ""
  @State private var notes = ""
  @State private var saving = false

  var body: some View {
    NavigationStack {
      Form {
        Section("Energy") { Scale(value: $energy, low: "Drained", high: "Great") }
        Section("Soreness") { Scale(value: $soreness, low: "None", high: "Very sore") }
        Section("Bodyweight") {
          TextField("kg", text: $bodyweight)
            .keyboardType(.decimalPad)
        }
        Section("Notes") {
          TextField("Anything else?", text: $notes, axis: .vertical)
            .lineLimit(2...5)
        }
      }
      .navigationTitle("Check in")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save", role: .confirm) { Task { await save() } }
            .disabled(!changed || saving || weight == .invalid)
        }
      }
      .onAppear {
        energy = existing?.energy
        soreness = existing?.soreness
        bodyweight = existing?.bodyweight.map { $0.formatted() } ?? ""
        notes = existing?.notes ?? ""
      }
    }
    .presentationDetents([.medium, .large])
  }

  private enum Weight: Equatable { case none, valid(Double), invalid }
  private var weight: Weight {
    let text = bodyweight.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
    if text.isEmpty { return .none }
    guard let value = Double(text), (20...500).contains(value) else { return .invalid }
    return .valid(value)
  }

  private var changed: Bool {
    energy != existing?.energy || soreness != existing?.soreness
      || (weight != .none && weight != existing?.bodyweight.map { .valid($0) })
      || notes != (existing?.notes ?? "")
  }

  private func save() async {
    saving = true
    defer { saving = false }
    var checkin = Components.Schemas.RecordCheckinAction.CheckinPayload(date: JournalDay.string(.now))
    if energy != existing?.energy { checkin.energy = energy }
    if soreness != existing?.soreness { checkin.soreness = soreness }
    if case .valid(let value) = weight { checkin.bodyweight = value }
    if notes != (existing?.notes ?? "") { checkin.notes = notes }
    await model.save(.recordCheckin(.init(kind: .recordCheckin, checkin: checkin)), confirmation: "Check-in saved")
    dismiss()
  }
}

private struct Scale: View {
  @Binding var value: Int?
  let low: String
  let high: String

  var body: some View {
    VStack(spacing: 8) {
      HStack(spacing: 8) {
        ForEach(1...5, id: \.self) { n in
          Button("\(n)") {
            value = value == n ? nil : n
            UISelectionFeedbackGenerator().selectionChanged()
          }
          .font(.headline)
          .frame(maxWidth: .infinity, minHeight: 44)
          .background(value == n ? Color.accentColor : Color(.tertiarySystemFill), in: .rect(cornerRadius: 10))
          .foregroundStyle(value == n ? .white : .primary)
          .buttonStyle(.plain)
          .accessibilityAddTraits(value == n ? .isSelected : [])
        }
      }
      HStack {
        Text(low)
        Spacer()
        Text(high)
      }
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .padding(.vertical, 4)
  }
}
