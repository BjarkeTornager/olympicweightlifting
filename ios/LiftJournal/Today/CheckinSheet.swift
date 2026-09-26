import LiftAPI
import SwiftUI

/// Energy, soreness and bodyweight for today. Only what the athlete changes
/// is sent, so a check-in never clears values recorded elsewhere.
struct CheckinSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let existing: Components.Schemas.Checkin?

  @State private var energy: Int?
  @State private var soreness: Int?
  @State private var bodyweight: Double?
  @State private var notes = ""
  @State private var saving = false
  @FocusState private var weightFocused: Bool

  var body: some View {
    NavigationStack {
      Form {
        Section {
          ScalePicker(value: $energy)
        } header: {
          Text("Energy")
        } footer: {
          Text("1 is drained, 5 is full of energy.")
        }
        Section {
          ScalePicker(value: $soreness)
        } header: {
          Text("Soreness")
        } footer: {
          Text("1 is no soreness, 5 is very sore.")
        }
        Section("Bodyweight") {
          HStack {
            TextField("Weight", value: $bodyweight, format: .number.precision(.fractionLength(0...1)))
              .keyboardType(.decimalPad)
              .focused($weightFocused)
            Text("kg").foregroundStyle(.secondary)
          }
        }
        Section("Notes") {
          TextField("Anything else about today?", text: $notes, axis: .vertical)
            .lineLimit(2...6)
        }
      }
      .navigationTitle("Check In")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", role: .cancel) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save", role: .confirm) { Task { await save() } }
            .disabled(!changed || saving || !weightValid)
        }
      }
      .onAppear {
        energy = existing?.energy
        soreness = existing?.soreness
        bodyweight = existing?.bodyweight
        notes = existing?.notes ?? ""
      }
    }
    .presentationDetents([.medium, .large])
  }

  private var weightValid: Bool { bodyweight.map { (20...500).contains($0) } ?? true }

  private var changed: Bool {
    energy != existing?.energy || soreness != existing?.soreness
      || (bodyweight != nil && bodyweight != existing?.bodyweight) || notes != (existing?.notes ?? "")
  }

  private func save() async {
    saving = true
    defer { saving = false }
    var checkin = Components.Schemas.RecordCheckinAction.CheckinPayload(date: JournalDay.string(.now))
    if energy != existing?.energy { checkin.energy = energy }
    if soreness != existing?.soreness { checkin.soreness = soreness }
    if let bodyweight, bodyweight != existing?.bodyweight { checkin.bodyweight = bodyweight }
    if notes != (existing?.notes ?? "") { checkin.notes = notes }
    await model.save(.recordCheckin(.init(kind: .recordCheckin, checkin: checkin)), confirmation: "Check-in saved")
    dismiss()
  }
}

/// A 1–5 rating as the standard segmented control.
private struct ScalePicker: View {
  @Binding var value: Int?

  var body: some View {
    Picker("Rating", selection: $value) {
      ForEach(1...5, id: \.self) { Text("\($0)").tag(Optional($0)) }
    }
    .pickerStyle(.segmented)
    .labelsHidden()
    .sensoryFeedback(.selection, trigger: value)
  }
}
