import { memo, useMemo } from 'react';

interface EdgeParticlesProps {
  path: string;
  particleCount?: number;
  particleSize?: number;
  duration?: number;
  color?: string;
  opacity?: number;
}

export const EdgeParticles = memo(function EdgeParticles({
  path,
  particleCount = 5,
  particleSize = 3,
  duration = 2,
  color = '#3B82F6',
  opacity = 0.8,
}: EdgeParticlesProps) {
  const particles = useMemo(() => {
    return Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      delay: (i / particleCount) * duration,
    }));
  }, [particleCount, duration]);

  return (
    <g style={{ pointerEvents: 'none' }} className="edge-particles">
      {particles.map((particle) => (
        <circle
          key={particle.id}
          r={particleSize}
          fill={color}
          opacity={opacity}
        >
          <animateMotion
            dur={`${duration}s`}
            repeatCount="indefinite"
            begin={`${particle.delay}s`}
            path={path}
          />
        </circle>
      ))}
    </g>
  );
});
