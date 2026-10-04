import LiftAPI
import LiftStore
import LiftTheme
import SwiftUI

struct AccountView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var confirmingSignOut = false
  @State private var confirmingDeletion = false
  @State private var deleting = false
  @State private var deletionError: String?
  @AppStorage(AIConsent.key) private var aiAllowed = false
  @AppStorage(Appearance.key) private var appearance: Appearance = .system
  @AppStorage(VoiceProvider.key) private var voiceProvider: VoiceProvider = .google
  @AppStorage(CoachLanguage.key) private var language: CoachLanguage = CoachLanguage.deviceDefault
  // Watched so the voice row updates after picking one.
  @AppStorage(VoiceProvider.google.voiceKey) private var googleVoice = ""
  @AppStorage(VoiceProvider.elevenlabs.voiceKey) private var elevenLabsVoice = ""
  /// Shown as the Profile tab rather than as a sheet: no Done button.
  var inTab = false

  var body: some View {
    NavigationStack {
      List {
        if let session = model.session {
          Section {
            AthleteCard(name: model.athleteName ?? session.name, email: session.email, today: model.today)
              .listRowInsets(EdgeInsets())
              .listRowBackground(Color.clear)
          }
        }
        if let today = model.today {
          GoalsSection(today: today)
        }
        Section {
          Picker("Appearance", selection: $appearance) {
            ForEach(Appearance.allCases) { Text($0.title).tag($0) }
          }
          .pickerStyle(.segmented)
          .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
          .sensoryFeedback(.selection, trigger: appearance)
        } header: {
          Text("Appearance")
        } footer: {
          Text("System follows your iPhone's light and dark setting.")
        }
        .themedRows()
        Section {
          Picker("Language", selection: $language) {
            ForEach(CoachLanguage.allCases) { Text($0.title).tag($0) }
          }
          .pickerStyle(.segmented)
          .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
          .sensoryFeedback(.selection, trigger: language)
        } header: {
          Text("Coach's language")
        } footer: {
          Text("Coach writes and speaks in this language, in chat and in voice check-ins.")
        }
        .themedRows()
        if model.voiceEnabled {
          Section {
            if model.voiceProviders.count > 1 {
              Picker("Provider", selection: $voiceProvider) {
                ForEach(model.voiceProviders) { Text($0.title).tag($0) }
              }
              .pickerStyle(.segmented)
              .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
              .sensoryFeedback(.selection, trigger: voiceProvider)
            }
            if model.voiceOptions.contains(where: { $0.provider == callProvider.rawValue }) {
              NavigationLink {
                VoicePicker(provider: callProvider, options: model.voiceOptions)
              } label: {
                LabeledContent("Voice", value: voiceName)
              }
            }
          } header: {
            Text("Voice check-in")
          } footer: {
            if model.voiceProviders.count > 1 { Text(callProvider.detail) }
          }
          .themedRows()
        }
        Section {
          NavigationLink {
            HealthView()
          } label: {
            LabeledContent {
              Text(model.health.connected ? "On" : "Off")
            } label: {
              Label {
                Text("Apple Health")
              } icon: {
                IconBadge(symbol: "heart.fill", tint: Theme.heart, size: 28)
              }
            }
          }
          NavigationLink {
            RemindersView()
          } label: {
            LabeledContent {
              Text(Reminders.shared.settings.anyOn ? "On" : "Off")
            } label: {
              Label {
                Text("Reminders")
              } icon: {
                IconBadge(symbol: "bell.fill", tint: Theme.attention, size: 28)
              }
            }
          }
          Link(destination: LiftServer.origin) {
            Label {
              Text("Open the website")
            } icon: {
              IconBadge(symbol: "safari.fill", tint: Theme.accent, size: 28)
            }
          }
          Link(destination: LiftServer.origin.appending(path: "privacy")) {
            Label {
              Text("Privacy policy")
            } icon: {
              IconBadge(symbol: "hand.raised.fill", tint: Theme.inkSecondary, size: 28)
            }
          }
        } footer: {
          Text("Routines, programmes, videos and backups are managed on the website for now.")
        }
        .themedRows()
        Section {
          Button("Sign out", role: .destructive) { confirmingSignOut = true }
        } footer: {
          Text("Signs out this iPhone only. Your journal stays on the server.")
        }
        .themedRows()
        Section {
          Toggle(isOn: $aiAllowed) {
            Label("Share with Coach's AI provider", systemImage: "checkmark.shield")
          }
          // Photos still uploading for Coach's waiting messages stop too.
          .onChange(of: aiAllowed) { _, allowed in
            if !allowed { model.coach.consentWithdrawn() }
          }
        } footer: {
          Text("Coach and voice check-ins send your messages, photos and relevant journal and Apple Health records to a third-party AI provider. Turn this off to stop sharing; Coach stays off until you allow it again.")
        }
        .themedRows()
        Section {
          Button(role: .destructive) {
            confirmingDeletion = true
          } label: {
            if deleting {
              ProgressView()
            } else {
              Text("Delete account")
            }
          }
          .disabled(deleting)
        } footer: {
          if let deletionError {
            Text(deletionError).foregroundStyle(Theme.danger)
          } else {
            Text("Permanently deletes your account and everything in your journal from Lift Journal's server. Data in Apple Health is not affected.")
          }
        }
        .themedRows()
        // The colophon: the wordmark and this build.
        Section {
        } footer: {
          VStack(spacing: 4) {
            Wordmark()
            Text(
              LiftServer.clientHeader.replacingOccurrences(of: "ios/", with: "")
                .replacingOccurrences(of: "/", with: " (") + ")")
          }
          .frame(maxWidth: .infinity)
          .padding(.top, 8)
          .accessibilityElement(children: .combine)
        }
      }
      .themedList()
      .tint(Theme.accent)
      .navigationTitle(inTab ? "Profile" : "Account")
      .navigationBarTitleDisplayMode(inTab ? .large : .inline)
      .toolbar {
        if !inTab {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done", role: .confirm) { dismiss() }
          }
        }
      }
      .confirmationDialog("Sign out of Lift Journal on this iPhone?", isPresented: $confirmingSignOut) {
        Button("Sign out", role: .destructive) {
          Task {
            await model.signOut()
            dismiss()
          }
        }
      } message: {
        if model.queued > 0 {
          Text("\(model.queued) unsent changes on this iPhone will be lost.")
        }
      }
      .alert("Delete your account?", isPresented: $confirmingDeletion) {
        Button("Delete account", role: .destructive) {
          Task {
            deleting = true
            deletionError = await model.deleteAccount()
            deleting = false
            if deletionError == nil { dismiss() }
          }
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("This permanently deletes your journal, workouts, meals, photos, videos, Coach conversations and Apple Health imports. It can't be undone. To keep a copy, download a backup from Settings on the website first.")
      }
    }
  }
}

