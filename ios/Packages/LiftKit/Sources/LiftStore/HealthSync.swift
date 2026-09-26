import Foundation
import HealthKit
import LiftAPI
import os

/// Reads sleep, daily heart-rate and movement summaries, workouts and their
/// GPS routes from Apple Health and sends them to the journal. The server
/// decides what is saved: it never overwrites a manual entry, never logs a
/// workout twice, and leaves an entry alone once the athlete edits or
/// deletes it. The app only reads Apple Health; it never writes to it.
public actor HealthSync {
  public static let shared = HealthSync()

  public static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

  /// Everything the app asks to read, and why, shown in Apple's permission sheet.
  public static let readTypes: Set<HKObjectType> = [
    HKCategoryType(.sleepAnalysis),
    HKQuantityType(.restingHeartRate),
    HKQuantityType(.heartRateVariabilitySDNN),
    HKQuantityType(.heartRate),
    HKQuantityType(.stepCount),
    HKQuantityType(.activeEnergyBurned),
    HKQuantityType(.bodyFatPercentage),
    HKQuantityType(.distanceWalkingRunning),
    HKQuantityType(.distanceCycling),
    HKQuantityType(.distanceSwimming),
    HKQuantityType(.distanceRowing),
    HKObjectType.workoutType(),
    HKSeriesType.workoutRoute(),
  ]

  public struct Summary: Sendable, Equatable {
    public var at: Date
    public var nightsImported: Int
    public var workoutsImported: Int
    public var daysUpdated: Int
    public var routesImported = 0
    public var bodyFatUpdated = 0
  }

  public nonisolated let store = HKHealthStore()
  /// Every finished sync, whether started by the app, Apple Health's
  /// background delivery or an observer, so an open screen can refresh.
  public nonisolated let updates: AsyncStream<Summary>
  private nonisolated let continuation: AsyncStream<Summary>.Continuation
  private let defaults = UserDefaults.standard
  private let log = Logger(subsystem: "com.bjarketornager.liftjournal", category: "health")
  private var running = false
  private var rerun = false
  private var observing = false

  init() {
    (updates, continuation) = AsyncStream.makeStream(bufferingPolicy: .bufferingNewest(1))
  }

  private enum Key {
    static let connected = "health.connected"
    static let lastSync = "health.lastSync"
    static let anchor = "health.workoutAnchor"
    static let routesDone = "health.routesDone"
    static let routesBackfilled = "health.routesBackfilled"
  }

  /// Whether the athlete has connected Apple Health in this app.
  public nonisolated var connected: Bool { UserDefaults.standard.bool(forKey: Key.connected) }
  public nonisolated var lastSync: Date? {
    UserDefaults.standard.object(forKey: Key.lastSync) as? Date
  }

  public func markConnected(_ value: Bool) {
    defaults.set(value, forKey: Key.connected)
    if !value {
      defaults.removeObject(forKey: Key.lastSync)
      defaults.removeObject(forKey: Key.anchor)
      defaults.removeObject(forKey: Key.routesDone)
      defaults.removeObject(forKey: Key.routesBackfilled)
    }
  }

  /// Whether Apple would show its permission sheet because the app now asks
  /// for something new, such as workout routes after an update.
  public func needsAccess() async -> Bool {
    guard Self.isAvailable else { return false }
    return (try? await store.statusForAuthorizationRequest(toShare: [], read: Self.readTypes)) == .shouldRequest
  }

  /// Read everything new since the last sync and send it. Safe to call often:
  /// a call during a sync makes it go round once more, and a repeated batch
  /// changes nothing.
  @discardableResult
  public func sync(client: Client, now: Date = .now) async throws -> Summary? {
    guard Self.isAvailable, connected else { return nil }
    // Apple Health often reports a workout and then its route moments
    // apart: a call that arrives mid-sync runs once more afterwards.
    guard !running else {
      rerun = true
      return nil
    }
    running = true
    defer {
      running = false
      rerun = false
    }
    var summary = try await run(client: client, now: now)
    while rerun {
      rerun = false
      let next = try await run(client: client, now: .now)
      summary.at = next.at
      summary.nightsImported += next.nightsImported
      summary.workoutsImported += next.workoutsImported
      summary.daysUpdated += next.daysUpdated
      summary.routesImported += next.routesImported
      summary.bodyFatUpdated += next.bodyFatUpdated
    }
    continuation.yield(summary)
    return summary
  }

  private func run(client: Client, now: Date) async throws -> Summary {
    let calendar = Calendar.current
    let today = calendar.startOfDay(for: now)
    // First sync: two weeks (the server's limit for sleep). Later: from the
    // day before the last sync, so late-arriving watch data is picked up.
    let daysBack: Int
    if let last = lastSync {
      let gap = calendar.dateComponents([.day], from: calendar.startOfDay(for: last), to: today).day ?? 0
      daysBack = min(13, max(2, gap + 1))
    } else {
      daysBack = 13
    }
    let dates = (0...daysBack).reversed().compactMap {
      calendar.date(byAdding: .day, value: -$0, to: today)
    }

    let nights = try await sleepNights(dates: dates, now: now, calendar: calendar)
    let days = try await dailySummaries(dates: dates, now: now, calendar: calendar)
    var summary = Summary(at: now, nightsImported: 0, workoutsImported: 0, daysUpdated: 0)

    // Workouts page through an anchored query; the anchor is saved only
    // after the server has accepted the page.
    var anchor = loadAnchor()
    var first = true
    for _ in 0..<10 {
      let page = try await workoutPage(anchor: anchor, now: now, calendar: calendar)
      guard first || !page.workouts.isEmpty || !page.deleted.isEmpty else { break }
      let request = Components.Schemas.HealthSyncRequest(
        timezone: TimeZone.current.identifier,
        sleep: first ? nights : [],
        days: first ? days : [],
        workouts: page.workouts,
        deletedWorkoutIds: page.deleted
      )
      let result = try await client.syncHealth(body: .json(request)).value()
      if first {
        summary.nightsImported = result.sleep.filter { ["imported", "updated"].contains($0.result) }.count
        summary.daysUpdated = result.daysUpdated
        summary.bodyFatUpdated = result.bodyFatUpdated ?? 0
      }
      summary.workoutsImported += result.workouts.filter {
        ["imported", "updated", "matched"].contains($0.result)
      }.count
      saveAnchor(page.anchor)
      anchor = page.anchor
      first = false
      if !page.more { break }
    }
    // A route can reach Apple Health after its workout, so routes go in a
    // pass of their own. A failure here leaves the rest of the sync intact.
    do {
      summary.routesImported = try await sendRoutes(client: client, now: now, calendar: calendar)
    } catch let error as HKError where error.code == .errorAuthorizationNotDetermined {
      log.info("Routes are not allowed yet")
    } catch {
      log.error("Route sync failed: \(error.localizedDescription, privacy: .public)")
    }
    defaults.set(now, forKey: Key.lastSync)
    log.info("Health sync finished")
    return summary
  }

  // MARK: Sleep

  /// One night per waking date: samples from noon the day before until noon,
  /// clipped to that window as the server requires.
  private func sleepNights(dates: [Date], now: Date, calendar: Calendar) async throws
    -> [Components.Schemas.SleepNight]
  {
    guard let first = dates.first, let last = dates.last,
      let start = Self.noon(before: first, calendar: calendar),
      let end = Self.noon(of: last, calendar: calendar)
    else { return [] }
    let descriptor = HKSampleQueryDescriptor(
      predicates: [
        .categorySample(
          type: HKCategoryType(.sleepAnalysis),
          predicate: HKQuery.predicateForSamples(withStart: start, end: min(end, now)))
      ],
      sortDescriptors: [SortDescriptor(\.startDate)]
    )
    let samples = try await descriptor.result(for: store)
    let format = Self.timestampFormatter()
    return dates.compactMap { wake -> Components.Schemas.SleepNight? in
      guard let from = Self.noon(before: wake, calendar: calendar),
        let noon = Self.noon(of: wake, calendar: calendar)
      else { return nil }
      let until = min(noon, now)
      var items: [Components.Schemas.SleepNight.SamplesPayloadPayload] = []
      var asleep = false
      for sample in samples {
        let a = max(sample.startDate, from)
        let b = min(sample.endDate, until)
        guard a < b, let value = Self.sleepValue(sample.value) else { continue }
        if value != .awake && value != .inBed { asleep = true }
        items.append(.init(start: format.string(from: a), end: format.string(from: b), value: value))
      }
      guard asleep else { return nil }
      if items.count > 1000 { items = items.filter { $0.value != .inBed && $0.value != .awake } }
      return .init(date: JournalDay.string(wake, calendar: calendar), samples: Array(items.prefix(1000)))
    }
  }

  // Local noon, so a night is the same window on daylight-saving days.
  static func noon(of day: Date, calendar: Calendar) -> Date? {
    calendar.date(bySettingHour: 12, minute: 0, second: 0, of: day)
  }

  static func noon(before day: Date, calendar: Calendar) -> Date? {
    calendar.date(byAdding: .day, value: -1, to: day).flatMap { noon(of: $0, calendar: calendar) }
  }

  static func sleepValue(_ raw: Int) -> Components.Schemas.SleepNight.SamplesPayloadPayload.ValuePayload? {
    switch HKCategoryValueSleepAnalysis(rawValue: raw) {
    case .inBed: .inBed
    case .asleepUnspecified: .asleep
    case .awake: .awake
    case .asleepCore: .core
    case .asleepDeep: .deep
    case .asleepREM: .rem
    default: nil
    }
  }

  // MARK: Daily summaries

  private func dailySummaries(dates: [Date], now: Date, calendar: Calendar) async throws
    -> [Components.Schemas.HealthDay]
  {
    guard let start = dates.first else { return [] }
    let bpm = HKUnit.count().unitDivided(by: .minute())
    async let resting = daily(.restingHeartRate, .discreteAverage, bpm, from: start, to: now)
    async let hrv = daily(.heartRateVariabilitySDNN, .discreteAverage, .secondUnit(with: .milli), from: start, to: now)
    async let average = daily(.heartRate, .discreteAverage, bpm, from: start, to: now)
    async let steps = daily(.stepCount, .cumulativeSum, .count(), from: start, to: now)
    async let energy = daily(.activeEnergyBurned, .cumulativeSum, .kilocalorie(), from: start, to: now)
    // A smart scale's last reading of the day, as a fraction of 1.
    async let fat = daily(.bodyFatPercentage, .mostRecent, .percent(), from: start, to: now)
    let (r, h, a, s, e, f) = try await (resting, hrv, average, steps, energy, fat)
    return dates.compactMap { date in
      let key = calendar.startOfDay(for: date)
      // Values outside the server's ranges are left out rather than
      // rejecting the whole batch.
      let day = Components.Schemas.HealthDay(
        date: JournalDay.string(date, calendar: calendar),
        restingHeartRate: r[key].map { Int($0.rounded()) }.flatMap { (20...250).contains($0) ? $0 : nil },
        heartRateVariabilityMs: h[key].flatMap { (1...500).contains($0) ? ($0 * 10).rounded() / 10 : nil },
        averageHeartRate: a[key].map { Int($0.rounded()) }.flatMap { (20...250).contains($0) ? $0 : nil },
        steps: s[key].map { Int($0.rounded()) }.flatMap { (0...200_000).contains($0) ? $0 : nil },
        activeEnergyKcal: e[key].map { Int($0.rounded()) }.flatMap { (0...20_000).contains($0) ? $0 : nil },
        bodyFatPercent: f[key].map { ($0 * 1000).rounded() / 10 }.flatMap { (3...70).contains($0) ? $0 : nil }
      )
      let empty = [day.restingHeartRate, day.averageHeartRate, day.steps, day.activeEnergyKcal]
        .allSatisfy { $0 == nil } && day.heartRateVariabilityMs == nil && day.bodyFatPercent == nil
      return empty ? nil : day
    }
  }

  /// One value per local day for a quantity type.
  private func daily(
    _ identifier: HKQuantityTypeIdentifier, _ option: HKStatisticsOptions, _ unit: HKUnit,
    from start: Date, to end: Date
  ) async throws -> [Date: Double] {
    let type = HKQuantityType(identifier)
    let descriptor = HKStatisticsCollectionQueryDescriptor(
      predicate: .quantitySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: end)),
      options: option,
      anchorDate: start,
      intervalComponents: DateComponents(day: 1)
    )
    let collection: HKStatisticsCollection
    do {
      collection = try await descriptor.result(for: store)
    } catch let error as HKError where error.code == .errorNoData {
      return [:]
    }
    var values: [Date: Double] = [:]
    collection.enumerateStatistics(from: start, to: end) { statistics, _ in
      let quantity =
        option.contains(.cumulativeSum)
        ? statistics.sumQuantity()
        : option.contains(.mostRecent) ? statistics.mostRecentQuantity() : statistics.averageQuantity()
      if let quantity { values[statistics.startDate] = quantity.doubleValue(for: unit) }
    }
    return values
  }

  // MARK: Workouts

  private struct WorkoutPage {
    var workouts: [Components.Schemas.HealthWorkout]
    var deleted: [String]
    var anchor: HKQueryAnchor
    var more: Bool
  }

  private func workoutPage(anchor: HKQueryAnchor?, now: Date, calendar: Calendar) async throws -> WorkoutPage {
    let since = calendar.date(byAdding: .day, value: -60, to: calendar.startOfDay(for: now)) ?? now
    let limit = 100
    let descriptor = HKAnchoredObjectQueryDescriptor(
      predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: nil))],
      anchor: anchor,
      limit: limit
    )
    let result = try await descriptor.result(for: store)
    let format = Self.timestampFormatter()
    let workouts = result.addedSamples.compactMap { Self.workout($0, format: format) }
    return WorkoutPage(
      workouts: workouts,
      deleted: result.deletedObjects.map { $0.uuid.uuidString.lowercased() },
      anchor: result.newAnchor,
      more: result.addedSamples.count + result.deletedObjects.count >= limit
    )
  }

  static func workout(_ w: HKWorkout, format: ISO8601DateFormatter) -> Components.Schemas.HealthWorkout? {
    let duration = Int(w.duration.rounded())
    guard (1...604_800).contains(duration) else { return nil }
    let (kind, name) = describe(w)
    let bpm = HKUnit.count().unitDivided(by: .minute())
    let heart = w.statistics(for: HKQuantityType(.heartRate))
    let average = heart?.averageQuantity().map { Int($0.doubleValue(for: bpm).rounded()) }
      .flatMap { (30...300).contains($0) ? $0 : nil }
    var maximum = heart?.maximumQuantity().map { Int($0.doubleValue(for: bpm).rounded()) }
      .flatMap { (30...300).contains($0) ? $0 : nil }
    if let average, let max = maximum, max < average { maximum = nil }
    let distance = distanceType(for: w.workoutActivityType)
      .flatMap { w.statistics(for: HKQuantityType($0))?.sumQuantity() }
      .map { $0.doubleValue(for: .meterUnit(with: .kilo)) }
      .flatMap { (0...10_000).contains($0) && $0 > 0 ? $0 : nil }
    let calories = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()
      .map { $0.doubleValue(for: .kilocalorie()) }
      .flatMap { (0...50_000).contains($0) ? $0 : nil }
    let elevation = (w.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity)
      .map { $0.doubleValue(for: .meter()) }
      .flatMap { (0...30_000).contains($0) ? $0 : nil }
    return .init(
      id: w.uuid.uuidString.lowercased(),
      kind: kind,
      name: name,
      start: format.string(from: w.startDate),
      end: format.string(from: w.endDate),
      durationSeconds: duration,
      distanceKm: distance,
      caloriesKcal: calories,
      averageHeartRate: average,
      maxHeartRate: maximum,
      elevationGainM: elevation
    )
  }

  static func distanceType(for activity: HKWorkoutActivityType) -> HKQuantityTypeIdentifier? {
    switch activity {
    case .running, .walking, .hiking, .wheelchairRunPace, .wheelchairWalkPace: .distanceWalkingRunning
    case .cycling, .handCycling: .distanceCycling
    case .swimming: .distanceSwimming
    case .rowing: .distanceRowing
    default: nil
    }
  }

  /// The journal's activity kind and a readable title for a workout.
  static func describe(_ w: HKWorkout) -> (Components.Schemas.HealthWorkout.KindPayload, String) {
    let indoor = (w.metadata?[HKMetadataKeyIndoorWorkout] as? Bool) == true
    let place = indoor ? "Indoor" : "Outdoor"
    switch w.workoutActivityType {
    case .running: return (.running, "\(place) Run")
    case .walking: return (.walking, "\(place) Walk")
    case .hiking: return (.hiking, "Hike")
    case .cycling: return (.cycling, "\(place) Cycle")
    case .handCycling: return (.cycling, "Hand Cycling")
    case .swimming: return (.swimming, indoor ? "Pool Swim" : "Open Water Swim")
    case .rowing: return (.rowing, "Rowing")
    case .elliptical: return (.elliptical, "Elliptical")
    case .traditionalStrengthTraining: return (.strength, "Strength Training")
    case .functionalStrengthTraining: return (.strength, "Functional Strength Training")
    case .coreTraining: return (.strength, "Core Training")
    case .highIntensityIntervalTraining: return (.other, "HIIT")
    case .crossTraining: return (.other, "Cross Training")
    case .mixedCardio: return (.other, "Mixed Cardio")
    case .stairClimbing, .stairs: return (.other, "Stair Climbing")
    case .yoga: return (.other, "Yoga")
    case .pilates: return (.other, "Pilates")
    case .flexibility: return (.other, "Flexibility")
    case .cooldown: return (.other, "Cooldown")
    case .preparationAndRecovery: return (.other, "Recovery")
    case .dance, .cardioDance, .socialDance: return (.other, "Dance")
    case .boxing, .kickboxing: return (.other, "Boxing")
    case .martialArts: return (.other, "Martial Arts")
    case .climbing: return (.other, "Climbing")
    case .jumpRope: return (.other, "Jump Rope")
    case .soccer: return (.other, "Football")
    case .tennis: return (.other, "Tennis")
    case .badminton: return (.other, "Badminton")
    case .paddleSports: return (.other, "Paddling")
    case .crossCountrySkiing: return (.other, "Cross-Country Skiing")
    case .downhillSkiing: return (.other, "Skiing")
    case .snowboarding: return (.other, "Snowboarding")
    case .golf: return (.other, "Golf")
    default: return (.other, "Workout")
    }
  }

  // MARK: Routes

  /// Send the GPS routes of recent workouts that have not been sent yet,
  /// newest first. The first pass looks back 60 days, later ones a week.
  /// Returns how many routes the journal saved.
  private func sendRoutes(client: Client, now: Date, calendar: Calendar) async throws -> Int {
    let backfilled = defaults.bool(forKey: Key.routesBackfilled)
    let since =
      calendar.date(byAdding: .day, value: backfilled ? -7 : -60, to: calendar.startOfDay(for: now)) ?? now
    let workouts = try await HKSampleQueryDescriptor(
      predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: nil))],
      sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)]
    ).result(for: store)
    let ids = workouts.map { $0.uuid.uuidString.lowercased() }
    // Workouts older than the window are never looked at again.
    var done = Set(defaults.stringArray(forKey: Key.routesDone) ?? []).intersection(ids)
    let limit = 20
    let candidates = zip(workouts, ids).filter { workout, id in
      !done.contains(id) && (workout.metadata?[HKMetadataKeyIndoorWorkout] as? Bool) != true
    }
    var routes: [Components.Schemas.HealthRoute] = []
    var named = Set<String>()
    for (workout, id) in candidates.prefix(limit) {
      let track = try await track(of: workout)
      guard track.count >= 2 else {
        // Give a watch two days to hand over a route before giving up.
        if workout.endDate < now.addingTimeInterval(-2 * 86400) { done.insert(id) }
        continue
      }
      let path = RouteShape.simplify(track)
      let places = await placeNames(path)
      if places.complete { named.insert(id) }
      routes.append(
        .init(
          workoutId: id,
          path: path.map { [($0.lat * 1e5).rounded() / 1e5, ($0.lng * 1e5).rounded() / 1e5] },
          startPlace: places.start,
          endPlace: places.end,
          farthestPlace: places.farthest
        ))
    }
    var saved = 0
    for start in stride(from: 0, to: routes.count, by: 10) {
      let batch = Array(routes[start..<min(start + 10, routes.count)])
      let result = try await client.syncHealth(
        body: .json(.init(timezone: TimeZone.current.identifier, routes: batch))
      ).value()
      for r in result.routes ?? [] {
        if r.result == "saved" { saved += 1 }
        // Pending: the workout is not in the journal yet; send it again later.
        // Without every place name, it is sent again to fill them in.
        if r.result != "pending" && named.contains(r.workoutId) { done.insert(r.workoutId) }
        if r.result == "skipped" { done.insert(r.workoutId) }
      }
    }
    defaults.set(Array(done), forKey: Key.routesDone)
    if candidates.count <= limit { defaults.set(true, forKey: Key.routesBackfilled) }
    return saved
  }

  /// Every GPS fix recorded with a workout, leaving out inaccurate ones.
  private func track(of workout: HKWorkout) async throws -> [RoutePoint] {
    let routes = try await HKSampleQueryDescriptor(
      predicates: [.workoutRoute(HKQuery.predicateForObjects(from: workout))],
      sortDescriptors: [SortDescriptor(\.startDate)]
    ).result(for: store)
    var points: [RoutePoint] = []
    for route in routes {
      for try await location in HKWorkoutRouteQueryDescriptor(route).results(for: store) {
        guard (0...50).contains(location.horizontalAccuracy) else { continue }
        points.append(RoutePoint(lat: location.coordinate.latitude, lng: location.coordinate.longitude))
      }
    }
    return points
  }

  /// Names for the start and, for an out-and-back, the turning point, or
  /// for a one-way route its end. `complete` is false if a lookup failed.
  private func placeNames(_ path: [RoutePoint]) async
    -> (start: String?, end: String?, farthest: String?, complete: Bool)
  {
    guard let first = path.first, let last = path.last else { return (nil, nil, nil, true) }
    let loop = RouteShape.isLoop(path)
    let second = loop ? path[RouteShape.farthestIndex(path)] : last
    var names: [String?] = []
    var complete = true
    for point in [first, second] {
      switch await PlaceNames.shared.name(lat: point.lat, lng: point.lng) {
      case .named(let name): names.append(name)
      case .unnamed: names.append(nil)
      case .failed:
        names.append(nil)
        complete = false
      }
    }
    return loop
      ? (names[0], names[0], names[1], complete)
      : (names[0], names[1], nil, complete)
  }

  // MARK: Background delivery

  /// Ask Apple Health to wake the app when new sleep, workouts or resting
  /// heart rate arrive. Must be called on every launch, including launches
  /// in the background, before the app finishes launching.
  public func observe(onChange: @escaping @Sendable () async -> Void) async {
    guard Self.isAvailable, connected, !observing else { return }
    observing = true
    let types: [(HKSampleType, HKUpdateFrequency)] = [
      (HKCategoryType(.sleepAnalysis), .hourly),
      (HKObjectType.workoutType(), .immediate),
      (HKSeriesType.workoutRoute(), .immediate),
      (HKQuantityType(.restingHeartRate), .hourly),
      (HKQuantityType(.bodyFatPercentage), .hourly),
    ]
    for (type, frequency) in types {
      let query = HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
        guard error == nil else {
          completion()
          return
        }
        // HealthKit's completion handler may be called from any thread.
        let done = ObserverCompletion(call: completion)
        Task {
          await onChange()
          done.call()
        }
      }
      store.execute(query)
      do {
        try await store.enableBackgroundDelivery(for: type, frequency: frequency)
      } catch {
        log.error("Background delivery unavailable: \(error.localizedDescription, privacy: .public)")
      }
    }
  }

  // MARK: Helpers

  static func timestampFormatter() -> ISO8601DateFormatter {
    let format = ISO8601DateFormatter()
    format.formatOptions = [.withInternetDateTime]
    format.timeZone = .current
    return format
  }

  private func loadAnchor() -> HKQueryAnchor? {
    guard let data = defaults.data(forKey: Key.anchor) else { return nil }
    return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
  }

  private func saveAnchor(_ anchor: HKQueryAnchor) {
    if let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) {
      defaults.set(data, forKey: Key.anchor)
    }
  }
}

private struct ObserverCompletion: @unchecked Sendable {
  let call: HKObserverQueryCompletionHandler
}
