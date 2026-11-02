import { router } from "expo-router";
import { useState } from "react";
import { useAccount } from "@/account";
import { emailProblem, PASSWORD_RULES, passwordProblem } from "@/auth/errors";
import {
  Field,
  FormError,
  FormScreen,
  PrimaryButton,
  TextLink,
  useAuthForm,
} from "@/components/account-form";

export default function CreateAccount() {
  const { signUp, confirmSignUp, resendSignUpCode } = useAccount();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"details" | "code">("details");
  const { errors, busy, submit } = useAuthForm();

  const create = () =>
    submit(
      "signUp",
      { email: emailProblem(email), password: passwordProblem(password) },
      async () => {
        await signUp(email, password);
        setStep("code");
      },
    );

  const confirm = () =>
    submit(
      "confirmCode",
      {
        code: /^\d{6}$/.test(code.trim())
          ? null
          : "Enter the 6-digit code from the email.",
      },
      async () => {
        await confirmSignUp(email, code, password);
        router.dismissAll();
      },
    );

  if (step === "code") {
    return (
      <FormScreen
        title="Check your email"
        intro={`We sent a 6-digit code to ${email.trim()}.`}
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
        <PrimaryButton label="Confirm" onPress={confirm} busy={busy} />
        <TextLink
          label="Send a new code"
          disabled={busy}
          onPress={() => submit("sendCode", {}, () => resendSignUpCode(email))}
        />
      </FormScreen>
    );
  }

  return (
    <FormScreen
      title="Create account"
      intro="Keep your moments safe and on all your devices."
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
      <Field
        name="password"
        label="Password"
        hint={PASSWORD_RULES}
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <PrimaryButton label="Create account" onPress={create} busy={busy} />
    </FormScreen>
  );
}
