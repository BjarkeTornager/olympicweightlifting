import Foundation
import LiftAPI
import LiftStore
import Network
import Observation
import UIKit

typealias CoachTurn = Components.Schemas.CoachTurn
typealias VoiceCallRecord = Components.Schemas.VoiceCall

/// A typed message or a voice call, in the order they happened.
enum ThreadItem: Identifiable {
  case turn(CoachTurn)
  case call(VoiceCallRecord)

  var id: String {
    switch self {
    case .turn(let turn): "turn-\(turn.id)"
    case .call(let call): "call-\(call.id)"
    }
  }

  var date: Date {
    switch self {
    case .turn(let turn): CoachView.date(turn.createdAt)
    case .call(let call): CoachView.date(call.startedAt)
    }
  }
}

@Observable
final class CoachModel {
  struct Attachment: Identifiable {
    /// The photo's id on the server, chosen when it's attached: sending it
    /// again (Retry, Edit, or after Stop) finds the same photo rather than
    /// saving a second copy.
    let id: UUID
    /// The journal day it was attached on. The server only takes the same id
    /// again for the same photo, label and day, so it's sent the same way.
    let day: String
    let jpeg: Data
    /// Drawn from the JPEG, so a photo restored from disk looks the same.
    let preview: UIImage

    init(id: UUID = UUID(), day: String = JournalDay.string(.now), jpeg: Data) {
      self.id = id
      self.day = day
      self.jpeg = jpeg
      preview = UIImage(data: jpeg) ?? UIImage()
    }
  }

  /// A message sent to Coach. Coach answers one at a time, in the order
  /// they were sent; the rest wait here, their photos uploading at once, so
  /// the athlete can keep taking photos and writing while Coach works.
  struct Outgoing: Identifiable {
    /// The run's id, which is also the saved turn's id.
    let id: UUID
    /// As typed; empty for photos on their own.
    let text: String
    let photos: [Attachment]
    /// When it was sent, so a message that waited keeps its day and time.
    let sentAt: Date
    /// The account it was sent from. It's never sent from another.
    let account: String
    /// Why it wasn't answered. The queue waits here until it's retried,
    /// edited or removed, so later messages never jump ahead of it.
    var failure: String?
    /// It failed for want of a connection: it's sent again by itself when
    /// the connection is back or the app is opened again.
    var offline = false
    /// It waited over a day, and the server no longer takes it as it was:
    /// Edit sends it as a new message, or Remove.
    var expired = false
    /// The first message, back in the text field to be changed (Edit, or
    /// Stop before it was sent). It keeps its place, saved with the rest,
    /// until it's sent again or the field is cleared; the rest wait.
    var editing = false

    var message: String { text.isEmpty ? CoachModel.photoOnly : text }

    /// The start of the message, so VoiceOver can tell one from another.
    var summary: String {
      if text.isEmpty { return photos.count == 1 ? "A photo" : "\(photos.count) photos" }
      return text.count > 60 ? String(text.prefix(60)) + "…" : text
    }
  }

  /// At most this many messages wait at once, as on the website.
  static let maxQueued = 20
  /// As QUEUE_FULL_MESSAGE in lib/coach-queue.ts.
  static let queueFullText = "Your queue is full. Let Coach finish a message or remove a queued message."
  static let switchedOffText = "Coach is switched off. Turn on AI sharing in Profile to send."
  static let offlineText = "You're offline. It sends when you're back online."
  static let unreachableText = "Coach couldn't be reached. Tap Retry to send it again."
  static let droppedText = "The connection dropped before it was sent. Tap Retry to send it again."
  static let expiredText = "This message waited over a day. Edit to send it again, or Remove it."
  static let stoppedText = "Stopped before it was sent"

