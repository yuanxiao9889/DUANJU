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
  fit?: 'contain' | 'cover' | 'fill';
  trimBars?: boolean;
  trimInset?: string;
  zoom?: number;
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
  variant?: 'default' | 'bare';
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

const FIT_CLASS_MAP: Record<NonNullable<UiLoadingAnimationProps['fit']>, string> = {
  contain: 'object-contain',
  cover: 'object-cover',
  fill: 'object-fill',
};

const BARE_LOADING_WIDTH = 'min(320px, calc(100% - 2rem))';
const BARE_LOADING_HEIGHT = '120px';
const BARE_LOADING_TRIM_INSET = '18%';
const BARE_LOADING_ZOOM = 1.45;

export function UiLoadingAnimation({
  size = 'md',
  className = '',
  width,
  height,
  title,
  style,
  fit = 'contain',
  trimBars = false,
  trimInset = BARE_LOADING_TRIM_INSET,
  zoom = 1,
}: UiLoadingAnimationProps) {
  const resolvedZoom =
    typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0
      ? zoom
      : 1;
  const resolvedStyle: CSSProperties | undefined =
    width || height || style
      ? {
          display: 'block',
          width,
          height,
          backgroundColor: 'transparent',
          objectPosition: 'center',
          clipPath: trimBars ? `inset(${trimInset} 0 ${trimInset} 0)` : undefined,
          transform: resolvedZoom !== 1 ? `scale(${resolvedZoom})` : undefined,
          transformOrigin: 'center',
          ...style,
        }
      : {
          display: 'block',
          backgroundColor: 'transparent',
          objectPosition: 'center',
          clipPath: trimBars ? `inset(${trimInset} 0 ${trimInset} 0)` : undefined,
          transform: resolvedZoom !== 1 ? `scale(${resolvedZoom})` : undefined,
          transformOrigin: 'center',
          ...(style ?? {}),
        };

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${trimBars || resolvedZoom !== 1 ? 'overflow-hidden' : ''} ${className}`.trim()}
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
        className={`${!width && !height ? SIZE_CLASS_MAP[size] : ''} pointer-events-none select-none ${FIT_CLASS_MAP[fit]}`}
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
  backdropClassName = 'bg-[rgba(6,8,12,0.78)] backdrop-blur-[3px]',
  blockInteractions = false,
  variant = 'default',
}: UiLoadingOverlayProps) {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  return (
    <div
      className={`absolute ${insetClassName} z-20 flex items-center justify-center rounded-[inherit] ${blockInteractions ? 'pointer-events-auto' : 'pointer-events-none'} ${backdropClassName} ${className}`.trim()}
    >
      <div
        className={`${
          variant === 'bare'
            ? 'inline-flex items-center justify-center overflow-visible rounded-none bg-transparent shadow-none'
            : 'overflow-hidden rounded-[22px] bg-bg-dark/92 shadow-[0_16px_36px_rgba(0,0,0,0.32)]'
        } ${panelClassName}`.trim()}
        style={variant === 'bare' ? undefined : { width: 'min(220px, calc(100% - 2rem))' }}
      >
        <UiLoadingAnimation
          className={variant === 'bare' ? 'block' : 'block h-[96px] w-full'}
          width={variant === 'bare' ? BARE_LOADING_WIDTH : '100%'}
          height={variant === 'bare' ? BARE_LOADING_HEIGHT : '96px'}
          fit={variant === 'bare' ? 'contain' : 'cover'}
          trimBars={variant === 'bare'}
          trimInset={variant === 'bare' ? BARE_LOADING_TRIM_INSET : undefined}
          zoom={variant === 'bare' ? BARE_LOADING_ZOOM : 1}
        />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    </div>
  );
}
