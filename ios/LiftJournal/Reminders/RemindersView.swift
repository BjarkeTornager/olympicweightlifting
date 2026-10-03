import LiftTheme
import SwiftUI
import UserNotifications

/// Choose the reminders and their times. Each one is skipped on a day it
/// isn't needed.
struct RemindersView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.openURL) private var openURL
  @State private var settings = Reminders.shared.settings
  @State private var status: UNAuthorizationStatus?

  var body: some View {
    Form {
      if status == .denied && settings.anyOn {
        Section {
          Label("Notifications are off for Lift Journal", systemImage: "bell.slash.fill")
            .foregroundStyle(Theme.attention)
          Button("Open Settings") {
            if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
          }
        } footer: {
          Text("Allow notifications in Settings to get these reminders.")
        }
        .themedRows()
      }
      Section {
        Toggle(isOn: $settings.checkIn.on) {
          row("Morning check-in", "sun.max.fill", Theme.feltEnergy)
        }
        if settings.checkIn.on {
          DatePicker("Time", selection: time($settings.checkIn), displayedComponents: .hourAndMinute)
        }
      } footer: {
        Text("Asks how you slept and how you feel. Skipped once you've checked in.")
      }
      .themedRows()
      Section {
        Toggle(isOn: $settings.water) {
          row("Water", "drop.fill", Category.water.tint)
        }
      } footer: {
        Text("At 11, 14 and 17, only when you're behind your daily target. Log 250 ml straight from the notification.")
      }
      .themedRows()
      Section {
        Toggle(isOn: $settings.catchUp.on) {
          row("Evening catch-up", "moon.stars.fill", Category.sleep.tint)
        }
        if settings.catchUp.on {
          DatePicker("Time", selection: time($settings.catchUp), displayedComponents: .hourAndMinute)
        }
      } footer: {
        Text("Only when meals, last night's sleep or a started workout are missing, and says which.")
      }
      .themedRows()
      Section {
        Toggle(isOn: $settings.windDown.on) {
          row("Wind down", "bed.double.fill", Theme.sleep)
        }
        if settings.windDown.on {
          DatePicker("Time", selection: time($settings.windDown), displayedComponents: .hourAndMinute)
        }
      } footer: {
        Text("A nudge towards bed, for a full night's sleep.")
      }
      .themedRows()
    }
    .themedList()
    .tint(Theme.accent)
    .navigationTitle("Reminders")
    .task { status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus }
    .onChange(of: settings) { _, new in
      Task { status = await Reminders.shared.change(new, today: model.today) }
    }
  }

  private func row(_ title: String, _ symbol: String, _ tint: Color) -> some View {
    Label {
      Text(title)
    } icon: {
      IconBadge(symbol: symbol, tint: tint, size: 28)
    }
  }

  private func time(_ slot: Binding<ReminderSettings.Time>) -> Binding<Date> {
    Binding {
      Calendar.current.date(bySettingHour: slot.wrappedValue.hour, minute: slot.wrappedValue.minute, second: 0, of: .now)
        ?? .now
    } set: { date in
      let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
      slot.wrappedValue.hour = parts.hour ?? 0
      slot.wrappedValue.minute = parts.minute ?? 0
    }
  }
}