  var turns: [CoachTurn] = []
  /// Voice calls from the last 30 days, with their transcripts.
  var calls: [VoiceCallRecord] = []
  var loaded = false
  var draft = ""
  var attachments: [Attachment] = []
  /// Messages not yet answered, oldest first: the one being answered, if
  /// any, then those waiting. Kept on disk, so it survives the app closing.
  var queue: [Outgoing] = [] {
    didSet { queueChanged() }
  }
  /// The first message went back to the text field to be changed (Edit, or
  /// Stop before it was sent). The rest wait, so it keeps its place when
  /// it's sent again; clearing the field lets them go.
  var heldForEdit: Bool { queue.first?.editing == true }
  var sending = false
  /// The message being answered, shown until the saved turn arrives.
  var asking: String?
  var step: String?
  var reply = ""
  /// Visuals Coach has made for the message being answered, shown as they
  /// arrive, until the saved turn replaces them.
  var liveVisuals: [Components.Schemas.CoachVisual] = []
  var error: String?
  var busyReceipt: String?
  /// Photos attached to the message being answered, shown until it's saved.
  var sendingPreviews: [UIImage] = []
  /// The text sent with photos and no words. The server recognises it
  /// (PHOTO_ONLY_MESSAGE in lib/images.ts) and asks Coach to log the photo,
  /// so keep the two the same.
  static let photoOnly = "Here's a photo."
  /// Counts sends, for the send haptic and to scroll to the newest message.
  var sentCount = 0

  /// Works through the queue, one message at a time.
  private var runner: Task<Void, Never>?
  /// The message being answered; Stop cancels this one only.
  private var current: Task<Void, Never>?
  /// The message the runner has taken, recorded before its answer starts,
  /// so Remove and Edit leave it alone from then on.
  private var picked: UUID?
  /// Each queued message's photo upload, started as soon as it's sent and
  /// kept so the message's turn reuses photos already uploaded.
  private var uploads: [UUID: Task<[UUID], any Error>] = [:]
  private var refreshing: Task<Void, Never>?
  /// The message being answered, by its run id, until its saved turn arrives.
  private var pending: (id: UUID, stream: CoachStream)?
  /// Whether the message being answered was handed to Coach: until then,
  /// Stop gives it back rather than throwing it away.
  @ObservationIgnored private var reachedCoach = false
  /// What the reply's stream has read, so a dropped connection reads on
  /// from there, and when to try.
  @ObservationIgnored private var progress: CoachStream.Progress?
  @ObservationIgnored private var reconnect: CoachReconnect?
  /// The wait before reading on; coming back to the foreground ends it.
  @ObservationIgnored private var pausing: Task<Void, Never>?
  @ObservationIgnored private weak var app: AppModel?
  /// The queue on disk, for the account signed in when the session began.
  @ObservationIgnored private var store: CoachQueueStore?
  /// Signed out: this model sends, saves and loads nothing more.
  @ObservationIgnored private var closed = false
  /// Watches for the connection coming back, to send a message that
  /// failed offline.
  private nonisolated let monitor = NWPathMonitor()
  @ObservationIgnored private var online = true

  deinit { monitor.cancel() }

  func load(_ app: AppModel, showingErrors: Bool = true) async {
    guard !closed else { return }
    bind(app)
    do {
      async let history = app.client.getCoach().value().turns
      // The thread still shows typed messages if calls can't be loaded.
      async let spoken = try? app.client.getVoiceCalls().value().calls
      turns = try await history
      calls = await spoken ?? calls
      loaded = true
      refreshWhileAnswering(app)
    } catch where Retry.isCancellation(error) {
      // Stopped on purpose: nothing to show.
    } catch {
      let message = await Self.describe(
        error, offline: "You're offline. Pull down to refresh when you're back online.",
        unreachable: "Coach couldn't be reached. Pull down to try again.", app: app)
      if showingErrors { self.error = message }
    }
  }

  /// A failure in Coach's own words. app.handle speaks of Today's outbox,
  /// which keeps changes to send later; Coach keeps nothing of these.
  private static func describe(
    _ error: any Error, offline: String, unreachable: String, app: AppModel
  ) async -> String? {
    if CoachFailure.isOffline(error) { return offline }
    if Retry.urlError(error) != nil { return unreachable }
    return await app.handle(error)
  }

