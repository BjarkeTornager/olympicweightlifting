import SwiftUI

let foodGroupLabels: [(String, String)] = [
  ("meat", "Meat & poultry"), ("seafood", "Fish & seafood"), ("eggs", "Eggs"),
  ("dairy", "Dairy & alternatives"), ("grains", "Grains & potatoes"),
  ("vegetables", "Vegetables"), ("fruit", "Fruit"), ("legumes", "Beans & lentils"),
  ("nuts_seeds", "Nuts & seeds"), ("fats_oils", "Fats & oils"),
  ("sweets", "Sweets"), ("drinks", "Drinks"), ("other", "Other"),
]
let ingredientEvidenceLabels = [
  "reported": "Reported", "label": "From label", "visible": "Visible in photo",
  "estimated": "Assumed ingredient",
]
func normalizedFoodTag(_ value: String) -> String {
  value.lowercased().split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
}
func foodSearchText(_ value: JSONValue) -> String {
  ([value["name"].string, value["type"].string]
    + value["items"].array.flatMap { item in
      [item["name"].string] + item["classification"]["ingredients"].array.map { $0["name"].string }
    }).joined(separator: " ")
}
struct FoodTagLabels: View {
  let value: JSONValue
  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      let groups = value["foodGroups"].array.map { tag in
        foodGroupLabels.first { $0.0 == tag.string }?.1 ?? tag.string
      }
      if !groups.isEmpty {
        Text(groups.joined(separator: " · ")).font(.caption).foregroundStyle(Color.liftTeal)
      }
      ForEach(value["ingredients"].array, id: \.self) { ingredient in
        Text(
          ingredient["name"].string
            + (ingredient["evidence"].string == "reported"
              ? ""
              : " · " + (ingredientEvidenceLabels[ingredient["evidence"].string] ?? "Unspecified"))
        )
        .font(.caption).foregroundStyle(.secondary)
      }
      if value["ingredients"].array.isEmpty {
        Text("Ingredients not tagged").font(.caption).foregroundStyle(.secondary)
      }
    }
  }
}
struct NativeFoodTagEditor: View {
  @Binding var value: JSONValue
  @State private var text: String
  init(value: Binding<JSONValue>) {
    _value = value
    _text = State(
      initialValue: value.wrappedValue["ingredients"].array.map { $0["name"].string }.joined(
        separator: ", "))
  }
  var body: some View {
    DisclosureGroup("Food groups & ingredients") {
      TextField("Ingredient tags, comma separated", text: $text, axis: .vertical)
        .accessibilityLabel("Ingredient tags")
        .accessibilityIdentifier("food-ingredient-tags")
        .textInputAutocapitalization(.never)
        .onChange(of: text) { _, new in
          var names: [String] = []
          for name in new.components(separatedBy: ",").map(normalizedFoodTag)
          where !name.isEmpty && !names.contains(name) { names.append(name) }
          let old = value["ingredients"].array
          value = value.setting(
            ["ingredients"],
            to: .array(
              names.map { name in
                old.first { normalizedFoodTag($0["name"].string) == name }
                  ?? json(["name": s(name), "evidence": s("reported")])
              }))
        }
      Text("Tag ingredients you know, separated by commas. New tags are reported by you.").font(
        .caption
      ).foregroundStyle(.secondary)
      ForEach(Array(value["ingredients"].array.enumerated()), id: \.offset) { index, ingredient in
        if ingredient["evidence"].string != "reported" {
          Picker(
            ingredient["name"].string,
            selection: Binding(
              get: { ingredient["evidence"].string },
              set: { evidence in
                var ingredients = value["ingredients"].array
                ingredients[index] = ingredient.setting(["evidence"], to: s(evidence))
                value = value.setting(["ingredients"], to: .array(ingredients))
              })
          ) {
            ForEach(["reported", "label", "visible", "estimated"], id: \.self) {
              Text(ingredientEvidenceLabels[$0] ?? $0).tag($0)
            }
          }
        }
      }
      DisclosureGroup("Choose food groups") {
        ForEach(foodGroupLabels, id: \.0) { key, label in
          Toggle(
            label,
            isOn: Binding(
              get: { value["foodGroups"].array.contains(s(key)) },
              set: { selected in
                let remaining = value["foodGroups"].array.filter { $0.string != key }
                value = value.setting(
                  ["foodGroups"], to: .array(remaining + (selected ? [s(key)] : [])))
              }))
        }
      }
    }
  }
}
struct FoodClassificationForm: View {
  @Environment(JournalStore.self) private var store
  let meal: JSONValue
  @State private var items: [JSONValue]
  @State private var type: String
  init(meal: JSONValue) {
    self.meal = meal
    _items = State(initialValue: meal["items"].array)
    _type = State(initialValue: meal["type"].string)
  }
  var body: some View {
    Form {
      Section {
        Picker("Meal", selection: $type) {
          ForEach(["breakfast", "lunch", "dinner", "snack"], id: \.self) {
            Text($0.capitalized).tag($0)
          }
        }
      }
      ForEach(Array(items.enumerated()), id: \.offset) { index, item in
        Section(item["name"].string) {
          NativeFoodTagEditor(
            value: Binding(
              get: {
                items[index]["classification"].isNull
                  ? json(["foodGroups": .array([]), "ingredients": .array([])])
                  : items[index]["classification"]
              }, set: { items[index] = items[index].setting(["classification"], to: $0) }))
        }
      }
    }.modifier(
      FormSave(title: "Edit food tags") {
        guard case .object(let fields) = meal else {
          throw ServiceError(message: "Meal unavailable.")
        }
        let input = fields.filter { !["id", "createdAt"].contains($0.key) }
        let updated = JSONValue.object(input).setting(["items"], to: .array(items)).setting(
          ["type"], to: s(type))
        try await store.saveAction(
          json(["kind": s("update_meal"), "mealId": s(meal.id), "meal": updated]))
      })
  }
}
