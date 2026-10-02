import LiftAPI
import LiftTheme
import SwiftUI

/// The voices one provider offers, to pick the voice coach's voice from.
/// Picking one plays its sample in Coach's language, like choosing a
/// ringtone. Kept on this iPhone; the next call uses it.
struct VoicePicker: View {
  let provider: VoiceProvider
  let options: [Components.Schemas.VoiceOption]
  @AppStorage private var chosen: String
  @State private var samples = VoiceSamplePlayer()

  init(provider: VoiceProvider, options: [Components.Schemas.VoiceOption]) {
    self.provider = provider
    self.options = options.filter { $0.provider == provider.rawValue }
    _chosen = AppStorage(wrappedValue: "", provider.voiceKey)
  }

  var body: some View {
    List {
      Section {
        ForEach(options, id: \.id) { option in
          Button {
            chosen = option.id
            samples.play(option, language: CoachLanguage.current)
          } label: {
            HStack {
              VStack(alignment: .leading, spacing: 2) {
                Text(option.isDefault ? "\(option.name) (default)" : option.name)
                  .foregroundStyle(.primary)
                Text(option.detail).font(.footnote).foregroundStyle(.secondary)
              }
              Spacer()
              if samples.playing == option.id {
                Image(systemName: "speaker.wave.2.fill")
                  .foregroundStyle(Theme.accent)
                  .symbolEffect(.variableColor.iterative, isActive: true)
                  .accessibilityLabel("Playing sample")
              }
              if selected(option) {
                Image(systemName: "checkmark").fontWeight(.semibold).foregroundStyle(Theme.accent)
              }
            }
            .contentShape(.rect)
          }
          // Rows, not links: the accent colour is kept for the tick.
          .tint(.primary)
          .accessibilityAddTraits(selected(option) ? .isSelected : [])
          .accessibilityHint(option.samples == nil ? "" : "Plays a sample of this voice")
        }
      } footer: {
        Text("Tap a voice to hear it. Used from your next voice check-in; every voice speaks both English and Danish.")
      }
    }
    .themedList()
    .sensoryFeedback(.selection, trigger: chosen)
    .onDisappear { samples.stop() }
    .navigationTitle("\(provider.title) voice")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func selected(_ option: Components.Schemas.VoiceOption) -> Bool {
    options.contains { $0.id == chosen } ? option.id == chosen : option.isDefault
  }
}
