import rssPlugin from "@11ty/eleventy-plugin-rss";

export default (config) => {
  config.addPlugin(rssPlugin);

  config.addPassthroughCopy("css");
  config.addPassthroughCopy("img");
  config.addPassthroughCopy("fonts");
  config.addPassthroughCopy("favicon.ico");

  config.addShortcode("darkLightImg", (src, ext, alt) => {
    return `<picture>
      <source srcset="${src}-dark.${ext}" media="(prefers-color-scheme: dark)">
      <img src="${src}-light.${ext}" alt="${alt}">
    </picture>`;
  });

  return {
    dir: {
      input: "pages",
    },
  };
};
