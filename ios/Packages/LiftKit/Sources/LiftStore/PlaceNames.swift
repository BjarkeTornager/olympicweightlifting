import CoreLocation
import MapKit

/// Names a point on a route with Apple Maps, on the phone: a street or place
/// and its town, such as "Vesterbrogade, Copenhagen". House numbers are left
/// out, so a walk from home is not named down to the door.
@MainActor
public final class PlaceNames {
  public static let shared = PlaceNames()

  public enum Lookup: Sendable, Equatable {
    case named(String)
    /// Apple Maps has no name for this point.
    case unnamed
    /// The lookup failed (offline, or too many at once): try again later.
    case failed
  }

  // Walks from home start at the same place: one lookup per ~100 m square.
  private var cache: [String: String?] = [:]

  public func name(lat: Double, lng: Double) async -> Lookup {
    let key = "\((lat * 1000).rounded()),\((lng * 1000).rounded())"
    if let cached = cache[key] { return cached.map(Lookup.named) ?? .unnamed }
    guard
      let request = MKReverseGeocodingRequest(location: CLLocation(latitude: lat, longitude: lng))
    else { return .unnamed }
    do {
      let label = try await request.mapItems.first.flatMap(Self.label)
      cache[key] = .some(label)
      return label.map(Lookup.named) ?? .unnamed
    } catch {
      return .failed
    }
  }

  nonisolated static func label(_ item: MKMapItem) -> String? {
    label(name: item.name, city: item.addressRepresentations?.cityName)
  }

  nonisolated static func label(name: String?, city: String?) -> String? {
    let street = (name ?? "")
      .split(separator: " ")
      .filter { !$0.contains(where: \.isNumber) }
      .joined(separator: " ")
      .trimmingCharacters(in: .whitespaces.union(.punctuationCharacters))
    var parts: [String] = []
    if !street.isEmpty { parts.append(street) }
    if let city, !city.isEmpty, !street.localizedCaseInsensitiveContains(city) {
      parts.append(city)
    }
    return parts.isEmpty ? nil : String(parts.joined(separator: ", ").prefix(120))
  }
}
