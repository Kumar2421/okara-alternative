import type { SVGProps, ImgHTMLAttributes } from "react";

/**
 * Ported from the marketing site's integrations showcase
 * (marlo/src/components/sites/marlo/root/IntegrationsSection.tsx) for the
 * login page's right panel. Kept as plain inline SVG (no CSS-variable
 * theme tokens) since this renders inside okara-alternative's own design
 * system, not the marketing site's.
 */

export function GoogleSearchConsoleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" fill="#4285F4" />
      <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" fill="#fff" />
    </svg>
  );
}

export function GoogleAnalyticsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="14" y="4" width="4" height="16" rx="1" fill="#F9AB00" />
      <rect x="4" y="12" width="4" height="8" rx="1" fill="#4285F4" />
      <rect x="9" y="8" width="4" height="12" rx="1" fill="#34A853" />
    </svg>
  );
}

export function GmailIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#fff" stroke="#e4ddcd" />
      <path d="M4 7.5 12 13l8-5.5" stroke="#EA4335" strokeWidth="1.6" fill="none" />
      <path d="M4 7.5v9a1 1 0 0 0 1 1h1V8.6L4 7.5Z" fill="#EA4335" />
      <path d="M20 7.5v9a1 1 0 0 1-1 1h-1V8.6l2-1.1Z" fill="#34A853" />
      <path d="M6 8.6V6.5a1 1 0 0 1 1.6-.8L12 8.9l4.4-3.2a1 1 0 0 1 1.6.8v2.1L12 13 6 8.6Z" fill="#4285F4" />
    </svg>
  );
}

export function GitHubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M12 2C6.48 2 2 6.58 2 12.19c0 4.49 2.87 8.3 6.84 9.64.5.1.68-.22.68-.49v-1.9c-2.78.62-3.37-1.19-3.37-1.19-.46-1.19-1.11-1.51-1.11-1.51-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.9 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.64-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.95.68 1.92v2.84c0 .27.18.6.69.49A10.2 10.2 0 0 0 22 12.19C22 6.58 17.52 2 12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function PageSpeedIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="10" fill="#0CCE6B" />
      <path d="M12 6v6l4 2" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function TavilyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="10" fill="#111111" />
      <path d="M8 12h8M12 8v8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function GooglePlacesIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7Z" fill="#EA4335" />
      <circle cx="12" cy="9" r="2.5" fill="#fff" />
    </svg>
  );
}

export function WordPressIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="10" fill="#21759B" />
      <path
        d="M3.3 12a8.7 8.7 0 0 0 4.9 7.83L4.2 9.2A8.6 8.6 0 0 0 3.3 12Zm14.9-.45c0-.99-.36-1.68-.66-2.2-.4-.66-.78-1.23-.78-1.9 0-.75.56-1.44 1.36-1.44h.1a8.7 8.7 0 0 0-13.15 1.65h.53c.85 0 2.16-.1 2.16-.1.44-.03.5.62.06.68 0 0-.44.05-.94.08l2.98 8.87 1.79-5.37-1.28-3.5c-.44-.03-.86-.08-.86-.08-.44-.03-.39-.7.05-.68 0 0 1.34.1 2.14.1.85 0 2.16-.1 2.16-.1.44-.03.5.62.06.68 0 0-.45.05-.94.08l2.96 8.8.82-2.73c.36-1.14.63-1.96.63-2.66Zm-5.85 1.23-2.46 7.15c.74.22 1.51.33 2.32.33a8.7 8.7 0 0 0 2.68-.42.8.8 0 0 1-.06-.12l-2.48-6.94Zm7.65-5.04c.03.26.05.53.05.83 0 .82-.15 1.75-.62 2.9l-2.49 7.2A8.7 8.7 0 0 0 20.7 12a8.6 8.6 0 0 0-1-4.03v.77Z"
        fill="#fff"
      />
    </svg>
  );
}

export function WebflowIcon(props: SVGProps<SVGSVGElement>) {
  const { className, ...rest } = props;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/integrations/webflow.svg" alt="" className={className} {...(rest as ImgHTMLAttributes<HTMLImageElement>)} />;
}

export function FramerIcon(props: SVGProps<SVGSVGElement>) {
  const { className, ...rest } = props;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/integrations/framer.svg" alt="" className={className} {...(rest as ImgHTMLAttributes<HTMLImageElement>)} />;
}

export function WixIcon(props: SVGProps<SVGSVGElement>) {
  const { className, ...rest } = props;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/integrations/wix.svg" alt="" className={className} {...(rest as ImgHTMLAttributes<HTMLImageElement>)} />;
}

export function SanityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M5 4h13l-7.8 8 7.8 8H5l7.8-8L5 4Z" fill="#F03E2F" />
    </svg>
  );
}

