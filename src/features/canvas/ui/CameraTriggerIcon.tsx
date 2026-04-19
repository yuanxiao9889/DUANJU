import { Video } from 'lucide-react';

interface CameraTriggerIconProps {
  active?: boolean;
  className?: string;
}

export function CameraTriggerIcon({
  active = false,
  className = '',
}: CameraTriggerIconProps) {
  if (active) {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={className}
        fill="none"
      >
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M4.5 5.25A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75h8A2.25 2.25 0 0 0 14.75 16.5v-1.444l4.182 2.51c1.183.71 2.818-.143 2.818-1.523V8.957c0-1.38-1.635-2.233-2.818-1.523l-4.182 2.51V7.5a2.25 2.25 0 0 0-2.25-2.25h-8Z"
        />
      </svg>
    );
  }

  return <Video className={className} strokeWidth={2.3} />;
}
