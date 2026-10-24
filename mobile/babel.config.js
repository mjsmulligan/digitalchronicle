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
            // One prefix alias covers every module under src/lib/journal
            // (types, db, airports, evaluation, connectors/*, sources/exif/*, ...).
            // Do not list modules individually: a missing entry breaks the
            // release bundle with "Unable to resolve module".
            "@chronicle/journal": "../src/lib/journal",
          },
          extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
        },
      ],
    ],
  };
};
