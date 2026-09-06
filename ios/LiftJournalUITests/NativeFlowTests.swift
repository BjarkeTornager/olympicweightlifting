import XCTest

@MainActor final class NativeFlowTests: XCTestCase {
  override func setUp() async throws {
    continueAfterFailure = false
    _ = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:34567/__reset")!)
  }
  func testNativeLoggingCoachReviewAndPhoneNavigation() throws {
    let app = XCUIApplication()
    app.launchEnvironment["LIFT_TEST_SERVER"] = "http://localhost:34567"
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Today"].waitForExistence(timeout: 20))
    app.tabBars.buttons["Today"].tap()
    XCTAssertTrue(app.staticTexts["Make today yours."].waitForExistence(timeout: 5))
    let today = XCTAttachment(screenshot: app.screenshot())
    today.name = "native-today"
    today.lifetime = .keepAlways
    add(today)
    app.buttons["Activity"].tap()
    let minutes = app.textFields["Minutes"]
    XCTAssertTrue(minutes.waitForExistence(timeout: 5))
    minutes.tap()
    minutes.typeText("28")
    app.textFields["Distance"].tap()
    app.textFields["Distance"].typeText("5")
    app.navigationBars.buttons["Save"].tap()
    XCTAssertTrue(app.staticTexts["Make today yours."].waitForExistence(timeout: 10))
    app.tabBars.buttons["Train"].tap()
    app.segmentedControls.buttons["Cardio"].tap()
    XCTAssertTrue(app.staticTexts["Running"].waitForExistence(timeout: 5))
    let cardio = XCTAttachment(screenshot: app.screenshot())
    cardio.name = "native-cardio"
    cardio.lifetime = .keepAlways
    add(cardio)
    app.tabBars.buttons["Coach"].tap()
    let composer =
      app.textFields["coach-composer"].exists
      ? app.textFields["coach-composer"] : app.textViews["coach-composer"]
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    composer.tap()
    composer.typeText("I ran 5 km in 28 minutes 20 seconds today.")
    app.buttons["Send message"].tap()
    let save = app.buttons["Save to journal"]
    if !save.waitForExistence(timeout: 10) { app.swipeUp() }
    XCTAssertTrue(save.waitForExistence(timeout: 5))
    save.tap()
    XCTAssertTrue(
      app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Saved · ")).firstMatch
        .waitForExistence(timeout: 10))
    let coach = XCTAttachment(screenshot: app.screenshot())
    coach.name = "native-coach"
    coach.lifetime = .keepAlways
    add(coach)
    app.tabBars.buttons["Journal"].tap()
    XCTAssertTrue(app.navigationBars["Journal"].exists)
    app.tabBars.buttons["You"].tap()
    XCTAssertFalse(app.buttons["Invitations"].exists)
  }
  private func fixture(_ path: String) async throws -> [String: Any] {
    let (data, _) = try await URLSession.shared.data(
      from: URL(string: "http://127.0.0.1:34567/" + path)!)
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
  }
  private func waitForFormToClose(_ app: XCUIApplication, title: String) throws {
    let gone = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "exists == false"), object: app.navigationBars[title])
    guard XCTWaiter.wait(for: [gone], timeout: 15) == .completed else {
      throw NSError(
        domain: "NativeFlow", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Form did not finish saving: \(title)"])
    }
  }
  private func fill(_ field: XCUIElement, _ value: String) throws {
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    let old = field.value as? String ?? ""
    if old.isEmpty || old == "—" || old == field.placeholderValue {
      field.tap()
    } else {
      field.doubleTap()
      let selectAll = XCUIApplication().menuItems["Select All"]
      if selectAll.exists { selectAll.tap() }
    }
    field.typeText(value)
    guard field.value as? String == value else {
      throw NSError(
        domain: "NativeFlow", code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Text replacement failed for \(field.label)"])
    }
  }
  func testSleepFoodAndStrengthUseNativeFormsAndSharedRules() async throws {
    let app = XCUIApplication()
    app.launchEnvironment["LIFT_TEST_SERVER"] = "http://localhost:34567"
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Today"].waitForExistence(timeout: 20))
    app.tabBars.buttons["Today"].tap()
    app.buttons["Check-in"].tap()
    try fill(app.textFields["Hours asleep"], "8")
    try fill(app.textFields["Minutes asleep"], "15")
    app.navigationBars.buttons["Save"].tap()
    try waitForFormToClose(app, title: "Daily check-in")
    XCTAssertTrue(app.buttons["Food"].waitForExistence(timeout: 10))
    app.buttons["Food"].tap()
    try fill(app.textFields["Meal or food name"], "Synthetic oats")
    try fill(app.textFields["Portion, e.g. 200 g"], "100 g")
    try fill(app.textFields["Calories · kcal"], "389")
    try fill(app.textFields["Protein · g"], "17")
    try fill(app.textFields["Carbs · g"], "66")
    try fill(app.textFields["Fat · g"], "7")
    app.navigationBars.buttons["Save"].tap()
    try waitForFormToClose(app, title: "Log food")
    XCTAssertTrue(app.buttons["Food"].waitForExistence(timeout: 10))
    app.tabBars.buttons["Train"].tap()
    app.staticTexts["Gym Accessories"].tap()
    app.buttons["Start workout"].tap()
    XCTAssertTrue(app.navigationBars["Workout"].waitForExistence(timeout: 10))
    app.buttons["Log next set"].firstMatch.tap()
    try fill(app.textFields["Weight · kg"], "47.5")
    try fill(app.textFields["Repetitions"], "8")
    app.navigationBars.buttons["Save"].tap()
    try waitForFormToClose(app, title: "Log set")
    XCTAssertTrue(app.buttons["Finish workout"].waitForExistence(timeout: 10))
    app.swipeUp()
    app.buttons["Finish workout"].tap()
    let finishButtons = app.buttons.matching(identifier: "Finish workout")
    finishButtons.element(boundBy: finishButtons.count - 1).tap()
    XCTAssertTrue(app.buttons["Start workout"].waitForExistence(timeout: 10))
    let snapshot = try await fixture("__state")
    let state = snapshot["state"] as! [String: Any]
    let health = state["health"] as! [String: Any]
    let checkin = (health["checkins"] as! [[String: Any]])[0]
    XCTAssertEqual(checkin["sleepHours"] as? Double, 8.25)
    XCTAssertEqual(checkin["waterMl"] as? Int, 1000)
    XCTAssertEqual(((state["nutrition"] as! [String: Any])["meals"] as! [Any]).count, 1)
    XCTAssertEqual((state["sessions"] as! [Any]).count, 1)
  }
  func testLostAcknowledgementRetriesOnceAndOfflineReturnHidesPrivateScreens() async throws {
    let app = XCUIApplication()
    app.launchEnvironment["LIFT_TEST_SERVER"] = "http://localhost:34567"
    app.launch()
    XCTAssertTrue(app.tabBars.buttons["Today"].waitForExistence(timeout: 20))
    _ = try await fixture("__lose-ack")
    app.tabBars.buttons["Today"].tap()
    app.buttons["Activity"].tap()
    try fill(app.textFields["Minutes"], "20")
    app.navigationBars.buttons["Save"].tap()
    XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 10))
    app.alerts.buttons["OK"].tap()
    app.navigationBars.buttons["Cancel"].tap()
    app.buttons["Unsent change · Review recovery"].tap()
    app.buttons["Retry save"].tap()
    XCTAssertTrue(
      app.staticTexts["All confirmed changes are on your account"].waitForExistence(timeout: 10))
    app.navigationBars.buttons["Done"].tap()
    let snapshot = try await fixture("__state")
    XCTAssertEqual(snapshot["revision"] as? Int, 1)
    let state = snapshot["state"] as! [String: Any]
    XCTAssertEqual(((state["cardio"] as! [String: Any])["sessions"] as! [Any]).count, 2)
    // Keep a private form open: the privacy window must cover sheets too.
    app.buttons["Check-in"].tap()
    _ = try await fixture("__disconnect")
    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(app.buttons["Reconnect to your journal"].waitForExistence(timeout: 15))
    XCTAssertFalse(app.textFields["Hours asleep"].isHittable)
    let hidden = XCTAttachment(screenshot: app.screenshot())
    hidden.name = "native-private-reconnect"
    hidden.lifetime = .keepAlways
    add(hidden)
    _ = try await fixture("__reconnect")
    app.buttons["Reconnect to your journal"].tap()
    XCTAssertTrue(app.textFields["Hours asleep"].waitForExistence(timeout: 10))
  }

}
