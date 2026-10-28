import type { ResourceType } from "@htv/core";

export function ResourceTypeIcon({ type }: { type: ResourceType }) {
  switch (type) {
    case "document":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect
            x="1"
            y="0.5"
            width="8"
            height="11"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <line x1="3" y1="3.5" x2="7" y2="3.5" stroke="currentColor" strokeWidth="1" />
          <line x1="3" y1="5.5" x2="7" y2="5.5" stroke="currentColor" strokeWidth="1" />
          <line x1="3" y1="7.5" x2="5.5" y2="7.5" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case "stylesheet":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect
            x="0.6"
            y="0.6"
            width="10.8"
            height="10.8"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <line x1="2" y1="4" x2="10" y2="4" stroke="currentColor" strokeWidth="1" />
          <line x1="2" y1="6" x2="8" y2="6" stroke="currentColor" strokeWidth="1" />
          <line x1="2" y1="8" x2="9" y2="8" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case "script":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <polyline
            points="1,4 4,6 1,8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
          <line
            x1="6"
            y1="8.5"
            x2="11"
            y2="8.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case "image":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <rect
            x="0.6"
            y="1.6"
            width="10.8"
            height="8.8"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <circle cx="4" cy="4.5" r="1" fill="currentColor" />
          <polyline
            points="0.6,8.5 3.5,5.5 5.5,7.5 7.5,5.5 11.4,8.5"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "font":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <text x="1" y="10" fontSize="10" fontFamily="serif" fill="currentColor" fontWeight="bold">
            A
          </text>
        </svg>
      );
    case "fetch":
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <line
            x1="6"
            y1="1"
            x2="6"
            y2="11"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <polyline
            points="3,4 6,1 9,4"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
          <polyline
            points="3,8 6,11 9,8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      );
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
          <text x="6" y="9.5" textAnchor="middle" fontSize="7" fill="currentColor">
            ?
          </text>
        </svg>
      );
  }
}
