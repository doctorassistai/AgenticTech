export const trackPage = (url) => {
  window.gtag("event", "page_view", {
    page_path: url,
  });
};