  /// Once per signed-in account, when the session starts: picks up the
  /// messages that were waiting when the app last closed, shows one that
  /// needs the athlete on the Coach tab, and sends the rest.
  func bind(_ app: AppModel) {
    guard !closed, store == nil, let account = app.session?.accountID else { return }
    self.app = app
    let store = CoachQueueStore(account: account)
    var saved = store.load().map { item in
      // Offline then, perhaps not now: try again.
      var item = item
      if item.offline { (item.failure, item.offline) = (nil, false) }
      return item
    }
    // A message being edited when the app closed goes back to the field.
    if saved.first?.editing == true {
      if hasDraft {
        saved[0].editing = false
        saved[0].failure = saved[0].failure ?? Self.stoppedText
      } else {
        draft = saved[0].text
        attachments = saved[0].photos
      }
    }
    self.store = store
    queue = saved + queue.filter { item in !saved.contains { $0.id == item.id } }
    watchConnection(app)
    process(app)
  }

  /// Saves the queue and shows a message that needs the athlete on the
  /// Coach tab; only while the account it was sent from is signed in.
  private func queueChanged() {
    guard let app, let store, app.session?.accountID == store.account else { return }
    store.save(queue)
    let stuck = queue.first.map { $0.failure != nil || $0.editing } ?? false
    app.coachNeedsAttention = stuck ? queue.count : 0
  }

  /// A reply still being written on the server, as when the app was closed
  /// mid-reply, is picked up by itself, for ten minutes after it was sent
  /// (a message that waited in the queue was sent before it was asked).
  private func refreshWhileAnswering(_ app: AppModel) {
    guard picked == nil, refreshing == nil,
      turns.contains(where: { $0.status == "running" && CoachView.date($0.createdAt) > .now - 600 })
    else { return }
    refreshing = Task { [weak self] in
      try? await Task.sleep(for: .seconds(3))
      guard let self, !Task.isCancelled else { return }
      self.refreshing = nil
      await self.load(app)
    }
  }

  /// Typed turns and voice calls together, oldest first. A message still
  /// in the queue (being answered, or failed) shows there, not also as a
  /// saved turn.
  var items: [ThreadItem] {
    let queued = Set(queue.map { $0.id.uuidString.lowercased() })
    return (turns.filter { !queued.contains($0.id) }.map(ThreadItem.turn) + calls.map(ThreadItem.call))
      .sorted { $0.date < $1.date }
  }

  /// Whether the text field holds something to send.
  var hasDraft: Bool {
    !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
  }

  /// No room for another message. An edited first message goes back in
  /// its own place, so it always fits.
  var queueFull: Bool { queue.count >= Self.maxQueued && !heldForEdit }

  var canSend: Bool { hasDraft && !queueFull }

  /// Messages waiting behind the one being answered, failed ones included.
  /// The one being answered leaves in the same update that shows it
  /// answering; one being edited is in the text field instead.
  var waiting: [Outgoing] {
    queue.filter { $0.id != pending?.id && !$0.editing }
  }

  /// Sends the draft. If Coach is answering another message, it waits its
  /// turn; its photos start uploading straight away either way.
  func send(_ app: AppModel) {
    bind(app)
    guard canSend, let session = app.session else { return }
    let item = Outgoing(
      id: UUID(), text: draft.trimmingCharacters(in: .whitespacesAndNewlines), photos: attachments,
      sentAt: .now, account: session.accountID)
    // An edited first message takes its own place back.
    if heldForEdit { queue[0] = item } else { queue.append(item) }
    // The message leaves the text field at once, as in Messages.
    draft = ""
    attachments = []
    sentCount += 1
    error = nil
    startUpload(item, app: app)
    process(app)
  }

  /// The text field was emptied while the first message was held for an
  /// edit: the queue goes on without it.
  func draftCleared(_ app: AppModel) {
    guard heldForEdit, !hasDraft else { return }
    queue.removeFirst()
    process(app)
  }

  /// Sends a message that failed again, and the ones waiting behind it.
  func retry(_ id: UUID, app: AppModel) {
    guard let index = queue.firstIndex(where: { $0.id == id }), !queue[index].expired else { return }
    queue[index].failure = nil
    queue[index].offline = false
    error = nil
    process(app)
  }

