import Foundation
import LiftAPI
import LiftStore
import Observation
import os

typealias Today = Components.Schemas.Today
typealias NativeAction = Components.Schemas.NativeAction

/// The app's shared state: who is signed in, today's view of the journal,
/// changes waiting to be sent, and Apple Health sync. Feature screens own
/// their own models and use this one for the client and session.
@Observable
final class AppModel {
  enum Phase: Equatable { case launching, signedOut, signedIn }
  enum Tab: Hashable { case today, train, coach, journal, profile }

  var phase: Phase = .launching
  var tab: Tab = .today
  var session: Credentials.Session?
  var updateRequired = false
  var signInError: String?
  var signingIn = false

  var today: Today?
  var todayUpdated: Date?
  var loadingToday = false
  var todayError: String?

  /// A save that did not go through, shown as an alert.
  var notice: Notice?
  /// Counts successful saves, for the success haptic.
  var saves = 0
  /// Whether the server offers the spoken check-in.
  var voiceEnabled = false
  /// The spoken check-in on screen, if any.
  var voiceCall: VoiceCall?
  /// Voice streams audio to Google, so the first call asks for AI permission.
  var consentForVoice = false
  /// Counts finished calls, so Coach reloads what the call saved.
  var voiceEnded = 0
  var queued = 0
  var refused: [Outbox.Item] = []

  var health = HealthState()

  let client = LiftServer.client(credentials: Credentials.shared)
  private var outbox: Outbox?
  private let todayCache = Cached<Today>("today.json")
  private let log = Logger(subsystem: "com.bjarketornager.liftjournal", category: "app")

  struct Notice: Identifiable, Equatable {
    let id = UUID()
    var text: String
    var undo: NativeAction?
    var problem = false
    static func == (a: Notice, b: Notice) -> Bool { a.id == b.id }
  }

  struct HealthState {
    var available = HealthSync.isAvailable
    var connected = HealthSync.shared.connected
    var syncing = false
    var lastSync = HealthSync.shared.lastSync
    var lastResult: String?
    var error: String?
  }

  // MARK: Launch and session

  func start() async {
    if let config = try? await client.getConfig().value() {
      voiceEnabled = config.voice
      if let build = Int(LiftServer.clientHeader.split(separator: "/").last ?? ""),
        build < config.minimumBuild
      {
        updateRequired = true
      }
    }
    #if DEBUG
      await useTestSession()
    #endif
    #if DEBUG && targetEnvironment(simulator)
      if HealthSeeder.requested { try? await HealthSeeder.seed() }
    #endif
    guard let saved = await Credentials.shared.current() else {
      phase = .signedOut
      return
    }
    open(saved)
    await refresh()
  }

  #if DEBUG
    /// Debug builds pointed at a local server (LIFT_SERVER) may be given a
    /// session for a disposable local account, for simulator testing.
    private func useTestSession() async {
      let env = ProcessInfo.processInfo.environment
      guard LiftServer.origin.host() == "127.0.0.1" || LiftServer.origin.host() == "localhost",
        let token = env["LIFT_TEST_TOKEN"], let account = env["LIFT_TEST_ACCOUNT"]
      else { return }
      try? await Credentials.shared.save(
        .init(token: token, accountID: account, name: "Simulator test", email: "test@example.test"))
    }
  #endif

  private func open(_ saved: Credentials.Session) {
    session = saved
    outbox = Outbox(account: saved.accountID)
    today = todayCache.load(account: saved.accountID)
    phase = .signedIn
    listenForHealth()
  }

  private var healthUpdates: Task<Void, Never>?

  /// Reload Today after any sync, including ones Apple Health started.
  private func listenForHealth() {
    guard healthUpdates == nil else { return }
    healthUpdates = Task { [weak self] in
      for await summary in HealthSync.shared.updates {
        guard let self else { return }
        self.health.lastSync = summary.at
        self.health.lastResult = Self.describe(summary)
        self.health.error = nil
        if summary.nightsImported + summary.workoutsImported + summary.daysUpdated + summary.routesImported > 0 {
          await self.loadToday()
        }
      }
    }
  }

