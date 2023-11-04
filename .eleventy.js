module.exports = (config) => {
  config.addPassthroughCopy("CNAME");
  config.addPassthroughCopy("css");
  config.addPassthroughCopy("img");
  return {
    dir: {
      input: "pages",
    },
  };
};
