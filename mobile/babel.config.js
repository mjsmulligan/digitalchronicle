module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./src"],
          alias: {
            "@chronicle/journal/types": "../src/lib/journal/types",
            "@chronicle/journal/storage": "../src/lib/journal/storage",
            "@chronicle/journal/db": "../src/lib/journal/db",
            "@chronicle/journal/staging": "../src/lib/journal/staging",
            "@chronicle/journal/connectors": "../src/lib/journal/connectors",
            "@chronicle/journal/contacts": "../src/lib/journal/contacts",
            "@chronicle/journal/merge": "../src/lib/journal/merge",
          },
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
        },
      ],
    ],
  };
};
