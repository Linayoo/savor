import { router, Stack, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { useAccount } from "@/account";
import {
  Field,
  FormError,
  FormScreen,
  Notice,
  PrimaryButton,
} from "@/components/account-form";

// Deleting the account (spec 010). It can't be undone, so it takes a typed
// word, and while it runs the screen can't be left.

const WORD = "delete";

export default function DeleteAccount() {
  const { deleteAccount } = useAccount();
  const navigation = useNavigation();
  const [word, setWord] = useState("");
  const [state, setState] = useState<"ready" | "deleting" | "failed">("ready");
  const deleting = state === "deleting";

  // The Account screens are a modal; its swipe down would leave too
  useEffect(() => {
    navigation.getParent()?.setOptions({ gestureEnabled: !deleting });
  }, [navigation, deleting]);

  const deleteNow = async () => {
    setState("deleting");
    try {
      await deleteAccount();
      router.dismissAll();
    } catch {
      setState("failed");
    }
  };

  return (
    <FormScreen
      title="Delete your account"
      intro="This deletes your sign-in, all your moments and photos, your letters and settings, on every device, permanently. Moments and letters can't be recovered."
    >
      <Stack.Screen
        options={{ gestureEnabled: !deleting, headerBackVisible: !deleting }}
      />
      <FormError
        message={
          state === "failed"
            ? "Couldn't delete your account. Nothing was lost; please try again."
            : undefined
        }
      />
      <Field
        name="confirmation"
        label={`Type "${WORD}" to confirm`}
        value={word}
        onChangeText={setWord}
        editable={!deleting}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <PrimaryButton
        label="Delete account"
        onPress={() => void deleteNow()}
        busy={deleting}
        disabled={word.trim().toLowerCase() !== WORD}
      />
      {deleting ? <Notice>Deleting your account…</Notice> : null}
    </FormScreen>
  );
}
