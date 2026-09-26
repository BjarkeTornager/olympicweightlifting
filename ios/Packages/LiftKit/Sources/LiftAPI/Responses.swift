import Foundation
import OpenAPIRuntime

/// A refused or failed request, with the server's own explanation.
public struct APIFailure: LocalizedError, Sendable {
  public let status: Int
  public let message: String
  public var errorDescription: String? { message }
  /// The session is no longer valid: sign in again.
  public var signedOut: Bool { status == 401 }
  /// This build is no longer supported: install the latest from TestFlight.
  public var updateRequired: Bool { status == 426 }

  public init(status: Int, message: String) {
    self.status = status
    self.message = message
  }

  init(status: Int, body: Components.Schemas.ErrorBody?) {
    self.status = status
    message = body?.error ?? "The journal did not respond (\(status)). Try again shortly."
  }
}

// One accessor per operation turns the generated output into a value or an
// APIFailure carrying the server's message.

extension Operations.GetConfig.Output {
  public func value() throws -> Components.Schemas.NativeConfig {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.GetSession.Output {
  public func value() throws -> Components.Schemas.SessionInfo {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.ExchangeToken.Output {
  public func value() throws -> Components.Schemas.TokenResponse {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.GetToday.Output {
  public func value() throws -> Components.Schemas.Today {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.GetJournal.Output {
  public func value() throws -> Components.Schemas.JournalFeed {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.GetTrends.Output {
  public func value() throws -> Components.Schemas.Trends {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.ApplyAction.Output {
  public func value() throws -> Components.Schemas.ActionResult {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.SyncHealth.Output {
  public func value() throws -> Components.Schemas.HealthSyncResult {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.GetActivityRoute.Output {
  public func value() throws -> Components.Schemas.CoachVisual {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.GetCoach.Output {
  public func value() throws -> Components.Schemas.CoachHistory {
    switch self {
    case .ok(let ok): try ok.body.json
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.ApplyProposal.Output {
  public func value() throws {
    switch self {
    case .ok: return
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}
extension Operations.UploadImage.Output {
  public func value() throws {
    switch self {
    case .ok: return
    case .default(let status, let failure): throw APIFailure(status: status, body: try? failure.body.json)
    }
  }
}

/// Journal dates are local calendar days, written `yyyy-MM-dd`.
public enum JournalDay {
  public static func string(_ date: Date, calendar: Calendar = .current) -> String {
    let parts = calendar.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
  }

  public static func date(_ string: String, calendar: Calendar = .current) -> Date? {
    let parts = string.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3 else { return nil }
    return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
  }
}