  func becameActive() async {
    guard phase == .signedIn else { return }
    await refresh()
  }

  /// Send queued changes, reload Today and pick up new Apple Health data.
  func refresh() async {
    await flush()
    await loadToday()
    await syncHealth(force: false)
  }

  func signIn() async {
    guard !signingIn else { return }
    signingIn = true
    signInError = nil
    defer { signingIn = false }
    do {
      let grant = try await GoogleSignIn().authenticate()
      let token = try await client.exchangeToken(
        body: .json(.init(code: grant.code, verifier: grant.verifier))
      ).value()
      let saved = Credentials.Session(
        token: token.token, accountID: token.user.id, name: token.user.name,
        email: token.user.email)
      try await Credentials.shared.save(saved)
      open(saved)
      await refresh()
    } catch GoogleSignIn.Failure.cancelled {
      return
    } catch {
      signInError = error.localizedDescription
    }
  }

  func signOut() async {
    if let saved = session {
      // Revoke this device's session only; the website stays signed in.
      var request = URLRequest(url: LiftServer.origin.appending(path: "api/auth/sign-out"))
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = Data("{}".utf8)
      LiftHeaders.apply(to: &request, token: saved.token, account: saved.accountID)
      _ = try? await LiftServer.session().data(for: request)
    }
    await expire(message: nil)
  }

  /// Permanently deletes the account and its journal on the server, then
  /// signs out. Returns a message when it could not be deleted.
  func deleteAccount() async -> String? {
    guard let saved = session else { return nil }
    var request = URLRequest(url: LiftServer.origin.appending(path: "api/account"))
    request.httpMethod = "DELETE"
    LiftHeaders.apply(to: &request, token: saved.token, account: saved.accountID)
    do {
      let (data, response) = try await LiftServer.session().data(for: request)
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if status == 200 {
        await expire(message: nil)
        return nil
      }
      if status == 401 {
        await expire(message: "Sign in again to open your journal.")
        return nil
      }
      struct Failure: Decodable { let error: String }
      return (try? JSONDecoder().decode(Failure.self, from: data))?.error
        ?? "Your account could not be deleted. Try again shortly."
    } catch {
      return await handle(error)
    }
  }

  private func expire(message: String?) async {
    AIConsent.reset()
    await Credentials.shared.clear()
    await HealthSync.shared.markConnected(false)
    Storage.removeAll()
    healthUpdates?.cancel()
    healthUpdates = nil
    session = nil
    outbox = nil
    today = nil
    queued = 0
    refused = []
    health = HealthState()
    signInError = message
    phase = .signedOut
  }

  /// Every failure passes through here: an expired session signs out and an
  /// outdated build asks for an update; anything else is shown.
  func handle(_ error: any Error) async -> String? {
    if let failure = error as? APIFailure {
      if failure.signedOut {
        await expire(message: "Sign in again to open your journal.")
        return nil
      }
      if failure.updateRequired {
        updateRequired = true
        return nil
      }
      return failure.message
    }
    if error is CancellationError { return nil }
    if let url = error as? URLError {
      return url.code == .notConnectedToInternet
        ? "You're offline. Changes are kept and sent when you reconnect."
        : "The journal could not be reached. Try again shortly."
    }
    return error.localizedDescription
  }

  // MARK: Today

  func loadToday() async {
    guard let account = session?.accountID else { return }
    loadingToday = true
    defer { loadingToday = false }
    do {
      let value = try await client.getToday(query: .init(date: JournalDay.string(.now))).value()
      today = value
      todayUpdated = .now
      todayError = nil
      todayCache.save(value, account: account)
    } catch {
      todayError = await handle(error)
    }
  }

  // MARK: Saving

