#if DEBUG
  import Foundation
  import LiftAPI

  /// Synthetic data for SwiftUI previews. The JSON is written by the server
  /// (`npm run openapi`) and, as a development asset, never ships in an archive.
  enum PreviewData {
    static var today: Today? {
      guard let url = Bundle.main.url(forResource: "preview-today", withExtension: "json"),
        let data = try? Data(contentsOf: url)
      else { return nil }
      return try? JSONDecoder().decode(Today.self, from: data)
    }
  }
#endif
