module.exports = (config) => {
  config.addPassthroughCopy("CNAME");
  return {
    dir: {
      input: "pages",
    },
  };
};
