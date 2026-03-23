import type { AlignmentGuide } from '../application/nodeAlignment';

interface AlignmentGuidesProps {
  guides: AlignmentGuide[];
  viewport: { x: number; y: number; zoom: number };
}

export function AlignmentGuides({ guides, viewport }: AlignmentGuidesProps) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 9998 }}
    >
      {guides.map((guide, index) => {
        const screenPosition = guide.type === 'horizontal'
          ? guide.position * viewport.zoom + viewport.y
          : guide.position * viewport.zoom + viewport.x;
        const isCenterGuide = guide.style === 'center' || guide.style === 'middle';

        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              ...(guide.type === 'horizontal' ? {
                top: screenPosition,
                left: 0,
                right: 0,
                height: '1px',
                borderTop: isCenterGuide
                  ? '1px solid rgba(59, 130, 246, 0.82)'
                  : '1px dashed rgba(59, 130, 246, 0.6)',
              } : {
                left: screenPosition,
                top: 0,
                bottom: 0,
                width: '1px',
                borderLeft: isCenterGuide
                  ? '1px solid rgba(59, 130, 246, 0.82)'
                  : '1px dashed rgba(59, 130, 246, 0.6)',
              }),
            }}
          />
        );
      })}
    </div>
  );
}