/// Who the athlete is, and where they stand this week.
extension AccountView {
  /// The provider the next call uses: the one picked, if offered.
  fileprivate var callProvider: VoiceProvider {
    model.voiceProviders.contains(voiceProvider) ? voiceProvider : model.voiceProviders.first ?? .google
  }

  fileprivate var voiceName: String {
    // Read so a new pick shows when coming back from the list.
    _ = (googleVoice, elevenLabsVoice)
    return callProvider.voiceName(in: model.voiceOptions) ?? "Default"
  }
}

private struct AthleteCard: View {
  let name: String
  let email: String
  let today: Today?

  var body: some View {
    VStack(spacing: 14) {
      Avatar(name: name, size: 76)
        .padding(4)
        .overlay(Circle().strokeBorder(Theme.accent.opacity(0.35), lineWidth: 2))
      VStack(spacing: 2) {
        Text(name).folio(.sectionTitle).foregroundStyle(Theme.ink)
        Text(email).font(.subheadline).foregroundStyle(Theme.inkSecondary)
      }
      if let today {
        HStack(spacing: 0) {
          stat(today.body?.bodyweight.map { Format.decimal($0) }, "kg", "Weight")
          Divider().frame(height: 32)
          stat(today.body?.bodyFatPercent.map { Format.decimal($0) }, "%", "Body fat")
          Divider().frame(height: 32)
          stat("\(today.sessionsThisWeek)", nil, "Sessions this week")
        }
        .padding(.top, 4)
      }
    }
    .frame(maxWidth: .infinity)
    .card(padding: 20)
  }

  private func stat(_ value: String?, _ unit: String?, _ label: String) -> some View {
    VStack(spacing: 2) {
      if let value {
        Measure(value: value, unit: unit, role: .inline).foregroundStyle(Theme.ink)
      } else {
        Text("Not yet").folio(.note).foregroundStyle(Theme.inkSecondary)
      }
      Text(label).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(1).minimumScaleFactor(0.8)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
  }
}

/// The targets Coach and the athlete have agreed on.
private struct GoalsSection: View {
  let today: Today

  var body: some View {
    let body = today.body
    Section {
      if let focus = Format.focus(body?.focus) {
        row("Focus", focus, "target", Theme.accent)
      }
      if let kg = body?.targetWeightKg {
        row("Weight", "\(Format.decimal(kg)) kg", "scalemass.fill", Category.body.tint)
      }
      if let percent = body?.targetBodyFatPercent {
        row("Body fat", "\(Format.decimal(percent)) %", "percent", Category.body.tint)
      }
      if let kcal = Format.target(today.nutrition.targetCalories) {
        row("Energy", "\(Format.number(kcal)) kcal a day", "flame.fill", Theme.calories)
      }
      if let grams = Format.target(today.nutrition.targetProtein) {
        row("Protein", "\(Format.number(grams)) g a day", "fork.knife", Theme.protein)
      }
      let (litres, unit) = Format.litres(today.hydration.targetMl)
      row(
        "Water", "\(litres) \(unit) a day\(today.hydration.estimatedTarget ? ", estimated" : "")",
        "drop.fill", Category.water.tint)
    } header: {
      Text("Goals")
    } footer: {
      // The plan's own notes come first: why it holds weight or loses more
      // slowly, and who to talk to. The server sends them only beside the
      // plan's own targets, and otherwise a line saying the targets differ.
      VStack(alignment: .leading, spacing: 6) {
        ForEach(body?.goalNotes ?? [], id: \.self) { Text($0) }
        Text("Set with Coach. Ask Coach to change any of them.")
      }
    }
    .themedRows()
  }

  private func row(_ title: String, _ value: String, _ symbol: String, _ tint: Color) -> some View {
    LabeledContent {
      // A column of targets: tabular figures, so they line up.
      Text(value).monospacedDigit()
    } label: {
      Label {
        Text(title)
      } icon: {
        IconBadge(symbol: symbol, tint: tint, size: 28)
      }
    }
  }

}
