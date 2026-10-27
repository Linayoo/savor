module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Drizzle migrations import their .sql files as strings
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