  /// Sends a message that failed for want of a connection again, when the
  /// connection is back or the app is opened again.
  func resume(_ app: AppModel) {
    guard runner == nil, let first = queue.first, first.offline, first.failure != nil, !first.editing
    else { return }
    queue[0].failure = nil
    queue[0].offline = false
    process(app)
  }

  /// Takes a waiting or failed message out of the queue; the next one goes.
  func remove(_ id: UUID, app: AppModel) {
    guard id != picked else { return }
    queue.removeAll { $0.id == id }
    uploads.removeValue(forKey: id)?.cancel()
    error = nil
    process(app)
  }

  /// Puts a waiting or failed message back in the text field to change it,
  /// when the field is empty. The first message keeps its place: the rest
  /// wait until it's sent again or the field is cleared.
  func edit(_ id: UUID, app: AppModel) {
    guard id != picked, !hasDraft, let index = queue.firstIndex(where: { $0.id == id }) else { return }
    draft = queue[index].text
    attachments = queue[index].photos
    uploads.removeValue(forKey: id)?.cancel()
    error = nil
    // The first stays in the queue, saved, so it survives the app closing.
    if index == 0 { queue[0].editing = true } else { queue.remove(at: index) }
  }

  /// AI sharing was turned off in Profile: photos still uploading for
  /// waiting messages stop, and nothing more goes to Coach.
  func consentWithdrawn() {
    for upload in uploads.values { upload.cancel() }
    uploads = [:]
  }

  /// Throws unless the message may still go to Coach: AI sharing allowed,
  /// and the account it was sent from signed in. Checked before every
  /// request, including those sent again after a wait.
  private func checkAllowed(_ item: Outgoing, app: AppModel) throws {
    guard app.session?.accountID == item.account else { throw AccountChanged() }
    guard AIConsent.granted else { throw SwitchedOff() }
  }

  private func startUpload(_ item: Outgoing, app: AppModel) {
    guard !item.photos.isEmpty, AIConsent.granted, app.session?.accountID == item.account else { return }
    let photos = item.photos.map { (id: $0.id, day: $0.day, jpeg: $0.jpeg) }
    let client = app.client
    uploads[item.id] = Task { try await Self.upload(photos, client: client) }
  }

  /// The message's uploaded photo ids. An upload that failed while the
  /// message waited (the signal dropped, say) is tried once more now its
  /// turn has come. Stop cancels the upload rather than waiting for it.
  private func photoIDs(for item: Outgoing, app: AppModel) async throws -> [UUID] {
    guard !item.photos.isEmpty else { return [] }
    if let early = uploads[item.id] {
      do {
        return try await Self.value(of: early)
      } catch {
        // Stopped now; otherwise it failed, or was stopped earlier.
        if Task.isCancelled { throw error }
      }
    }
    try checkAllowed(item, app: app)
    startUpload(item, app: app)
    guard let upload = uploads[item.id] else { throw SwitchedOff() }
    do {
      return try await Self.value(of: upload)
    } catch {
      uploads[item.id] = nil
      throw error
    }
  }

  /// Waits for an upload, cancelling it if the wait is cancelled.
  private static func value(of upload: Task<[UUID], any Error>) async throws -> [UUID] {
    try await withTaskCancellationHandler {
      try await upload.value
    } onCancel: {
      upload.cancel()
    }
  }

  /// Answers the queue in order until it's empty, the first message has
  /// failed (it waits for Retry, Edit or Remove) or is being edited.
  private func process(_ app: AppModel) {
    guard !closed, runner == nil else { return }
    runner = Task {
      defer { runner = nil }
      while !Task.isCancelled, let next = queue.first, next.failure == nil, !next.editing {
        // Signed out, or into another account: the queue was the last
        // account's, and is never sent as this one.
        guard let session = app.session, session.accountID == next.account else {
          clear()
          break
        }
        // AI sharing withdrawn in Profile: nothing more goes to Coach.
        guard AIConsent.granted else {
          queue[0].failure = Self.switchedOffText
          break
        }
        picked = next.id
        let answer = Task { await self.answer(next, app: app) }
        current = answer
        await answer.value
        current = nil
        picked = nil
      }
    }
  }

