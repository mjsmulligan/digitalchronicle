const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Watch the shared source tree so Metro hot-reloads on ../src/lib/journal/ changes.
config.watchFolders = [workspaceRoot];

// Resolve node_modules from both roots (mobile first, then workspace fallback).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Force React (and react/jsx-runtime) to ALWAYS resolve from mobile/node_modules,
// regardless of which file triggers the import. Without this, any shared file
// outside projectRoot (e.g. ../src/lib/journal/db.ts which imports useSyncExternalStore)
// resolves the workspace root's React 18, producing the
// "Invalid hook call / multiple copies of React" crash.
//
// Note: extraNodeModules only works for files inside projectRoot.
// resolveRequest intercepts every resolution regardless of origin.
const PINNED_TO_MOBILE = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-native",
]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (PINNED_TO_MOBILE.has(moduleName)) {
    const filePath = require.resolve(moduleName, { paths: [projectRoot] });
    return { type: "sourceFile", filePath };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
