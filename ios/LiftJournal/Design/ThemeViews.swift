import LiftTheme
import SwiftUI

/// A small square of a data colour that names what a value is, in place of
/// a symbol. Fat is hatched, so it reads apart from carbs without colour.
struct Key: View {
  let tint: Color
  var hatched = false
  @ScaledMetric(relativeTo: .caption) private var side: CGFloat = 9

  var body: some View {
    Group {
      if hatched {
        Hatch(tint: tint, spacing: 3.2, lineWidth: 1.4)
      } else {
        RoundedRectangle(cornerRadius: Theme.Radius.key).fill(tint)
      }
    }
    .frame(width: side, height: side)
    .accessibilityHidden(true)
  }
}

/// 45° lines of one colour inside a hairline edge: fat beside solid carbs.
struct Hatch: View {
  let tint: Color
  var spacing: CGFloat = 4
  var lineWidth: CGFloat = 1.6

  var body: some View {
    Canvas { context, size in
      let shape = Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: Theme.Radius.key)
      context.clip(to: shape)
      var lines = Path()
      var x = -size.height
      while x < size.width {
        lines.move(to: CGPoint(x: x, y: size.height))
        lines.addLine(to: CGPoint(x: x + size.height, y: 0))
        x += spacing
      }
      context.stroke(lines, with: .color(tint), lineWidth: lineWidth)
      context.stroke(shape, with: .color(tint), lineWidth: 2.4)
    }
    .accessibilityHidden(true)
  }
}

/// What a column or a cell holds, with the key of its data colour: "Sleep",
/// "Body fat", "Energy", in sentence case. Up to two lines, or three at the
/// largest text sizes, with the last two words together, so a long name
/// ("Gennemsnitlig hvilepuls") wraps rather than being cut short.
struct CardLabel: View {
  let title: String
  var key: Color?
  var hatched = false
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    // The key sits on the first line's baseline, as tall as its capitals.
    HStack(alignment: .firstTextBaseline, spacing: 7) {
      if let key {
        Key(tint: key, hatched: hatched)
      }
      Text(LineBreaks.title(title, size: typeSize))
        .label()
        .lineLimit(typeSize >= .xxxLarge ? 3 : 2)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// The arrow on everything that opens something, since rows and cells have
/// no card around them to say so.
struct GoArrow: View {
  var tint: Color = Theme.inkSecondary

  var body: some View {
    Image(systemName: "arrow.right")
      .font(.subheadline.weight(.medium))
      .foregroundStyle(tint)
      .accessibilityHidden(true)
  }
}

extension View {
  /// Lists and forms on the app's paper instead of the system grey.
  func themedList() -> some View {
    scrollContentBackground(.hidden).background(Theme.background)
  }

  /// A themed list's rows on the sheet colour instead of the system's
  /// white, so the paper has one white. Set on each Section; a row that
  /// sets its own background keeps it.
  func themedRows() -> some View {
    listRowBackground(Theme.surface)
  }

  /// Shows a saved change as a margin note under the navigation bar for
  /// 1.6 s, and reads it to VoiceOver. Setting `note` shows it, a new one
  /// in its place; it clears itself.
  func toast(_ note: Binding<AppModel.Confirmation?>) -> some View {
    modifier(ToastPresenter(note: note))
  }
}

/// A saved change, as a margin note: a glass capsule with the key of what
/// changed and the confirmation in serif italic ("Added 250 ml").
struct Toast: View {
  let text: String
  var tint: Color = Theme.accent

  var body: some View {
    HStack(spacing: 8) {
      Key(tint: tint)
      Text(text).folio(.note).foregroundStyle(Theme.ink).lineLimit(2)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .glassEffect(.regular, in: .capsule)
  }
}

private struct ToastPresenter: ViewModifier {
  @Binding var note: AppModel.Confirmation?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    content
      .overlay(alignment: .top) {
        if let note {
          Toast(text: note.text, tint: note.category?.tint ?? Theme.accent)
            .id(note.id)
            .padding(.top, 8)
            .padding(.horizontal, Theme.Space.gutter)
            .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            .accessibilityHidden(true)
        }
      }
      .animation(Theme.Motion.spring(reduceMotion: reduceMotion), value: note)
      .task(id: note?.id) {
        guard let note else { return }
        AccessibilityNotification.Announcement(note.text).post()
        try? await Task.sleep(for: .seconds(1.6))
        if !Task.isCancelled { self.note = nil }
      }
  }
}

#Preview("Labels") {
  VStack(alignment: .leading, spacing: 16) {
    CardLabel(title: "Energy", key: Theme.calories)
    CardLabel(title: "Fat", key: Theme.carbs, hatched: true)
    CardLabel(title: "Body fat")
    HStack {
      CardLabel(title: "Sleep", key: Theme.sleep)
      Spacer()
      GoArrow()
    }
    Toast(text: "Added 250 ml", tint: Theme.water)
  }
  .padding(20)
  .background(Theme.background)
}
