import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";

// Two apps that live side by side on one phone (spec 008): "Savor Dev", the
// development build, and "Savor", the release from TestFlight. EAS sets
// APP_VARIANT per build profile (eas.json); `pnpm mobile` and `pnpm ios` set
// development. Anything else is the release app.
const isDevelopment = process.env.APP_VARIANT === "development";
const identifier = isDevelopment
  ? "com.linayoo.savor.dev"
  : "com.linayoo.savor";

const config: ExpoConfig = {
  name: isDevelopment ? "Savor Dev" : "Savor",
  slug: "savor",
  // The release tag mobile-vX.Y.Z must match it (release-mobile.yml)
  version,
  platforms: ["ios", "android"],
  orientation: "portrait",
  icon: "./assets/icon/savor-icon.png",
  scheme: isDevelopment ? "savor-dev" : "savor",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: identifier,
    // Only standard HTTPS, so App Store Connect doesn't ask on every upload
    config: { usesNonExemptEncryption: false },
    icon: {
      light: "./assets/icon/savor-icon.png",
      dark: "./assets/icon/savor-icon-dark.png",
      tinted: "./assets/icon/savor-icon-tinted.png",
    },
  },
  android: {
    package: identifier,
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#F6F1E8",
        image: "./assets/icon/savor-splash.png",
        imageWidth: 72,
      },
    ],
    "expo-font",
    "expo-status-bar",
    "expo-sqlite",
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        cameraPermission:
          "Savor uses the camera so you can add a photo to a moment.",
        photosPermission:
          "Savor uses your photo library so you can add photos to a moment.",
        // Photos only, never video with sound
        microphonePermission: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
