import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import {
  FormError,
  FormScreen,
  PrimaryButton,
  TextLink,
  useSingleFlight,
} from "@/components/account-form";
import { useLetters } from "@/letters/provider";
import { deviceTimeZone } from "@/letters/time-zone";
import { fonts } from "@/theme";

// What turning on the monthly letter means, before it's on (spec 007)
export default function MonthlyLetter() {
  const { saveSettings } = useLetters();
  const { busy, run } = useSingleFlight();
  const [error, setError] = useState<string>();

  const turnOn = () =>
    run(async () => {
      setError(undefined);
      const timeZone = deviceTimeZone();
      if (!timeZone) {
        setError("Couldn't read this phone's time zone.");
        return;
      }
      try {
        await saveSettings(true, timeZone);
        router.back();
      } catch {
        setError("Couldn't turn it on. Check your connection and try again.");
      }
    });

  return (
    <FormScreen title="Monthly letter">
      <Text style={styles.text}>
        Once a month, Savor writes you a short letter from that month&apos;s
        moments.
      </Text>
      <Text style={styles.text}>
        To write it, the words, kinds and dates of that month&apos;s moments are
        sent to an AI model: Claude, through Amazon Bedrock in the EU. Photos
        and account details are not.
      </Text>
      <Text style={styles.text}>You can turn it off any time.</Text>
      <FormError message={error} />
      <PrimaryButton
        label="Turn on"
        busy={busy}
        onPress={() => void turnOn()}
      />
      <TextLink label="Not now" disabled={busy} onPress={() => router.back()} />
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 26,
    color: "#2B2622",
    marginBottom: 14,
  },
});
