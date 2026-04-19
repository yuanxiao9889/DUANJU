import { Camera, Video } from 'lucide-react';

interface CameraTriggerIconProps {
  active?: boolean;
  className?: string;
  variant?: 'photo' | 'video';
}

export function CameraTriggerIcon({
  active = false,
  className = '',
  variant = 'video',
}: CameraTriggerIconProps) {
  if (variant === 'photo') {
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
            d="M9.622 2.25a1.5 1.5 0 0 0-1.061.44L7.152 4.1a1.5 1.5 0 0 1-1.06.44H3.75A2.25 2.25 0 0 0 1.5 6.75v10.5A2.25 2.25 0 0 0 3.75 19.5h16.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25h-2.342a1.5 1.5 0 0 1-1.06-.44L15.44 2.69a1.5 1.5 0 0 0-1.062-.44H9.622ZM12 7.875a4.125 4.125 0 1 0 0 8.25a4.125 4.125 0 0 0 0-8.25Z"
          />
        </svg>
      );
    }

    return <Camera className={className} strokeWidth={2.3} />;
  }

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
