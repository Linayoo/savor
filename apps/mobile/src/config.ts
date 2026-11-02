// The app's settings, from apps/mobile/.env (see .env.example). None are
// secrets; Expo inlines EXPO_PUBLIC_ variables into the bundle.
export type AppConfig = {
  apiUrl: string;
  userPoolId: string;
  userPoolClientId: string;
};

export function appConfig(): AppConfig {
  // Each variable must be read by its full name for Expo to inline it
  const values = {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_USER_POOL_ID: process.env.EXPO_PUBLIC_USER_POOL_ID,
    EXPO_PUBLIC_USER_POOL_CLIENT_ID:
      process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID,
  };
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}. Copy apps/mobile/.env.example to .env and fill it in.`,
    );
  }
  return {
    apiUrl: values.EXPO_PUBLIC_API_URL!,
    userPoolId: values.EXPO_PUBLIC_USER_POOL_ID!,
    userPoolClientId: values.EXPO_PUBLIC_USER_POOL_CLIENT_ID!,
  };
}
