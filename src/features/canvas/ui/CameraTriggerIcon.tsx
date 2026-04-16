import { Camera } from 'lucide-react';

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
          d="M4 5.25A2.75 2.75 0 0 0 1.25 8v8A2.75 2.75 0 0 0 4 18.75h16A2.75 2.75 0 0 0 22.75 16V8A2.75 2.75 0 0 0 20 5.25h-3.146a1.25 1.25 0 0 1-.884-.366l-.824-.824A2.75 2.75 0 0 0 13.203 3H10.8a2.75 2.75 0 0 0-1.944.805l-.825.824a1.25 1.25 0 0 1-.884.366H4ZM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        />
      </svg>
    );
  }

  return <Camera className={className} strokeWidth={2.3} />;
}
