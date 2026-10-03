/**
 * withEdgeToEdge — Expo config plugin
 *
 * Modifies MainActivity.kt (during `expo prebuild`) to call
 * WindowCompat.setDecorFitsSystemWindows(window, false) before setTheme,
 * so the app draws behind the status bar and navigation bar.
 *
 * androidx.core is already a transitive dependency via expo-modules-core
 * and expo-status-bar — no extra gradle dependency is needed.
 */
const { withMainActivity } = require("@expo/config-plugins");

const IMPORT = "import androidx.core.view.WindowCompat";

const MARKER =
  "// Set the theme to AppTheme BEFORE onCreate to support";

const INSERTION = `    // Edge-to-edge: let the app draw behind the status bar and navigation bar.
    // Must be called before setTheme so the window flags are in place before
    // the splash screen background is painted.
    WindowCompat.setDecorFitsSystemWindows(window, false)

    `;

module.exports = function withEdgeToEdge(config) {
  return withMainActivity(config, (config) => {
    let src = config.modResults.contents;

    // 1. Add the import if it isn't already there
    if (!src.includes(IMPORT)) {
      src = src.replace(
        "import android.os.Bundle",
        `import android.os.Bundle\n${IMPORT}`
      );
    }

    // 2. Insert the WindowCompat call before the splash-screen setTheme comment
    if (!src.includes("WindowCompat.setDecorFitsSystemWindows")) {
      if (src.includes(MARKER)) {
        src = src.replace(MARKER, INSERTION + MARKER);
      }
    }

    config.modResults.contents = src;
    return config;
  });
};
