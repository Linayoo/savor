import { ReactNode, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import {
  type AuthAction,
  authErrorMessage,
  type AuthField,
} from "@/auth/errors";
import { fonts } from "@/theme";

export type FieldErrors = Partial<Record<AuthField, string>>;

// Runs one request at a time. The ref turns a second tap away at once; the
// busy state, which disables the buttons, only shows after the next render.
export function useSingleFlight() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return { busy, run };
}

// Runs a form's submit: checks the fields first, then shows a failure next
// to the field it concerns, in plain words (spec 005)
export function useAuthForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const { busy, run } = useSingleFlight();

  const submit = (
    action: AuthAction,
    problems: Partial<Record<AuthField, string | null>>,
    task: () => Promise<void>,
  ) =>
    run(async () => {
      const found = Object.fromEntries(
        Object.entries(problems).filter(([, message]) => message),
      ) as FieldErrors;
      setErrors(found);
      if (Object.keys(found).length > 0) return;

      try {
        await task();
      } catch (error) {
        const { field, message } = authErrorMessage(error, action);
        setErrors({ [field]: message });
      }
    });

  return { errors, busy, submit };
}

export function FormScreen({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{title}</Text>
      {intro ? <Text style={styles.intro}>{intro}</Text> : null}
      {children}
    </ScrollView>
  );
}

// The hint shows before typing; the error replaces nothing and sits under
// the field
export function Field({
  name,
  label,
  hint,
  error,
  ...input
}: TextInputProps & {
  name: AuthField;
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <View style={styles.field} testID={`field-${name}`}>
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#7A6F64"
        style={[styles.input, error ? styles.inputError : null]}
        {...input}
      />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Text style={[styles.error, styles.formError]} accessibilityRole="alert">
      {message}
    </Text>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <Text style={styles.notice}>{children}</Text>;
}

export function PrimaryButton({
  label,
  onPress,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      style={[styles.button, busy ? styles.buttonBusy : null]}
    >
      {busy ? (
        <ActivityIndicator color="#FFFCF6" />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function TextLink({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.link, disabled ? styles.linkDisabled : null]}
    >
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F1E8" },
  content: { padding: 24, paddingBottom: 48 },
  title: {
    fontFamily: fonts.title,
    fontSize: 28,
    color: "#2B2622",
    marginBottom: 8,
  },
  intro: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    lineHeight: 23,
    color: "#6B6158",
    marginBottom: 24,
  },
  field: { marginBottom: 18 },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: "#2B2622",
    marginBottom: 4,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: "#6B6158",
    marginBottom: 6,
  },
  input: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: "#2B2622",
    backgroundColor: "#FFFCF6",
    borderColor: "#E6DCCB",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputError: { borderColor: "#B4472A" },
  error: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: "#B4472A",
    marginTop: 6,
  },
  formError: { marginTop: 0, marginBottom: 16 },
  notice: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: "#6B6158",
    marginBottom: 16,
  },
  button: {
    backgroundColor: "#A5532F",
    borderRadius: 22,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 6,
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { fontFamily: fonts.bodyMedium, color: "#FFFCF6", fontSize: 15 },
  link: { alignSelf: "center", paddingVertical: 14, paddingHorizontal: 8 },
  linkDisabled: { opacity: 0.5 },
  linkText: { fontFamily: fonts.bodyMedium, fontSize: 15, color: "#A5532F" },
});
