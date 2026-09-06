import Foundation

indirect enum JSONValue: Codable, Hashable, Sendable {
  case object([String: JSONValue])
  case array([JSONValue])
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([JSONValue].self) {
      self = .array(v)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .object(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .bool(let v): try c.encode(v)
    case .null: try c.encodeNil()
    }
  }
  subscript(_ key: String) -> JSONValue {
    if case .object(let v) = self { v[key] ?? .null } else { .null }
  }
  var array: [JSONValue] { if case .array(let v) = self { v } else { [] } }
  var string: String {
    if case .string(let v) = self {
      v
    } else if case .number(let v) = self {
      String(v).hasSuffix(".0") ? String(String(v).dropLast(2)) : String(v)
    } else {
      ""
    }
  }
  var double: Double? {
    if case .number(let v) = self {
      v
    } else if case .string(let v) = self {
      Double(v)
    } else {
      nil
    }
  }
  var int: Int { Int(double ?? 0) }
  var bool: Bool { if case .bool(let v) = self { v } else { false } }
  var isNull: Bool { self == .null }
  func setting(_ path: [String], to value: JSONValue) -> JSONValue {
    guard let head = path.first else { return value }
    var object: [String: JSONValue] = [:]
    if case .object(let old) = self { object = old }
    object[head] = (object[head] ?? .null).setting(Array(path.dropFirst()), to: value)
    return .object(object)
  }
  static func decode(_ data: Data) throws -> JSONValue {
    try JSONDecoder().decode(Self.self, from: data)
  }
  var data: Data { get throws { try JSONEncoder().encode(self) } }
}
extension JSONValue: Identifiable {
  var id: String { self["id"].string.isEmpty ? self["date"].string : self["id"].string }
}
func json(_ fields: [String: JSONValue]) -> JSONValue { .object(fields) }
func s(_ value: String) -> JSONValue { .string(value) }
func n(_ value: Double) -> JSONValue { .number(value) }
func optionalNumber(_ value: String) -> JSONValue {
  Double(value.replacingOccurrences(of: ",", with: ".")).map(JSONValue.number) ?? .null
}
func checkedNumber(_ value: String, name: String) throws -> JSONValue {
  let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !text.isEmpty else { return .null }
  guard let number = Double(text.replacingOccurrences(of: ",", with: ".")), number.isFinite,
    number >= 0
  else {
    throw ServiceError(message: "Enter a valid, non-negative number for \(name).")
  }
  return .number(number)
}
func enteredDuration(hours: String, minutes: String, seconds: String = "") throws -> Double {
  let h = try checkedNumber(hours, name: "hours").double ?? 0
  let m = try checkedNumber(minutes, name: "minutes").double ?? 0
  let s = try checkedNumber(seconds, name: "seconds").double ?? 0
  guard h.rounded() == h, m.rounded() == m, s.rounded() == s, s < 60 else {
    throw ServiceError(message: "Use whole hours, minutes and seconds, with seconds below 60.")
  }
  return h * 3600 + m * 60 + s
}
func dayString(_ date: Date = .now) -> String {
  let f = DateFormatter()
  f.locale = Locale(identifier: "en_US_POSIX")
  f.dateFormat = "yyyy-MM-dd"
  return f.string(from: date)
}
func duration(_ seconds: Int) -> String {
  if seconds == 0 { return "0 min" }
  return [
    seconds >= 3600 ? "\(seconds / 3600) h" : "",
    seconds % 3600 >= 60 ? "\((seconds % 3600) / 60) min" : "",
    seconds % 60 > 0 ? "\(seconds % 60) sec" : "",
  ].filter { !$0.isEmpty }.joined(separator: " ")
}