export function LinkedInIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path
        d="M7.1 9.6H4.4V19h2.7V9.6ZM5.75 8.4a1.57 1.57 0 1 0 0-3.14 1.57 1.57 0 0 0 0 3.14ZM19.6 19v-5.15c0-2.76-1.47-4.05-3.44-4.05-1.58 0-2.29.87-2.69 1.48v-1.27H10.8c.04.75 0 9 0 9h2.68v-5.03c0-.27.02-.53.1-.73.22-.54.72-1.11 1.56-1.11 1.1 0 1.54.84 1.54 2.06V19h2.92Z"
        fill="#fff"
      />
    </svg>
  );
}

export function XIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M18.9 3H22l-7.2 8.2L23 21h-6.6l-5.2-6.4L5.3 21H2.1l7.7-8.8L2 3h6.7l4.7 5.8L18.9 3Zm-1.2 16h1.7L7.4 4.9H5.6L17.7 19Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function WhatsAppIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="10" fill="#25D366" />
      <path
        d="M16.5 13.4c-.25-.13-1.47-.72-1.7-.8-.23-.09-.4-.13-.56.13-.17.25-.65.8-.8.97-.15.17-.3.19-.54.06-.25-.12-1.05-.38-2-1.23a7.5 7.5 0 0 1-1.38-1.72c-.15-.25-.02-.38.11-.5.11-.11.25-.3.37-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08s.9 2.41 1.02 2.58c.13.17 1.77 2.7 4.28 3.79.6.26 1.07.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.1-.23-.16-.48-.29Z"
        fill="#fff"
      />
    </svg>
  );
}

export function TelegramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="10" fill="#26A5E4" />
      <path
        d="M17.3 7.2 15.5 17c-.13.6-.5.75-1 .46l-2.77-2.04-1.34 1.29c-.15.15-.27.27-.56.27l.2-2.83 5.15-4.66c.22-.2-.05-.31-.34-.11l-6.37 4-2.74-.86c-.6-.19-.6-.6.13-.88l10.7-4.12c.5-.18.94.11.79.85Z"
        fill="#fff"
      />
    </svg>
  );
}

export function TikTokIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M16.6 2h-3.3v13.4a2.6 2.6 0 1 1-1.9-2.5V9.5a5.9 5.9 0 1 0 5.2 5.9V8.6a7.6 7.6 0 0 0 4.4 1.4V6.7a4.3 4.3 0 0 1-4.4-4.7Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function InstagramIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <defs>
        <linearGradient id="ig-grad-login" x1="0" y1="24" x2="24" y2="0">
          <stop offset="0" stopColor="#FFDC80" />
          <stop offset="0.3" stopColor="#FCAF45" />
          <stop offset="0.6" stopColor="#E1306C" />
          <stop offset="1" stopColor="#833AB4" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill="url(#ig-grad-login)" />
      <rect x="6" y="6" width="12" height="12" rx="4" stroke="#fff" strokeWidth="1.6" fill="none" />
      <circle cx="12" cy="12" r="3.1" stroke="#fff" strokeWidth="1.6" fill="none" />
      <circle cx="16.1" cy="7.9" r="0.9" fill="#fff" />
    </svg>
  );
}

export function SlackIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M9 2.5a1.8 1.8 0 1 1 0 3.6H7.2V4.3A1.8 1.8 0 0 1 9 2.5Z" fill="#36C5F0" />
      <path d="M9 8.5H3.7a1.8 1.8 0 1 0 0 3.6H9a1.8 1.8 0 0 0 0-3.6Z" fill="#36C5F0" />
      <path d="M21.5 10.3a1.8 1.8 0 1 1-3.6 0v-1.8h1.8a1.8 1.8 0 0 1 1.8 1.8Z" fill="#2EB67D" />
      <path d="M15.5 10.3V4.9a1.8 1.8 0 1 1 3.6 0v5.4a1.8 1.8 0 0 1-3.6 0Z" fill="#2EB67D" />
      <path d="M15 21.5a1.8 1.8 0 1 1 0-3.6h1.8v1.8a1.8 1.8 0 0 1-1.8 1.8Z" fill="#E01E5A" />
      <path d="M15 15.5h5.4a1.8 1.8 0 1 1 0 3.6H15a1.8 1.8 0 0 1 0-3.6Z" fill="#E01E5A" />
      <path d="M2.5 13.7a1.8 1.8 0 1 1 3.6 0v1.8H4.3a1.8 1.8 0 0 1-1.8-1.8Z" fill="#ECB22E" />
      <path d="M8.5 13.7v5.4a1.8 1.8 0 1 1-3.6 0v-5.4a1.8 1.8 0 0 1 3.6 0Z" fill="#ECB22E" />
    </svg>
  );
}
