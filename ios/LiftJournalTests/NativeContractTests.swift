import XCTest

@testable import LiftJournal

final class NativeContractTests: XCTestCase {
  func testJournalRoundTripPreservesUnknownDomainsAndFractionalMeasurements() throws {
    let data = Data(
      #"{"cardio":{"sessions":[{"distanceKm":5.1234,"durationSeconds":1700}]},"future":{"keep":true},"profile":{"bodyweight":81.5}}"#
        .utf8)
    let value = try JSONValue.decode(data)
    let changed = value.setting(["profile", "name"], to: .string("Synthetic"))
    let roundTrip = try JSONValue.decode(changed.data)
    XCTAssertEqual(roundTrip["future"], value["future"])
    XCTAssertEqual(roundTrip["cardio"], value["cardio"])
    XCTAssertEqual(roundTrip["profile"]["bodyweight"].double, 81.5)
  }
  func testPKCECallbackRequiresTheOriginalStateAndExpectedScheme() throws {
    let proof = LoginProof()
    XCTAssertEqual(proof.challenge.count, 43)
    let code = String(repeating: "a", count: 43)
    XCTAssertEqual(
      try proof.code(from: URL(string: "liftjournal://auth?code=\(code)&state=\(proof.state)")!),
      code)
    XCTAssertThrowsError(
      try proof.code(from: URL(string: "liftjournal://auth?code=\(code)&state=wrong")!))
    XCTAssertThrowsError(
      try proof.code(from: URL(string: "https://auth?code=\(code)&state=\(proof.state)")!))
  }
  func testInvalidMeasurementsAreNeverSilentlyConvertedToZero() throws {
    XCTAssertThrowsError(try checkedNumber("no", name: "distance"))
    XCTAssertThrowsError(try checkedNumber("nan", name: "distance"))
    XCTAssertThrowsError(try enteredDuration(hours: "", minutes: "28", seconds: "61"))
    XCTAssertEqual(try enteredDuration(hours: "", minutes: "28", seconds: "20"), 1700)
    XCTAssertEqual(try checkedNumber("5,25", name: "distance"), .number(5.25))
  }
  func testExactDurationAndMissingValues() {
    XCTAssertEqual(duration(1700), "28 min 20 sec")
    XCTAssertEqual(duration(3630), "1 h 30 sec")
    XCTAssertEqual(optionalNumber(""), .null)
    XCTAssertEqual(optionalNumber("0"), .number(0))
    XCTAssertEqual(optionalNumber("5,25"), .number(5.25))
  }
}
