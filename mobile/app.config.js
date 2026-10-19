// app.config.js — extends app.json with two Android fixes applied at prebuild time:
//
// 1. Namespace fix: Expo SDK 57 prebuild strips the last dotted segment from
//    android.package when setting the Gradle namespace, generating "com.chronicle"
//    instead of "com.chronicle.app". This breaks Kotlin compilation because the
//    generated R and BuildConfig classes end up in the wrong package.
//
// 2. JVM args: adds --enable-native-access=ALL-UNNAMED so Gradle's JDK 17+
//    daemon can run the Android CMake toolchain without restricted-method errors.

const {
  withAppBuildGradle,
  withGradleProperties,
} = require("@expo/config-plugins");

/** @type {import('@expo/config').ExpoConfig} */
const config = require("./app.json").expo;

const withCorrectNamespace = (cfg) =>
  withAppBuildGradle(cfg, ({ modResults, ...rest }) => {
    modResults.contents = modResults.contents.replace(
      /namespace\s+"com\.chronicle"(?!\s*\.app)/g,
      'namespace "com.chronicle.app"'
    );
    modResults.contents = modResults.contents.replace(
      /applicationId\s+"com\.chronicle"(?!\s*\.app)/g,
      'applicationId "com.chronicle.app"'
    );
    return { modResults, ...rest };
  });

const withJvmArgs = (cfg) =>
  withGradleProperties(cfg, ({ modResults, ...rest }) => {
    const key = "org.gradle.jvmargs";
    const idx = modResults.findIndex(
      (p) => p.type === "property" && p.key === key
    );
    const value =
      "-Xmx2048m -XX:MaxMetaspaceSize=512m " +
      "--add-opens=java.base/java.lang=ALL-UNNAMED " +
      "--add-opens=java.base/java.util=ALL-UNNAMED " +
      "--enable-native-access=ALL-UNNAMED";
    if (idx >= 0) {
      modResults[idx] = { type: "property", key, value };
    } else {
      modResults.push({ type: "property", key, value });
    }
    return { modResults, ...rest };
  });

// 3. Release signing: when CHRONICLE_KEYSTORE_PATH is set (the release workflow
//    does this), sign the release build with that keystore instead of the debug
//    one that Expo prebuild generates. Without it, nothing changes.
const withReleaseSigning = (cfg) =>
  withAppBuildGradle(cfg, ({ modResults, ...rest }) => {
    const storePath = process.env.CHRONICLE_KEYSTORE_PATH;
    if (!storePath || modResults.contents.includes("signingConfigs.release")) {
      return { modResults, ...rest };
    }
    const releaseConfig = `
        release {
            storeFile file('${storePath.replace(/\\/g, "/")}')
            storePassword System.getenv('CHRONICLE_KEYSTORE_PASSWORD')
            keyAlias System.getenv('CHRONICLE_KEY_ALIAS')
            keyPassword System.getenv('CHRONICLE_KEY_PASSWORD')
        }`;
    modResults.contents = modResults.contents
      // add a release signing config after the debug one
      .replace(
        /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/,
        `$1${releaseConfig}`
      )
      // point the release build type at it
      .replace(
        /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/,
        "$1signingConfig signingConfigs.release"
      );
    return { modResults, ...rest };
  });

const withDateTimePicker = (cfg) => {
  cfg.plugins = [...(cfg.plugins ?? []), "@react-native-community/datetimepicker"];
  return cfg;
};

module.exports = withDateTimePicker(
  withReleaseSigning(withJvmArgs(withCorrectNamespace(config)))
);
