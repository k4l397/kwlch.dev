module.exports = (config) => {
  config.addPassthroughCopy("CNAME");
  config.addPassthroughCopy("css");
  config.addPassthroughCopy("img");
  config.addPassthroughCopy("fonts");
  return {
    dir: {
      input: "pages",
    },
  };
};
