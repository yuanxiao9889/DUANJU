import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import readingLoaderUrl from '@/assets/animations/reading-loader.webm';

export type UiLoadingSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface UiLoadingAnimationProps {
  size?: UiLoadingSize;
  className?: string;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  title?: string;
  style?: CSSProperties;
}

interface UiLoadingIndicatorProps extends UiLoadingAnimationProps {
  label?: ReactNode;
  labelClassName?: string;
  layout?: 'inline' | 'stacked';
  align?: 'start' | 'center';
}

interface UiLoadingBannerProps {
  className?: string;
  panelClassName?: string;
}

interface UiLoadingOverlayProps {
  visible: boolean;
  className?: string;
  panelClassName?: string;
  insetClassName?: string;
  backdropClassName?: string;
  blockInteractions?: boolean;
}

const SIZE_CLASS_MAP: Record<UiLoadingSize, string> = {
  xs: 'h-6 w-6',
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
};

const LABEL_SIZE_CLASS_MAP: Record<UiLoadingSize, string> = {
  xs: 'text-[11px]',
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
  xl: 'text-base',
};

export function UiLoadingAnimation({
  size = 'md',
  className = '',
  width,
  height,
  title,
  style,
}: UiLoadingAnimationProps) {
  const resolvedStyle: CSSProperties | undefined =
    width || height || style
      ? {
          width,
          height,
          ...style,
        }
      : style;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`.trim()}
      title={title}
      aria-hidden="true"
    >
      <video
        src={readingLoaderUrl}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        tabIndex={-1}
        disablePictureInPicture
        disableRemotePlayback
        className={`${!width && !height ? SIZE_CLASS_MAP[size] : ''} pointer-events-none select-none object-contain`}
        style={resolvedStyle}
      />
    </span>
  );
}

export function UiLoadingIndicator({
  size = 'md',
  label,
  className = '',
  labelClassName = '',
  layout = 'inline',
  align = 'center',
  ...animationProps
}: UiLoadingIndicatorProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('common.loading');

  const layoutClassName =
    layout === 'stacked'
      ? 'flex-col gap-2 text-center'
      : 'flex-row gap-2';
  const alignClassName =
    align === 'start'
      ? 'items-start justify-start'
      : 'items-center justify-center';

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex ${layoutClassName} ${alignClassName} ${className}`.trim()}
    >
      <UiLoadingAnimation size={size} {...animationProps} />
      <span
        className={`${LABEL_SIZE_CLASS_MAP[size]} leading-none text-text-muted ${labelClassName}`.trim()}
      >
        {resolvedLabel}
      </span>
    </span>
  );
}

export function UiLoadingBanner({
  className = '',
  panelClassName = '',
}: UiLoadingBannerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex w-full items-center justify-center ${className}`.trim()}
    >
      <div
        className={`relative w-[min(500px,calc(100vw-3rem))] max-w-full overflow-hidden rounded-[28px] border border-border-dark/70 bg-bg-dark shadow-[0_18px_48px_rgba(0,0,0,0.24)] aspect-[20/9] ${panelClassName}`.trim()}
      >
        <UiLoadingAnimation
          className="h-full w-full"
          width="100%"
          height="100%"
          style={{ display: 'block' }}
        />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    </div>
  );
}

export function UiLoadingOverlay({
  visible,
  className = '',
  panelClassName = '',
  insetClassName = 'inset-0',
  backdropClassName = 'bg-black/28 backdrop-blur-[2px]',
  blockInteractions = false,
}: UiLoadingOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className={`absolute ${insetClassName} z-20 flex items-center justify-center rounded-[inherit] ${blockInteractions ? 'pointer-events-auto' : 'pointer-events-none'} ${backdropClassName} ${className}`.trim()}
    >
      <UiLoadingBanner panelClassName={panelClassName} />
    </div>
  );
}