  /// Forgets the queue without saving it: it belonged to an account that's
  /// no longer signed in, whose storage was removed at sign-out.
  private func clear() {
    store = nil
    for upload in uploads.values { upload.cancel() }
    uploads = [:]
    queue = []
  }

  /// Signed out: stops the message being answered and every upload, and
  /// saves, sends and loads nothing more. The next account gets a new model.
  func close() {
    closed = true
    runner?.cancel()
    current?.cancel()
    refreshing?.cancel()
    monitor.cancel()
    clear()
  }

  private func answer(_ item: Outgoing, app: AppModel) async {
    guard let session = app.session, session.accountID == item.account else { return }
    // A little time to finish if the athlete switches app mid-reply; the
    // server carries on regardless, and the reply is read when they're back.
    let background = BackgroundTime("Coach reply")
    let stream = CoachStream(token: session.token, account: session.accountID)
    sending = true
    error = nil
    asking = item.message
    sendingPreviews = item.photos.map(\.preview)
    step = item.photos.isEmpty ? nil : "Uploading photos"
    reply = ""
    liveVisuals = []
    reachedCoach = false
    pending = (item.id, stream)
    defer {
      sending = false
      step = nil
      pending = nil
      asking = nil
      reply = ""
      liveVisuals = []
      sendingPreviews = []
      reachedCoach = false
      background.end()
    }
    do {
      let ids = try await waitingOutRateLimits { try await self.photoIDs(for: item, app: app) }
      // Stop, or AI sharing withdrawn, while the photos uploaded.
      try Task.checkCancellation()
      try checkAllowed(item, app: app)
      try await waitingOutRateLimits { try await self.ask(item, photoIDs: ids, stream: stream, app: app) }
      // A Stop mid-reply ends the stream quietly: it's still a stop.
      try Task.checkCancellation()
      // Answered: there's nothing left to stop.
      sending = false
      uploads[item.id] = nil
      await load(app)
      await app.loadToday()
      // Last, so the saved turn takes the live copy's place in one update.
      queue.removeAll { $0.id == item.id }
    } catch is AccountChanged {
      // Nothing sent; the runner forgets the last account's queue next.
    } catch where Task.isCancelled || Retry.isCancellation(error) {
      stopped(item, app: app)
    } catch {
      await failed(item, error: error, app: app)
    }
  }

  /// Stopped by the athlete. Before it reached Coach, the message goes back
  /// to the text field if that's empty, or stays first in the queue to send
  /// again: it's never thrown away. After, the server stops the reply.
  private func stopped(_ item: Outgoing, app: AppModel) {
    guard !closed else { return }
    // Its upload was cancelled too: a later send starts a fresh one.
    uploads[item.id] = nil
    guard let index = queue.firstIndex(where: { $0.id == item.id }) else { return }
    if reachedCoach {
      queue.remove(at: index)
      // In a task of its own: this one is cancelled, and so would its
      // requests be.
      Task {
        await self.load(app, showingErrors: false)
        await app.loadToday()
      }
    } else if !hasDraft && index == 0 {
      draft = item.text
      attachments = item.photos
      queue[0].editing = true
    } else {
      queue[index].failure = Self.stoppedText
    }
  }

  /// Nothing was saved: it waits first in the queue, saying why, to be
  /// sent again.
  private func failed(_ item: Outgoing, error: any Error, app: AppModel) async {
    guard !closed else { return }
    var offline = false
    let reason: String
    switch error {
    case is Expired: reason = Self.expiredText
    case is SwitchedOff: reason = Self.switchedOffText
    case _ where CoachFailure.isOffline(error):
      reason = Self.offlineText
      offline = true
    case _ where CoachFailure.isUnreachable(error):
      reason = Self.unreachableText
      offline = true
    case let failure as CoachFailure where failure.status == 401 || failure.status == 426:
      // Signed out or out of date, as for any other request.
      reason = await app.handle(APIFailure(status: failure.status, message: failure.message)) ?? failure.message
    case let failure as CoachFailure:
      reason = failure.message
    case _ where Retry.urlError(error) != nil:
      reason = Self.droppedText
    default:
      reason = await app.handle(error) ?? Self.droppedText
    }
    guard let index = queue.firstIndex(where: { $0.id == item.id }) else { return }
    queue[index].failure = reason
    queue[index].offline = offline
    queue[index].expired = error is Expired
    UIAccessibility.post(notification: .announcement, argument: "Message not sent. \(reason)")
    // Shows the server's failed turn, if any, without a second error.
    await load(app, showingErrors: false)
  }

