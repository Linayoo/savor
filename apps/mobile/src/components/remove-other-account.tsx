import { useState } from "react";
import { Alert } from "react-native";
import { useAccount } from "@/account";
import { OTHER_ACCOUNT_MESSAGE } from "@/sync/ownership";
import { Notice, TextLink } from "./account-form";

// Under the ownership refusal on the sign-in and create-account screens: the
// way out for a phone whose account can't sign in anymore, or that someone
// hands over (spec 010, behavior 9). Clears this phone only.
export function RemoveOtherAccount({
  formError,
  onRemoved,
}: {
  formError?: string;
  // Clears the refusal, which no longer applies
  onRemoved: () => void;
}) {
  const { removeOtherAccountData } = useAccount();
  const [removed, setRemoved] = useState(false);

  const confirm = () =>
    Alert.alert(
      "Remove them from this phone?",
      "This removes the other account's moments, photos and letters from this phone. Moments that were never synced will be lost. Nothing changes on the server.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            removeOtherAccountData();
            setRemoved(true);
            onRemoved();
          },
        },
      ],
    );

  if (removed) {
    return (
      <Notice>
        The moments were removed from this phone. You can sign in now.
      </Notice>
    );
  }
  if (formError !== OTHER_ACCOUNT_MESSAGE) return null;
  return (
    <TextLink
      label="Remove them from this phone"
      destructive
      onPress={confirm}
    />
  );
}
