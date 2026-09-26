import LiftAPI
import SwiftUI

/// Energy, soreness, bodyweight and body fat for today. Only what the
/// athlete changes is sent, so a check-in never clears values recorded
/// elsewhere. Body fat is its own dated reading beside the check-in.
struct CheckinSheet: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let existing: Components.Schemas.Checkin?
  var body_: Components.Schemas.Body?

  @State private var energy: Int?
  @State private var soreness: Int?
  @State private var bodyweight: Double?
  @State private var notes = ""
  @State private var bodyFat: Double?
  @State private var method: Components.Schemas.BodyFatInput.MethodPayload?
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
        Section {
          HStack {
            TextField("Body fat", value: $bodyFat, format: .number.precision(.fractionLength(0...1)))
              .keyboardType(.decimalPad)
            Text("%").foregroundStyle(.secondary)
          }
          Picker("Measured with", selection: $method) {
            Text("Not sure").tag(Components.Schemas.BodyFatInput.MethodPayload?.none)
            Text("Scale").tag(Components.Schemas.BodyFatInput.MethodPayload?.some(.scale))
            Text("DEXA scan").tag(Components.Schemas.BodyFatInput.MethodPayload?.some(.dexa))
            Text("Calipers").tag(Components.Schemas.BodyFatInput.MethodPayload?.some(.calipers))
            Text("Tape measure").tag(Components.Schemas.BodyFatInput.MethodPayload?.some(.tape))
            Text("Estimate").tag(Components.Schemas.BodyFatInput.MethodPayload?.some(.estimate))
          }
        } header: {
          Text("Body fat")
        } footer: {
          Text("Methods differ by a few points, and scales move with hydration. Use the same one each time; the trend is what counts.")
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
            .disabled(!changed || saving || !weightValid || !bodyFatValid)
        }
      }
      .onAppear {
        energy = existing?.energy
        soreness = existing?.soreness
        bodyweight = existing?.bodyweight
        notes = existing?.notes ?? ""
        if let body_, body_.bodyFatDate == JournalDay.string(.now), body_.bodyFatFromAppleHealth != true {
          bodyFat = body_.bodyFatPercent
          method = body_.bodyFatMethod.flatMap(Components.Schemas.BodyFatInput.MethodPayload.init(rawValue:))
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private var weightValid: Bool { bodyweight.map { (20...500).contains($0) } ?? true }
  private var bodyFatValid: Bool { bodyFat.map { (3...70).contains($0) } ?? true }

  private var checkinChanged: Bool {
    energy != existing?.energy || soreness != existing?.soreness
      || (bodyweight != nil && bodyweight != existing?.bodyweight) || notes != (existing?.notes ?? "")
  }

  private var bodyFatChanged: Bool {
    guard let bodyFat else { return false }
    let today = JournalDay.string(.now)
    let saved = body_?.bodyFatDate == today && body_?.bodyFatFromAppleHealth != true
    return !saved || bodyFat != body_?.bodyFatPercent || method?.rawValue != body_?.bodyFatMethod
  }

  private var changed: Bool { checkinChanged || bodyFatChanged }

  private func save() async {
    saving = true
    defer { saving = false }
    var checkin = Components.Schemas.RecordCheckinAction.CheckinPayload(date: JournalDay.string(.now))
    if energy != existing?.energy { checkin.energy = energy }
    if soreness != existing?.soreness { checkin.soreness = soreness }
    if let bodyweight, bodyweight != existing?.bodyweight { checkin.bodyweight = bodyweight }
    if notes != (existing?.notes ?? "") { checkin.notes = notes }
    if checkinChanged {
      await model.save(.recordCheckin(.init(kind: .recordCheckin, checkin: checkin)), confirmation: "Check-in saved")
    }
    if bodyFatChanged, let bodyFat {
      await model.save(
        .recordBodyFat(
          .init(
            kind: .recordBodyFat,
            bodyFat: .init(date: JournalDay.string(.now), percent: bodyFat, method: method))),
        confirmation: "Body fat saved")
    }
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