  /// Runs a request again when the server says too many came at once,
  /// after the wait it asks for (or about 15 seconds), up to three times.
  private func waitingOutRateLimits<T>(_ operation: () async throws -> T) async throws -> T {
    var waits = 0
    while true {
      do {
        return try await operation()
      } catch {
        guard waits < 3, let wait = Self.rateLimitWait(error) else { throw error }
        waits += 1
        // A 429 means Coach didn't take it.
        reachedCoach = false
        step = "Waiting a moment"
        try await Task.sleep(for: .seconds(wait))
      }
    }
  }

  private static func rateLimitWait(_ error: any Error) -> Double? {
    if let failure = error as? CoachFailure, failure.status == 429 {
      return min(max(failure.retryAfter ?? 15, 1), 60)
    }
    if let failure = error as? APIFailure, failure.status == 429 { return 15 }
    return nil
  }

  /// Runs the turn. A 409 means the journal changed since Today last loaded
  /// (a save from this phone or another device), the message is already
  /// with Coach (as after the app closed mid-reply), or it waited too long.
  /// The server checks in that order, and whichever 409 comes last decides.
  private func ask(_ item: Outgoing, photoIDs ids: [UUID], stream: CoachStream, app: AppModel) async throws {
    do {
      try await run(item, photoIDs: ids, stream: stream, app: app)
    } catch let failure as CoachFailure where failure.status == 409 && !Task.isCancelled {
      // Nothing was saved: Stop gives it back from here.
      reachedCoach = false
      if try await stillAnswering(item.id, app: app) { return try await following(item.id, app: app) }
      let before = app.today?.revision
      await app.loadToday()
      try Task.checkCancellation()
      guard let after = app.today?.revision, after != before else { throw refusal(failure, item) }
      do {
        try await run(item, photoIDs: ids, stream: stream, app: app)
      } catch let again as CoachFailure where again.status == 409 && !Task.isCancelled {
        reachedCoach = false
        if try await stillAnswering(item.id, app: app) { return try await following(item.id, app: app) }
        throw refusal(again, item)
      }
    }
  }

  /// A 409 that stands with the journal up to date: a message that waited
  /// over a day is out of date; otherwise the server says why.
  private func refusal(_ failure: CoachFailure, _ item: Outgoing) -> any Error {
    item.sentAt < .now - 86_400 ? Expired() : failure
  }

  /// Follows a turn the server is already answering; Stop stops it there.
  private func following(_ id: UUID, app: AppModel) async throws {
    reachedCoach = true
    try await follow(id, app: app)
  }

  /// Whether the server is still answering the message; throws if stopped.
  private func stillAnswering(_ id: UUID, app: AppModel) async throws -> Bool {
    let key = id.uuidString.lowercased()
    let history = try? await app.client.getCoach().value()
    try Task.checkCancellation()
    return history?.turns.contains { $0.id == key && $0.status == "running" } ?? false
  }

  private func run(_ item: Outgoing, photoIDs ids: [UUID], stream: CoachStream, app: AppModel) async throws {
    // Sent again after a wait, too: the athlete may have switched Coach off.
    try checkAllowed(item, app: app)
    reachedCoach = true
    let progress = CoachStream.Progress()
    self.progress = progress
    defer {
      self.progress = nil
      reconnect = nil
    }
    do {
      try await show(
        stream.run(
          id: item.id, message: item.message, revision: app.today?.revision ?? 0, photoIDs: ids,
          language: CoachLanguage.current.rawValue, submittedAt: item.sentAt, progress: progress))
      // Stop ends the stream without an error: throw, so it counts as one.
      try Task.checkCancellation()
    } catch let failure as CoachFailure where failure.connection != nil || failure.status == 429 {
      // Nothing reached Coach.
      reachedCoach = false
      throw failure
    } catch where !Task.isCancelled {
      // The connection dropped, usually because the app was in the
      // background: Coach is still working on the server.
      try await readOn(item.id, after: error, stream: stream, progress: progress, app: app)
    }
  }

