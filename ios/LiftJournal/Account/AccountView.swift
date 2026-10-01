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
  @AppStorage(VoiceChoice.languageKey) private var voiceLanguage = VoiceChoice.defaultLanguage
  @AppStorage(VoiceChoice.voiceKey(.google)) private var googleVoice = ""
  @AppStorage(VoiceChoice.voiceKey(.elevenlabs)) private var elevenLabsVoice = ""
  /// Shown as the Profile tab rather than as a sheet: no Done button.
  var inTab = false

  /// The provider calls use: the choice if this server offers it.
  private var activeProvider: VoiceProvider {
    model.voiceProviders.contains(voiceProvider) ? voiceProvider : model.voiceProviders.first ?? .google
  }

  /// The chosen voice for the provider in use; nothing chosen, or a voice the
  /// server no longer offers, shows the server's default.
  private func voiceSelection(_ voices: [VoiceOption]) -> Binding<String> {
    let provider = activeProvider
    return Binding {
      let stored = provider == .google ? googleVoice : elevenLabsVoice
      if voices.contains(where: { $0.id == stored }) { return stored }
      return model.voiceDefaults[provider] ?? voices.first?.id ?? ""
    } set: { id in
      if provider == .google { googleVoice = id } else { elevenLabsVoice = id }
    }
  }

  private var voiceFooter: String {
    var text = activeProvider.detail
    if voiceLanguage == "da" && activeProvider == .elevenlabs {
      text += " Its voices speak Danish with an accent unless a native Danish voice is listed."
    }
    return text
  }

  var body: some View {
    NavigationStack {
      List {
        if let session = model.session {
          Section {
            AthleteCard(name: session.name, email: session.email, today: model.today)
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
        if !model.voiceProviders.isEmpty {
          Section {
            if model.voiceProviders.count > 1 {
              Picker("Provider", selection: $voiceProvider) {
                ForEach(model.voiceProviders) { Text($0.title).tag($0) }
              }
              .pickerStyle(.segmented)
              .listRowInsets(EdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12))
              .sensoryFeedback(.selection, trigger: voiceProvider)
            }
            if !model.voiceLanguages.isEmpty {
              Picker("Language", selection: $voiceLanguage) {
                ForEach(model.voiceLanguages) { Text($0.name).tag($0.id) }
              }
              .sensoryFeedback(.selection, trigger: voiceLanguage)
            }
            if let voices = model.voiceOptions[activeProvider], !voices.isEmpty {
              Picker("Voice", selection: voiceSelection(voices)) {
                ForEach(voices) { voice in
                  VStack(alignment: .leading, spacing: 2) {
                    Text(voice.name)
                    if !voice.detail.isEmpty {
                      Text(voice.detail).font(.footnote).foregroundStyle(.secondary)
                    }
                  }
                  .tag(voice.id)
                }
              }
              .pickerStyle(.navigationLink)
            }
          } header: {
            Text("Voice check-in")
          } footer: {
            Text(voiceFooter)
          }
          .task { await model.loadVoiceOptions() }
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
              Text("Open the Website")
            } icon: {
              IconBadge(symbol: "safari.fill", tint: Theme.accent, size: 28)
            }
          }
          Link(destination: LiftServer.origin.appending(path: "privacy")) {
            Label {
              Text("Privacy Policy")
            } icon: {
              IconBadge(symbol: "hand.raised.fill", tint: .secondary, size: 28)
            }
          }
        } footer: {
          Text("Routines, programmes, videos and backups are managed on the website for now.")
        }
        Section {
          Button("Sign out", role: .destructive) { confirmingSignOut = true }
        } footer: {
          Text("Signs out this iPhone only. Your journal stays on the server.")
        }
        Section {
          Toggle(isOn: $aiAllowed) {
            Label("Share with Coach's AI provider", systemImage: "sparkles")
          }
        } footer: {
          Text("Coach and voice check-ins send your messages, photos and relevant journal and Apple Health records to a third-party AI provider. Turn this off to stop sharing; Coach stays off until you allow it again.")
        }
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
            Text(deletionError).foregroundStyle(.red)
          } else {
            Text("Permanently deletes your account and everything in your journal from Lift Journal's server. Data in Apple Health is not affected.")
          }
        }
        Section {
        } footer: {
          Text("Lift Journal \(LiftServer.clientHeader.replacingOccurrences(of: "ios/", with: "").replacingOccurrences(of: "/", with: " (")))")
            .frame(maxWidth: .infinity)
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
        Text(name).font(.title2.weight(.bold))
        Text(email).font(.subheadline).foregroundStyle(.secondary)
      }
      if let today {
        HStack(spacing: 0) {
          stat(today.body?.bodyweight.map { $0.formatted() }, "kg", "Weight")
          Divider().frame(height: 32)
          stat(today.body?.bodyFatPercent.map { $0.formatted() }, "%", "Body fat")
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
      HStack(alignment: .firstTextBaseline, spacing: 2) {
        Text(value ?? "–").font(.system(.title3, design: .rounded, weight: .bold)).monospacedDigit()
        if let unit, value != nil {
          Text(unit).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
        }
      }
      Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
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
        row("Weight", "\(kg.formatted()) kg", "scalemass.fill", Category.body.tint)
      }
      if let percent = body?.targetBodyFatPercent {
        row("Body fat", "\(percent.formatted()) %", "percent", Category.body.tint)
      }
      if let kcal = today.nutrition.targetCalories {
        row("Energy", "\(Format.number(kcal)) kcal a day", "flame.fill", Theme.calories)
      }
      if let grams = today.nutrition.targetProtein {
        row("Protein", "\(Format.number(grams)) g a day", "fork.knife", Theme.protein)
      }
      let (litres, unit) = Format.litres(today.hydration.targetMl)
      row(
        "Water", "\(litres) \(unit) a day\(today.hydration.estimatedTarget ? ", estimated" : "")",
        "drop.fill", Category.water.tint)
    } header: {
      Text("Goals")
    } footer: {
      Text("Set with Coach. Ask Coach to change any of them.")
    }
  }

  private func row(_ title: String, _ value: String, _ symbol: String, _ tint: Color) -> some View {
    LabeledContent {
      Text(value)
    } label: {
      Label {
        Text(title)
      } icon: {
        IconBadge(symbol: symbol, tint: tint, size: 28)
      }
    }
  }

}
