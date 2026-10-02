import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

@testable import LiftAPI

/// Coach photo uploads are retried when a mobile connection drops.
@Suite("Dropped connections")
struct RetryTests {
  final class Counter: @unchecked Sendable {
    var calls = 0
  }

  /// A connection failure as the generated client reports it.
  func wrapped(_ code: URLError.Code) -> any Error {
    ClientError(
      operationID: "uploadImage", operationInput: (), request: nil, requestBody: nil, baseURL: nil,
      response: nil, responseBody: nil, causeDescription: "Transport threw an error.",
      underlyingError: URLError(code))
  }

  @Test func recognisesWrappedConnectionErrors() {
    #expect(Retry.isDroppedConnection(wrapped(.networkConnectionLost)))
    #expect(Retry.isDroppedConnection(URLError(.timedOut)))
    #expect(!Retry.isDroppedConnection(wrapped(.badServerResponse)))
    #expect(!Retry.isDroppedConnection(APIFailure(status: 500, message: "No")))
    #expect(Retry.urlError(wrapped(.networkConnectionLost))?.code == .networkConnectionLost)
    #expect(APIFailure.client(wrapped(.networkConnectionLost)))
  }

  @Test func retriesADroppedConnection() async throws {
    let counter = Counter()
    let failure = wrapped(.networkConnectionLost)
    let value = try await Retry.droppedConnections(wait: .milliseconds(1)) {
      counter.calls += 1
      if counter.calls < 3 { throw failure }
      return "saved"
    }
    #expect(value == "saved" && counter.calls == 3)
  }

  @Test func givesUpAfterThreeAttemptsAndNeverRetriesOtherFailures() async {
    let counter = Counter()
    let failure = wrapped(.networkConnectionLost)
    await #expect(throws: (any Error).self) {
      try await Retry.droppedConnections(wait: .milliseconds(1)) {
        counter.calls += 1
        throw failure
      }
    }
    #expect(counter.calls == 3)
    let refused = Counter()
    await #expect(throws: APIFailure.self) {
      try await Retry.droppedConnections(wait: .milliseconds(1)) {
        refused.calls += 1
        throw APIFailure(status: 413, message: "Too large")
      }
    }
    #expect(refused.calls == 1)
  }
}
