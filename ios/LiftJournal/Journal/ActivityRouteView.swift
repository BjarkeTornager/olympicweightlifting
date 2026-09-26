import LiftAPI
import SwiftUI

/// The route Apple Health recorded for a walk, run or ride, on a full map.
struct ActivityRouteView: View {
  @Environment(AppModel.self) private var model
  let id: String
  let title: String
  @State private var route: Components.Schemas.CoachVisual?
  @State private var error: String?

  var body: some View {
    Group {
      if let route {
        // The summary sits under the map rather than over it, so the whole
        // route stays in view.
        VStack(spacing: 0) {
          RouteMap(visual: route, height: nil)
          VStack(alignment: .leading, spacing: 6) {
            if let caption = route.caption { Text(caption).font(.subheadline) }
            RouteFacts(visual: route)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding()
        }
      } else if let error {
        ContentUnavailableView("No route", systemImage: "map", description: Text(error))
      } else {
        ProgressView()
      }
    }
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
    .task(id: id) { await load() }
  }

  private func load() async {
    do {
      route = try await model.client.getActivityRoute(path: .init(id: id)).value()
    } catch {
      self.error = error.localizedDescription
    }
  }
}
