export interface DemoPageMetadata {
  title: string;
  heading: string;
  cleanUrl: string;
  domain: string;
  urlResource: string;
  domainResource: string;
}

export function extractDemoPageMetadata(): DemoPageMetadata {
  const cleanUrl = window.location.href.split('#')[0];
  const domain = window.location.hostname.toLowerCase();
  const h1 = document.querySelector('h1');

  return {
    title: document.title || cleanUrl,
    heading: h1?.textContent?.trim() || document.title || 'Page',
    cleanUrl,
    domain,
    urlResource: `url:${cleanUrl}`,
    domainResource: `domain:${domain}`,
  };
}
