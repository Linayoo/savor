import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAccount } from "@/account";
import { emailProblem, PASSWORD_RULES, passwordProblem } from "@/auth/errors";
import {
  Field,
  FormError,
  FormScreen,
  PrimaryButton,
  useAuthForm,
} from "@/components/account-form";

export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { requestPasswordReset, confirmPasswordReset } = useAccount();
  const [email, setEmail] = useState(params.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "reset">("email");
  const { errors, busy, submit } = useAuthForm();

  const sendCode = () =>
    submit("sendCode", { email: emailProblem(email) }, async () => {
      await requestPasswordReset(email);
      setStep("reset");
    });

  const reset = () =>
    submit(
      "setPassword",
      {
        code: /^\d{6}$/.test(code.trim())
          ? null
          : "Enter the 6-digit code from the email.",
        password: passwordProblem(password),
      },
      async () => {
        await confirmPasswordReset(email, code, password);
        router.replace({
          pathname: "/account/sign-in",
          params: { email: email.trim(), notice: "passwordChanged" },
        });
      },
    );

  if (step === "reset") {
    return (
      <FormScreen
        title="Set a new password"
        intro={`If there's an account for ${email.trim()}, we sent it a 6-digit code.`}
      >
        <FormError message={errors.form} />
        <Field
          name="code"
          label="Code"
          value={code}
          onChangeText={setCode}
          error={errors.code}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
        />
        <Field
          name="password"
          label="New password"
          hint={PASSWORD_RULES}
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <PrimaryButton label="Set password" onPress={reset} busy={busy} />
      </FormScreen>
    );
  }

  return (
    <FormScreen
      title="Forgot password"
      intro="We'll email you a code to set a new password."
    >
      <FormError message={errors.form} />
      <Field
        name="email"
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="username"
      />
      <PrimaryButton label="Send code" onPress={sendCode} busy={busy} />
    </FormScreen>
  );
}
