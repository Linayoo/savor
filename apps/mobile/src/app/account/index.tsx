import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useAccount } from "@/account";
import {
  FormScreen,
  Notice,
  PrimaryButton,
  TextLink,
} from "@/components/account-form";
import { useSync } from "@/sync-provider";
import { syncLine } from "@/sync/sync-line";
import { fonts } from "@/theme";

export default function Account() {
  const { account, signOut } = useAccount();

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
      <TextLink label="Sign out" onPress={() => void signOut()} />
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

const styles = StyleSheet.create({
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