  /// Queue a change, send it, and reload Today. Offline, the change waits in
  /// the queue and is sent on the next refresh.
  func save(_ action: NativeAction, undo: NativeAction? = nil, confirmation: String? = nil) async {
    guard let outbox else { return }
    let outcome = await outbox.submit(action, client: client)
    switch outcome {
    case .saved:
      saves += 1
      await loadToday()
    case .queued:
      // Shown in Today's queue section until it is sent.
      saves += 1
    case .refused(let message):
      notice = Notice(text: message, problem: true)
    }
    await countQueue()
  }

  func flush() async {
    guard let outbox else { return }
    await outbox.flush(client: client)
    await countQueue()
  }

  func discardRefused(_ item: Outbox.Item) async {
    await outbox?.discard(item.id)
    await countQueue()
  }

  private func countQueue() async {
    queued = await outbox?.pending.count ?? 0
    refused = await outbox?.refused ?? []
  }

  func logDrink(ml: Int, kind: Components.Schemas.LogDrinkAction.DrinkPayload.KindPayload = .water) async {
    let day = JournalDay.string(.now)
    await save(
      .logDrink(.init(kind: .logDrink, drink: .init(date: day, ml: ml, kind: kind))),
      confirmation: "Added \(ml) ml")
  }

  func removeDrink(id: String) async {
    await save(.deleteDrink(.init(kind: .deleteDrink, drinkId: id)), confirmation: "Drink removed")
  }

  // MARK: Voice

  func startVoice() {
    guard voiceCall == nil || voiceCall?.inCall == false else { return }
    guard UserDefaults.standard.bool(forKey: AIConsent.key) else {
      consentForVoice = true
      return
    }
    voiceCall = VoiceCall(app: self)
  }

  func closeVoice() {
    voiceCall?.stop()
    voiceCall = nil
    voiceEnded += 1
  }

  // MARK: Apple Health

  func healthConnected() async {
    await HealthSync.shared.markConnected(true)
    health.connected = true
    await Self.observeHealth()
    await syncHealth(force: true)
  }

  func disconnectHealth() async {
    await HealthSync.shared.markConnected(false)
    health = HealthState()
  }

  func syncHealth(force: Bool) async {
    guard health.connected, !health.syncing else { return }
    // Opening the app syncs at most every few minutes; background delivery
    // and "Sync now" cover the rest.
    if !force, let last = health.lastSync, Date.now.timeIntervalSince(last) < 300 { return }
    health.syncing = true
    defer { health.syncing = false }
    do {
      // The result arrives through listenForHealth, like background syncs.
      try await HealthSync.shared.sync(client: client)
    } catch {
      health.error = await handle(error) ?? health.error
      log.error("Health sync failed: \(error.localizedDescription, privacy: .public)")
    }
  }

  private static func describe(_ s: HealthSync.Summary) -> String {
    var parts: [String] = []
    if s.nightsImported > 0 { parts.append("\(s.nightsImported) \(s.nightsImported == 1 ? "night" : "nights")") }
    if s.workoutsImported > 0 { parts.append("\(s.workoutsImported) \(s.workoutsImported == 1 ? "workout" : "workouts")") }
    if s.daysUpdated > 0 { parts.append("\(s.daysUpdated) \(s.daysUpdated == 1 ? "day" : "days") of heart and movement") }
    if s.routesImported > 0 { parts.append("\(s.routesImported) \(s.routesImported == 1 ? "route" : "routes")") }
    return parts.isEmpty ? "Up to date" : "Added " + parts.joined(separator: ", ")
  }

  /// Registered at every launch, including background launches where no
  /// scene exists, so it builds its own client.
  nonisolated static func observeHealth() async {
    await HealthSync.shared.observe {
      guard await Credentials.shared.current() != nil else { return }
      let client = LiftServer.client(credentials: Credentials.shared)
      _ = try? await HealthSync.shared.sync(client: client)
    }
  }
}
