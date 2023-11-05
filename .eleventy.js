module.exports = (config) => {
  config.addPassthroughCopy("css");
  config.addPassthroughCopy("img");
  config.addPassthroughCopy("fonts");
  config.addPassthroughCopy("favicon.ico");
  return {
    dir: {
      input: "pages",
    },
  };
};
