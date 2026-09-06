import CryptoKit
import Foundation
import Observation
import UIKit

@MainActor @Observable final class JournalStore {
  let api = APIClient()
  private let google = GoogleSignIn()
  private var token: String? = CredentialStore.read()
  private var generation = UUID()
  private var coachTask: Task<Void, Never>?
  private var runID: String?
  private(set) var checking = false
  private var retrying = false
  var user: JSONValue = .null
  var verified = false
  var signingIn = false
  var snapshot: JSONValue = .null
  var overview: JSONValue = .null
  var programmes: [JSONValue] = []
  var exercises: [JSONValue] = []
  var turns: [JSONValue] = []
  var images: [JSONValue] = []
  var error: String?
  var busy = false
  var streaming = false
  var liveReply = ""
  var step = ""
  var composer = ""
  var attachments: [JSONValue] = []
  var pending: JSONValue?
  var selectedTab = 0
  var streamRevision = 0
  var canInvite = false
  var recoveryPresented = false
  var autoTagImages = true
  var lastSynced: Date?
  var state: JSONValue { snapshot["state"] }
  var revision: Int { snapshot["revision"].int }
  var accountID: String { user["id"].string }
  var hasCredential: Bool { token != nil }
  var canSave: Bool { verified && !busy && !streaming && pending == nil }
  init() {
    #if DEBUG
      if ProcessInfo.processInfo.environment["LIFT_TEST_SERVER"] != nil {
        token = "synthetic-test-token"
      }
    #endif
  }
  func suspend() {
    verified = false
    cancelCoach()
  }
  func verify() async {
    guard !checking, !signingIn, let token else { return }
    checking = true
    defer { checking = false }
    let epoch = generation
    do {
      let value = try await api.call("/api/session", token: token)
      guard epoch == generation else { return }
      guard !value["user"].isNull else {
        expire()
        return
      }
      if !user.isNull && accountID != value["user"]["id"].string { eraseMemory() }
      user = value["user"]
      canInvite = value["canInvite"].bool
      pending = try? JSONValue.decode(Data(contentsOf: pendingURL()))
      try await load()
      guard epoch == generation else { return }
      verified = true
      error = nil
    } catch {
      guard epoch == generation else { return }
      // Keep presented forms mounted beneath the privacy window on connection
      // loss. A root alert would dismiss their sheet and discard unsaved text.
      if user.isNull || (error as? ServiceError)?.status == 401 { handle(error) }
      verified = false
    }
  }
  func signIn() async {
    guard !signingIn else { return }
    signingIn = true
    error = nil
    do {
      let (code, verifier) = try await google.authenticate()
      let value = try await api.call(
        "/api/mobile/token", method: "POST", body: json(["code": s(code), "verifier": s(verifier)]))
      guard !value["token"].string.isEmpty else {
        throw ServiceError(message: "Sign-in did not complete.")
      }
      try CredentialStore.save(value["token"].string)
      token = value["token"].string
      generation = UUID()
      signingIn = false
      await verify()
    } catch {
      signingIn = false
      handle(error)
    }
  }
  private func eraseMemory() {
    cancelCoach()
    snapshot = .null
    overview = .null
    turns = []
    images = []
    programmes = []
    exercises = []
    attachments = []
    composer = ""
    pending = nil
    user = .null
    verified = false
    canInvite = false
    lastSynced = nil
  }
  private func expire() {
    generation = UUID()
    token = nil
    CredentialStore.clear()
    eraseMemory()
    error = "Sign in again to open your private journal."
  }
  func handle(_ error: Error) {
    if (error as? ServiceError)?.status == 401 {
      expire()
    } else if !(error is CancellationError) {
      self.error = error.localizedDescription
    }
  }
  func signOut() async {
    guard !busy, !streaming else {
      error = "Finish the current change before signing out."
      return
    }
    guard pending == nil else {
      error = "Resolve the unsent save before signing out. You can export it from Recovery."
      return
    }
    guard let token else {
      expire()
      return
    }
    do {
      _ = try await api.call("/api/auth/sign-out", method: "POST", token: token, body: json([:]))
      expire()
      error = nil
    } catch { handle(error) }
  }
  func request(_ path: String, method: String = "GET", body: JSONValue? = nil) async throws
    -> JSONValue
  {
    guard let token, !accountID.isEmpty else {
      throw ServiceError(message: "Sign in to open your journal.", status: 401)
    }
    let epoch = generation
    do {
      let value = try await api.call(
        path, method: method, token: token, account: accountID, body: body)
      guard epoch == generation else { throw CancellationError() }
      return value
    } catch {
      guard epoch == generation else { throw CancellationError() }
      if (error as? ServiceError)?.status == 401 { handle(error) }
      throw error
    }
  }
  func load() async throws {
    let result = try await request("/api/mobile/overview?date=\(dayString())")
    snapshot = json(["state": result["state"], "revision": result["revision"]])
    overview = result["overview"]
    programmes = result["programmes"].array
    exercises = result["exercises"].array
    lastSynced = .now
    let chat = try await request("/api/agent")
    turns = chat["turns"].array
    let library = try await request("/api/images")
    images = library["images"].array
  }
  func refresh() async { do { try await load() } catch { handle(error) } }
  func saveAction(_ action: JSONValue) async throws {
    guard canSave else {
      throw ServiceError(message: "Finish the current save or Coach reply first.")
    }
    busy = true
    defer { busy = false }
    let prepared = try await request(
      "/api/mobile/prepare", method: "POST",
      body: json([
        "action": action, "revision": n(Double(revision)),
        "timezone": s(TimeZone.current.identifier),
      ]))
    try await savePrepared(prepared)
  }
  func saveState(_ state: JSONValue) async throws {
    guard canSave else { throw ServiceError(message: "Finish the current save first.") }
    busy = true
    defer { busy = false }
    try await savePrepared(json(["state": state, "revision": n(Double(revision))]))
  }
  private func savePrepared(_ value: JSONValue) async throws {
    let payload = json([
      "state": value["state"], "revision": value["revision"],
      "mutationId": s(UUID().uuidString.lowercased()),
    ])
    let data = try payload.data
    let url = pendingURL()
    try data.write(to: url, options: [.atomic, .completeFileProtection])
    var excluded = url
    var flags = URLResourceValues()
    flags.isExcludedFromBackup = true
    try excluded.setResourceValues(flags)
    pending = payload
    try await retryPending()
  }
  func retryPending() async throws {
    guard !retrying, let pending else { return }
    retrying = true
    let wasBusy = busy
    busy = true
    defer {
      retrying = false
      busy = wasBusy
    }
    let result = try await request("/api/journal", method: "PUT", body: pending)
    guard result["accountId"].string == accountID else {
      throw ServiceError(message: "Your account changed. Sign in again.", status: 401)
    }
    snapshot = result
    self.pending = nil
    try? FileManager.default.removeItem(at: pendingURL())
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    do { try await load() } catch { handle(error) }
  }
  func discardPending() async {
    guard !busy else { return }
    pending = nil
    try? FileManager.default.removeItem(at: pendingURL())
    await refresh()
  }
  func pendingURL() -> URL {
    let digest = Data(SHA256.hash(data: Data(accountID.utf8))).map { String(format: "%02x", $0) }
      .joined()
    return FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("pending-\(digest).json")
  }
  func ask(_ prompt: String) {
    composer = composer.isEmpty ? prompt : composer + "\n" + prompt
    selectedTab = 0
  }
  func cancelCoach() {
    coachTask?.cancel()
    coachTask = nil
    runID = nil
    streaming = false
    liveReply = ""
    step = ""
  }
  func send() {
    let question = composer.trimmingCharacters(in: .whitespacesAndNewlines)
    guard canSave, !question.isEmpty, question.count <= 6000, let token else { return }
    streaming = true
    error = nil
    liveReply = ""
    step = "Connecting to Coach"
    let id = UUID().uuidString.lowercased()
    runID = id
    let epoch = generation
    let account = accountID
    let body = json([
      "threadId": s("ios-\(account)"), "runId": s(id),
      "messages": .array([json(["id": s(id), "role": s("user"), "content": s(question)])]),
      "state": json([:]), "tools": .array([]), "context": .array([]),
      "forwardedProps": json([
        "photoIds": .array(attachments.map { s($0.id) }), "revision": n(Double(revision)),
        "timezone": s(TimeZone.current.identifier),
      ]),
    ])
    coachTask = Task {
      do {
        try await api.stream(token: token, account: account, body: body) { [weak self] value in
          await self?.receive(value, question: question, id: id, epoch: epoch)
        }
        guard generation == epoch, runID == id else { return }
        streaming = false
        step = ""
        coachTask = nil
      } catch {
        guard generation == epoch, runID == id else { return }
        streaming = false
        step = ""
        liveReply = ""
        handle(error)
      }
    }
  }
  private func receive(_ event: JSONValue, question: String, id: String, epoch: UUID) {
    guard epoch == generation, streaming, runID == id else { return }
    switch event["type"].string {
    case "TEXT_MESSAGE_CONTENT":
      liveReply += event["delta"].string
      streamRevision += 1
    case "STEP_STARTED": step = event["stepName"].string
    case "RUN_FINISHED":
      let turn = event["result"].setting(["question"], to: s(question)).setting(["id"], to: s(id))
        .setting(["status"], to: s("done"))
      turns.append(turn)
      composer = ""
      attachments = []
      liveReply = ""
      streamRevision += 1
    default: break
    }
  }
  func confirm(_ proposal: JSONValue, undo: Bool = false) async throws {
    guard canSave else { throw ServiceError(message: "Finish the current change first.") }
    busy = true
    defer { busy = false }
    _ = try await request(
      "/api/agent/action", method: "POST", body: json(["id": s(proposal.id), "undo": .bool(undo)]))
    do { try await load() } catch { handle(error) }
    UINotificationFeedbackGenerator().notificationOccurred(.success)
  }
  func upload(_ image: UIImage) async throws {
    guard canSave, attachments.count < 4 else {
      throw ServiceError(message: "Attach up to four images after the current change finishes.")
    }
    busy = true
    defer { busy = false }
    let scale = min(1, 1600 / max(image.size.width, image.size.height))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let pixels = UIGraphicsImageRenderer(size: size).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let data = pixels.jpegData(compressionQuality: 0.8), data.count < 2_000_000 else {
      throw ServiceError(message: "This image is too large. Choose a smaller image.")
    }
    let result = try await request(
      "/api/images", method: "POST",
      body: json([
        "id": s(UUID().uuidString.lowercased()), "date": s(dayString()),
        "label": s("Image from iPhone"), "autoTag": .bool(autoTagImages),
        "image": s(data.base64EncodedString()),
      ]))
    attachments.append(result)
    images.insert(result, at: 0)
    if composer.isEmpty {
      composer =
        "Help me read this image. Identify what it shows first, then ask what I want to log."
    }
  }
  func image(_ id: String) async throws -> Data {
    guard let token else { throw ServiceError(message: "Sign in again.", status: 401) }
    let epoch = generation
    let data = try await api.image(id, token: token, account: accountID)
    guard epoch == generation else { throw CancellationError() }
    return data
  }
  func exerciseName(_ id: String) -> String {
    exercises.first { $0.id == id }?["name"].string
      ?? id.replacingOccurrences(of: "_", with: " ").capitalized
  }
}
