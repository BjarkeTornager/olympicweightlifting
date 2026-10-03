import HealthKit
import HealthKitUI
import LiftStore
import LiftTheme
import SwiftUI

/// Connect Apple Health and see what the last sync brought in.
struct HealthView: View {
  @Environment(AppModel.self) private var model
  @State private var trigger = false
  @State private var requestError: String?
  @State private var needsAccess = false
  @ScaledMetric(relativeTo: .largeTitle) private var symbolSize: CGFloat = 40

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 10) {
          Image(systemName: "heart.text.square.fill")
            .font(.system(size: symbolSize))
            .foregroundStyle(Theme.heart)
          Text("Apple Health").folio(.sectionTitle).foregroundStyle(Theme.ink)
          Text(
            "Lift Journal reads your sleep, heart rate and workouts so they appear in your journal without typing them. Nothing is written back to Apple Health."
          )
          .foregroundStyle(Theme.inkSecondary)
        }
        .padding(.vertical, 6)
      }
      Section("Read from Apple Health") {
        read("Sleep, including stages", "bed.double.fill", Theme.sleep)
        read("Resting heart rate, heart rate variability and average heart rate", "heart.fill", Theme.heart)
        read("Steps and active energy", "flame.fill", Theme.activity)
        read("Body fat percentage from a smart scale", "scalemass.fill", Theme.body)
        read(
          "Workouts: runs, walks, rides, swims, rows, hikes and more, with distance and heart rate", "figure.run",
          Theme.activity)
        read("Routes of outdoor workouts, simplified, with place names from Apple Maps", "map.fill", Theme.activity)
      }
      if !model.health.available {
        Section {
          Text("Apple Health isn't available on this device.").foregroundStyle(Theme.inkSecondary)
        }
      } else if model.health.connected {
        if needsAccess {
          Section {
            Button {
              trigger.toggle()
            } label: {
              Label("Allow new Apple Health data", systemImage: "heart.text.square.fill")
            }
            if let requestError {
              Text(requestError).foregroundStyle(Theme.danger).font(.subheadline)
            }
          } footer: {
            Text(
              "Lift Journal can now read your workout routes and a smart scale's body fat readings, so you and Coach can use them. Apple asks once for the new permissions."
            )
          }
        }
        Section {
          LabeledContent("Status") {
            if model.health.syncing {
              ProgressView()
            } else {
              Label("Connected", systemImage: "checkmark").foregroundStyle(Theme.success)
            }
          }
          if let last = model.health.lastSync {
            LabeledContent("Last sync", value: last.formatted(.relative(presentation: .named)))
          }
          if let result = model.health.lastResult {
            LabeledContent("Result", value: result)
          }
          if let error = model.health.error {
            Text(error).foregroundStyle(Theme.danger).font(.subheadline)
          }
          Button("Sync now") { Task { await model.syncHealth(force: true) } }
            .disabled(model.health.syncing)
        } footer: {
          Text(
            "New sleep and workouts arrive in the background. Entries you edit or delete in the journal stay as you left them. To change what the app can read, open Settings › Health › Data Access & Devices › Lift Journal."
          )
        }
        Section {
          Button("Stop syncing on this iPhone", role: .destructive) {
            Task { await model.disconnectHealth() }
          }
        } footer: {
          Text("Entries already imported stay in your journal.")
        }
      } else {
        Section {
          Button {
            trigger.toggle()
          } label: {
            Label("Connect Apple Health", systemImage: "heart.fill")
          }
          .buttonStyle(PrimaryButtonStyle())
          .listRowBackground(Color.clear)
          if let requestError {
            Text(requestError).foregroundStyle(Theme.danger).font(.subheadline)
          }
        } footer: {
          Text(
            "Apple asks which data to share. You can turn on only what you want. Imported data is stored with your journal on the Lift Journal server and used by your Coach."
          )
        }
      }
    }
    .themedList()
    .navigationTitle("Apple Health")
    .navigationBarTitleDisplayMode(.inline)
    .task { needsAccess = await HealthSync.shared.needsAccess() }
    .healthDataAccessRequest(
      store: HealthSync.shared.store,
      readTypes: HealthSync.readTypes,
      trigger: trigger
    ) { result in
      switch result {
      case .success:
        needsAccess = false
        Task { await model.healthConnected() }
      case .failure(let error):
        requestError = error.localizedDescription
      }
    }
  }

  /// One kind of data read, with its symbol in the colour of its area.
  private func read(_ title: String, _ symbol: String, _ tint: Color) -> some View {
    Label {
      Text(title)
    } icon: {
      Image(systemName: symbol).foregroundStyle(tint)
    }
  }
}
