import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useAccount } from "@/account";
import {
  FormError,
  FormScreen,
  Notice,
  PrimaryButton,
  TextLink,
  useSingleFlight,
} from "@/components/account-form";
import { useLetters } from "@/letters/provider";
import { deviceTimeZone } from "@/letters/time-zone";
import { useSync } from "@/sync-provider";
import { syncLine } from "@/sync/sync-line";
import { fonts } from "@/theme";

export default function Account() {
  const { account, signOut } = useAccount();
  const { busy, run } = useSingleFlight();
  const [signOutFailed, setSignOutFailed] = useState(false);

  const signOutNow = () =>
    run(async () => {
      setSignOutFailed(false);
      await signOut().catch(() => setSignOutFailed(true));
    });

  if (account.status === "loading") return null;

  if (account.status === "signedOut") {
    return (
      <FormScreen
        title="Your account"
        intro="Keep your moments safe and on all your devices."
      >
        {account.sessionEnded ? (
          <Notice>Your session ended. Sign in again to keep syncing.</Notice>
        ) : null}
        <PrimaryButton
          label="Create account"
          onPress={() => router.push("/account/create")}
        />
        <TextLink
          label="Sign in"
          onPress={() => router.push("/account/sign-in")}
        />
      </FormScreen>
    );
  }

  return (
    <FormScreen title="Your account">
      <Text style={styles.label}>Signed in as</Text>
      <Text style={styles.email}>{account.session.email}</Text>
      <SyncLine />
      <StorageLine />
      <MonthlyLetterSwitch />
      <FormError
        message={signOutFailed ? "Couldn't sign out. Try again." : undefined}
      />
      <TextLink
        label="Sign out"
        disabled={busy}
        onPress={() => void signOutNow()}
      />
      <Notice>Signing out keeps your moments on this phone.</Notice>
    </FormScreen>
  );
}

function SyncLine() {
  const { status, online } = useSync();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!status) return null;
  return <Text style={styles.syncLine}>{syncLine(status, online, now)}</Text>;
}

// Only while photos wait for space, with no count (spec 009)
function StorageLine() {
  const { photosWaitingForSpace } = useSync();
  if (!photosWaitingForSpace) return null;
  return (
    <Text style={styles.syncLine}>
      New photos stay on this phone. Savor&apos;s space for your photos is full.
    </Text>
  );
}

// Off until the explanation's "Turn on"; off again at once (spec 007)
function MonthlyLetterSwitch() {
  const { settings, saveSettings } = useLetters();
  const { busy, run } = useSingleFlight();
  const [failed, setFailed] = useState(false);

  const change = (on: boolean) => {
    if (on) {
      router.push("/account/monthly-letter");
      return;
    }
    void run(async () => {
      setFailed(false);
      const timeZone = settings?.timeZone ?? deviceTimeZone();
      if (!timeZone) return setFailed(true);
      await saveSettings(false, timeZone).catch(() => setFailed(true));
    });
  };

  return (
    <View style={styles.letter}>
      <View style={styles.letterRow}>
        <View style={styles.letterText}>
          <Text style={styles.letterLabel}>Monthly letter</Text>
          <Text style={styles.label}>
            A letter from your moments, once a month.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Monthly letter"
          value={settings?.enabled ?? false}
          disabled={!settings || busy}
          accessibilityState={{ disabled: !settings || busy }}
          onValueChange={change}
          trackColor={{ true: "#A5532F" }}
        />
      </View>
      <FormError
        message={
          failed ? "Couldn't change the monthly letter. Try again." : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  letter: { marginBottom: 20 },
  letterRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  letterText: { flex: 1 },
  letterLabel: { fontFamily: fonts.bodyMedium, fontSize: 16, color: "#2B2622" },
  label: { fontFamily: fonts.body, fontSize: 13, color: "#6B6158" },
  email: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: "#2B2622",
    marginTop: 2,
    marginBottom: 8,
  },
  syncLine: {
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    color: "#6B6158",
    marginBottom: 20,
  },
});
