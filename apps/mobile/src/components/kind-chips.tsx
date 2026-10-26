import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";
import { KIND_LIST, KINDS, type MomentKind } from "@/kinds";

type Props = {
  selected?: MomentKind;
  onChange: (kind: MomentKind | undefined) => void;
};

export function KindChips({ selected, onChange }: Props) {
  return (
    <View style={styles.row}>
      {KIND_LIST.map((kind) => {
        const isSelected = kind === selected;
        return (
          <Pressable
            key={kind}
            onPress={() => onChange(isSelected ? undefined : kind)}
            style={[styles.chip, isSelected && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityLabel={KINDS[kind].label}
            accessibilityState={{ selected: isSelected }}
          >
            <Ionicons
              name={KINDS[kind].icon}
              size={18}
              color={isSelected ? "#A5532F" : "#6B6158"}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  chip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E6DCCB",
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: "#EFE3D2", borderColor: "#A5532F" },
});