  /// Shows the reply as its events arrive.
  private func show(_ events: AsyncThrowingStream<CoachEvent, any Error>) async throws {
    for try await event in events {
      reconnect?.restart()
      switch event {
      case .step(let text): step = text
      case .reply(let text): reply = text
      case .visual(let visual):
        if !liveVisuals.contains(where: { $0.id == visual.id }) { liveVisuals.append(visual) }
      case .reset:
        // Written again from the start after a crash on the server.
        reply = ""
        liveVisuals = []
      case .finished: step = nil
      }
    }
  }

  /// After the reply's stream ended early: reads it on from its last event
  /// when the events carried ids, with longer waits between tries, or
  /// waits for the saved turn, as it does without ids. Throws the failure
  /// when it wasn't a dropped connection.
  private func readOn(
    _ id: UUID, after error: any Error, stream: CoachStream, progress: CoachStream.Progress, app: AppModel
  ) async throws {
    var failure = error
    reconnect = CoachReconnect()
    while true {
      guard let next = reconnect?.next(after: failure) else { throw failure }
      switch next {
      case .fail: throw failure
      case .waitForSaved: return try await follow(id, app: app)
      case .readOn(let wait):
        try await pause(wait)
        do {
          try await show(stream.resume(id: id, progress: progress))
          try Task.checkCancellation()
          return
        } catch where !Task.isCancelled {
          failure = error
        }
      }
    }
  }

  /// Waits before reading on, or less if the app comes back to the
  /// foreground meanwhile. Throws if stopped.
  private func pause(_ wait: Duration) async throws {
    guard wait > .zero else { return }
    let sleep = Task<Void, Never> { try? await Task.sleep(for: wait) }
    pausing = sleep
    await withTaskCancellationHandler {
      await sleep.value
    } onCancel: {
      sleep.cancel()
    }
    pausing = nil
    try Task.checkCancellation()
  }

  /// Back in the foreground mid-reply. A reply waiting to be read on is
  /// tried at once. With ids, a connection that has brought nothing for
  /// twice the server's keep-alive, as after the app was suspended, is
  /// taken as lost, and the reply is read on from where it was.
  func foregrounded() {
    guard let progress else { return }
    reconnect?.restart()
    pausing?.cancel()
    progress.dropIfQuiet(for: .seconds(20))
  }

  /// Waits for a turn whose stream was cut off to finish on the server, for
  /// up to three minutes. Throws if it failed, never reached the server, or
  /// couldn't be checked at all; seen running at the end of the wait, the
  /// turn stays in the thread to refresh later.
  private func follow(_ id: UUID, app: AppModel) async throws {
    step = "Still working"
    let key = id.uuidString.lowercased()
    let deadline = ContinuousClock.now + .seconds(180)
    var running = false
    // A photo turn's row can appear up to 20 seconds after the request.
    var missingSince: ContinuousClock.Instant?
    while ContinuousClock.now < deadline {
      try Task.checkCancellation()
      do {
        let history = try await app.client.getCoach().value()
        if let turn = history.turns.first(where: { $0.id == key }) {
          missingSince = nil
          switch turn.status {
          case "done": return
          case "failed":
            throw CoachFailure(message: "Coach could not finish that one. Tap Retry to send it again.", status: 0)
          default:
            running = true
            if let saved = turn.reply, !saved.isEmpty { reply = saved }
          }
        } else if !running {
          let since = missingSince ?? .now
          missingSince = since
          if ContinuousClock.now - since > .seconds(25) {
            // Never received: safe to send again with the same id.
            reachedCoach = false
            throw CoachFailure(message: "Coach didn't get that message. Tap Retry to send it again.", status: 0)
          }
        }
      } catch let failure as CoachFailure {
        throw failure
      } catch where Task.isCancelled || Retry.isCancellation(error) {
        throw CancellationError()
      } catch {
        // Couldn't check this time; the wait goes on.
      }
      try await Task.sleep(for: .seconds(2))
    }
    // Never seen: it can't be counted as answered.
    guard running else { throw CoachFailure(message: Self.unreachableText, status: 0) }
    // Not put back to send again: it may still arrive, and would be doubled.
    error = "Coach is taking longer than usual. Pull down in a minute to see the reply."
  }

