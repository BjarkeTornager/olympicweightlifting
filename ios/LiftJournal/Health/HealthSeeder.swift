#if DEBUG && targetEnvironment(simulator)
  import CoreLocation
  import HealthKit
  import LiftStore

  /// Simulator-only: writes a few days of synthetic sleep, heart rate and
  /// workouts into the simulator's Apple Health, so the import can be tested
  /// end to end. Launch with `-seedHealth`. Never compiled into device builds.
  enum HealthSeeder {
    static var requested: Bool { ProcessInfo.processInfo.arguments.contains("-seedHealth") }

    static func seed() async throws {
      let store = HealthSync.shared.store
      let sleep = HKCategoryType(.sleepAnalysis)
      let resting = HKQuantityType(.restingHeartRate)
      let hrv = HKQuantityType(.heartRateVariabilitySDNN)
      let heart = HKQuantityType(.heartRate)
      let steps = HKQuantityType(.stepCount)
      let energy = HKQuantityType(.activeEnergyBurned)
      let distance = HKQuantityType(.distanceWalkingRunning)
      let bodyFat = HKQuantityType(.bodyFatPercentage)
      let write: Set<HKSampleType> = [
        sleep, resting, hrv, heart, steps, energy, distance, bodyFat, .workoutType(), HKSeriesType.workoutRoute(),
      ]
      try await store.requestAuthorization(toShare: write, read: HealthSync.readTypes)

      let calendar = Calendar.current
      let bpm = HKUnit.count().unitDivided(by: .minute())
      var samples: [HKSample] = []
      for back in 0..<3 {
        let day = calendar.date(byAdding: .day, value: -back, to: calendar.startOfDay(for: .now))!
        let bed = calendar.date(byAdding: .minute, value: -75, to: day)!  // 22:45
        let stages: [(HKCategoryValueSleepAnalysis, Int)] = [
          (.asleepCore, 110), (.asleepDeep, 70), (.asleepCore, 90), (.asleepREM, 45),
          (.awake, 10), (.asleepCore, 80), (.asleepREM, 40),
        ]
        var at = bed
        for (stage, minutes) in stages {
          let end = at.addingTimeInterval(TimeInterval(minutes * 60))
          samples.append(HKCategorySample(type: sleep, value: stage.rawValue, start: at, end: end))
          at = end
        }
        let morning = calendar.date(byAdding: .hour, value: 8, to: day)!
        samples.append(
          HKQuantitySample(
            type: resting, quantity: HKQuantity(unit: bpm, doubleValue: Double(52 + back)),
            start: morning, end: morning))
        samples.append(
          HKQuantitySample(
            type: hrv, quantity: HKQuantity(unit: .secondUnit(with: .milli), doubleValue: 58 + Double(back) * 3),
            start: morning, end: morning))
        let noon = calendar.date(byAdding: .hour, value: 12, to: day)!
        if noon < .now {
          samples.append(
            HKQuantitySample(
              type: steps, quantity: HKQuantity(unit: .count(), doubleValue: Double(8000 + back * 700)),
              start: noon.addingTimeInterval(-3600), end: noon))
        }
      }
      // This morning's smart-scale reading.
      let weighIn = calendar.date(byAdding: .hour, value: 7, to: calendar.startOfDay(for: .now))!
      samples.append(
        HKQuantitySample(
          type: bodyFat, quantity: HKQuantity(unit: .percent(), doubleValue: 0.148), start: weighIn, end: weighIn))
      try await store.save(samples)

      // Yesterday's run with heart rate and distance.
      let yesterday = calendar.date(byAdding: .day, value: -1, to: calendar.startOfDay(for: .now))!
      let start = calendar.date(byAdding: .hour, value: 7, to: yesterday)!
      let configuration = HKWorkoutConfiguration()
      configuration.activityType = .running
      configuration.locationType = .outdoor
      let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
      try await builder.beginCollection(at: start)
      let end = start.addingTimeInterval(45 * 60)
      var run: [HKSample] = [
        HKQuantitySample(
          type: distance, quantity: HKQuantity(unit: .meterUnit(with: .kilo), doubleValue: 8.4),
          start: start, end: end),
        HKQuantitySample(
          type: energy, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: 540), start: start, end: end),
      ]
      for minute in stride(from: 0, to: 45, by: 3) {
        let at = start.addingTimeInterval(TimeInterval(minute * 60))
        run.append(
          HKQuantitySample(
            type: heart, quantity: HKQuantity(unit: bpm, doubleValue: 138 + Double(minute % 15)),
            start: at, end: at))
      }
      try await builder.addSamples(run)
      try await builder.endCollection(at: end)
      _ = try await builder.finishWorkout()
      try await seedWalk(store: store, distance: distance)
    }

    /// Today's out-and-back walk along the Copenhagen lakes, with its route.
    private static func seedWalk(store: HKHealthStore, distance: HKQuantityType) async throws {
      let start = Date.now.addingTimeInterval(-3 * 3600)
      let end = start.addingTimeInterval(40 * 60)
      let configuration = HKWorkoutConfiguration()
      configuration.activityType = .walking
      configuration.locationType = .outdoor
      let builder = HKWorkoutBuilder(healthStore: store, configuration: configuration, device: .local())
      try await builder.beginCollection(at: start)
      try await builder.addSamples([
        HKQuantitySample(
          type: distance, quantity: HKQuantity(unit: .meterUnit(with: .kilo), doubleValue: 3.2),
          start: start, end: end)
      ])
      try await builder.endCollection(at: end)
      guard let workout = try await builder.finishWorkout() else { return }
      // From Nørreport along Peblinge and Sortedams lakes and back, one fix
      // every two seconds.
      let corners: [(Double, Double)] = [
        (55.6836, 12.5716), (55.6862, 12.5629), (55.6893, 12.5585), (55.6935, 12.5647), (55.6960, 12.5730),
      ]
      let out = (0..<600).map { i -> CLLocationCoordinate2D in
        let t = Double(i) / 599 * Double(corners.count - 1)
        let k = min(Int(t), corners.count - 2)
        let f = t - Double(k)
        return CLLocationCoordinate2D(
          latitude: corners[k].0 + (corners[k + 1].0 - corners[k].0) * f,
          longitude: corners[k].1 + (corners[k + 1].1 - corners[k].1) * f)
      }
      let track = out + out.reversed()
      let locations = track.enumerated().map { i, c in
        CLLocation(
          coordinate: c, altitude: 10, horizontalAccuracy: 5, verticalAccuracy: 5,
          timestamp: start.addingTimeInterval(Double(i) * 2))
      }
      let route = HKWorkoutRouteBuilder(healthStore: store, device: .local())
      try await route.insertRouteData(locations)
      _ = try await route.finishRoute(with: workout, metadata: nil)
    }
  }
#endif
