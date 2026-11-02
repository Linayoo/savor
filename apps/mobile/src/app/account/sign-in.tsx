import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAccount } from "@/account";
import { emailProblem } from "@/auth/errors";
import {
  Field,
  FormError,
  FormScreen,
  Notice,
  PrimaryButton,
  TextLink,
  useAuthForm,
} from "@/components/account-form";

export default function SignIn() {
  const params = useLocalSearchParams<{ email?: string; notice?: string }>();
  const { signIn, confirmSignUp, resendSignUpCode } = useAccount();
  const [email, setEmail] = useState(params.email ?? "");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"details" | "code">("details");
  const { errors, busy, submit } = useAuthForm();

  const signInNow = () =>
    submit(
      {
        email: emailProblem(email),
        password: password ? null : "Enter your password.",
      },
      async () => {
        if ((await signIn(email, password)) === "confirmSignUp") {
          await resendSignUpCode(email);
          setStep("code");
          return;
        }
        router.dismissAll();
      },
    );

  const confirm = () =>
    submit(
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
        intro={`Your account isn't confirmed yet. We sent a 6-digit code to ${email.trim()}.`}
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
      </FormScreen>
    );
  }

  return (
    <FormScreen title="Sign in">
      {params.notice === "passwordChanged" ? (
        <Notice>Your password is changed. Sign in with it.</Notice>
      ) : null}
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
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />
      <PrimaryButton label="Sign in" onPress={signInNow} busy={busy} />
      <TextLink
        label="Forgot password"
        onPress={() =>
          router.push({ pathname: "/account/forgot", params: { email } })
        }
      />
    </FormScreen>
  );
}