  /// Uploads the photos side by side rather than one after another, each
  /// retried if the connection drops: the server keeps one image per ID, so
  /// sending it again is safe. The server answers once each is saved and
  /// sorts it into the image library afterwards.
  private static func upload(_ photos: [(id: UUID, day: String, jpeg: Data)], client: Client) async throws -> [UUID] {
    try await withThrowingTaskGroup(of: Void.self) { group in
      for photo in photos {
        group.addTask {
          let upload = Components.Schemas.ImageUpload(
            id: photo.id.uuidString.lowercased(), label: "Coach photo", date: photo.day, autoTag: true,
            tagInBackground: true, image: photo.jpeg.base64EncodedString())
          try await Retry.droppedConnections {
            try await client.uploadImage(body: .json(upload)).value()
          }
        }
      }
      try await group.waitForAll()
    }
    return photos.map(\.id)
  }

  /// Stop the message being answered: the server would otherwise finish
  /// it in the background. Messages waiting behind it go next.
  func cancel() {
    if let pending, reachedCoach {
      Task { await pending.stream.cancel(id: pending.id) }
    }
    current?.cancel()
  }

  /// Watches the connection, to send a message that failed offline once
  /// it's back.
  private func watchConnection(_ app: AppModel) {
    monitor.pathUpdateHandler = { [weak self] path in
      let online = path.status == .satisfied
      Task { @MainActor [weak self] in self?.connectionChanged(online: online, app: app) }
    }
    monitor.start(queue: DispatchQueue(label: "Coach connection"))
  }

  private func connectionChanged(online: Bool, app: AppModel) {
    let back = online && !self.online
    self.online = online
    if back { resume(app) }
  }

  /// Save a receipt Coach prepared, or undo one it saved.
  func resolve(_ receipt: Components.Schemas.CoachReceipt, undo: Bool, app: AppModel) async {
    busyReceipt = receipt.id
    defer { busyReceipt = nil }
    do {
      try await app.client.applyProposal(body: .json(.init(id: receipt.id, undo: undo))).value()
      await load(app)
      await app.loadToday()
    } catch where Retry.isCancellation(error) {
      // Stopped on purpose: nothing to show.
    } catch {
      let unchanged = undo ? "it wasn't undone" : "it wasn't saved"
      self.error = await Self.describe(
        error, offline: "You're offline, so \(unchanged). Try again when you're back online.",
        unreachable: "Coach couldn't be reached, so \(unchanged). Try again shortly.", app: app)
    }
  }

  func attach(_ image: UIImage) {
    guard attachments.count < 4, let jpeg = Self.jpeg(image) else { return }
    attachments.append(Attachment(jpeg: jpeg))
  }

  /// At most 1280 pixels on the long side, as on the website.
  static func jpeg(_ image: UIImage) -> Data? {
    let longest = max(image.size.width, image.size.height)
    let scale = min(1, 1280 / max(longest, 1))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    return resized.jpegData(compressionQuality: 0.82)
  }
}

/// A message that waited over a day: the server no longer takes it.
private struct Expired: Error {}

/// AI sharing was withdrawn in Profile.
private struct SwitchedOff: Error {}

/// Signed out, or into another account, since the message was sent.
private struct AccountChanged: Error {}

/// Extra time iOS allows to finish work after the app leaves the screen
/// (about 30 seconds). It must be handed back before it runs out, or iOS
/// ends the app: when it runs out, it is.
@MainActor
final class BackgroundTime {
  private var id: UIBackgroundTaskIdentifier = .invalid

  init(_ name: String) {
    id = UIApplication.shared.beginBackgroundTask(withName: name) { [weak self] in self?.end() }
  }

  func end() {
    guard id != .invalid else { return }
    UIApplication.shared.endBackgroundTask(id)
    id = .invalid
  }
}
