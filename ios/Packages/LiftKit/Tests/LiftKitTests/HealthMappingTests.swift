import Foundation
import HealthKit
import Testing

@testable import LiftStore

@Suite("Apple Health mapping")
struct HealthMappingTests {
  @Test func sleepStages() {
    #expect(HealthSync.sleepValue(HKCategoryValueSleepAnalysis.asleepDeep.rawValue) == .deep)
    #expect(HealthSync.sleepValue(HKCategoryValueSleepAnalysis.asleepREM.rawValue) == .rem)
    #expect(HealthSync.sleepValue(HKCategoryValueSleepAnalysis.asleepCore.rawValue) == .core)
    #expect(HealthSync.sleepValue(HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue) == .asleep)
    #expect(HealthSync.sleepValue(HKCategoryValueSleepAnalysis.inBed.rawValue) == .inBed)
    #expect(HealthSync.sleepValue(HKCategoryValueSleepAnalysis.awake.rawValue) == .awake)
    #expect(HealthSync.sleepValue(99) == nil)
  }

  @Test("A night runs from local noon to local noon, even across a clock change")
  func nightWindow() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Europe/Copenhagen")!
    // Clocks went forward on 29 March 2026.
    let wake = calendar.date(from: DateComponents(year: 2026, month: 3, day: 29))!
    let from = HealthSync.noon(before: wake, calendar: calendar)!
    let to = HealthSync.noon(of: wake, calendar: calendar)!
    #expect(calendar.component(.hour, from: from) == 12)
    #expect(calendar.component(.hour, from: to) == 12)
    #expect(to.timeIntervalSince(from) == 23 * 3600)
  }

  @Test func distanceTypes() {
    #expect(HealthSync.distanceType(for: .running) == .distanceWalkingRunning)
    #expect(HealthSync.distanceType(for: .walking) == .distanceWalkingRunning)
    #expect(HealthSync.distanceType(for: .cycling) == .distanceCycling)
    #expect(HealthSync.distanceType(for: .swimming) == .distanceSwimming)
    #expect(HealthSync.distanceType(for: .rowing) == .distanceRowing)
    #expect(HealthSync.distanceType(for: .traditionalStrengthTraining) == nil)
  }

  @Test func workoutKinds() {
    func kind(_ type: HKWorkoutActivityType, indoor: Bool = false) -> (String, String) {
      let start = Date(timeIntervalSince1970: 1_790_000_000)
      let workout = HKWorkout(
        activityType: type, start: start, end: start.addingTimeInterval(1800),
        workoutEvents: nil, totalEnergyBurned: nil, totalDistance: nil,
        metadata: [HKMetadataKeyIndoorWorkout: indoor])
      let (k, name) = HealthSync.describe(workout)
      return (k.rawValue, name)
    }
    #expect(kind(.running) == ("running", "Outdoor Run"))
    #expect(kind(.running, indoor: true) == ("running", "Indoor Run"))
    #expect(kind(.walking) == ("walking", "Outdoor Walk"))
    #expect(kind(.swimming, indoor: true) == ("swimming", "Pool Swim"))
    #expect(kind(.traditionalStrengthTraining) == ("strength", "Strength Training"))
    #expect(kind(.yoga) == ("other", "Yoga"))
  }

  @Test("Timestamps carry the local offset the server expects")
  func timestamps() {
    let format = HealthSync.timestampFormatter()
    format.timeZone = TimeZone(identifier: "Europe/Copenhagen")
    let text = format.string(from: Date(timeIntervalSince1970: 1_790_000_000))
    #expect(text.hasSuffix("+02:00"))
  }
}
