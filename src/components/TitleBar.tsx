import { useCallback, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, X, Maximize2, Settings, ArrowLeft, PackageOpen, Film } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Languages } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import closeNormalIcon from '@/assets/macos-traffic-lights/1-close-1-normal.svg';
import closeHoverIcon from '@/assets/macos-traffic-lights/2-close-2-hover.svg';
import minimizeNormalIcon from '@/assets/macos-traffic-lights/2-minimize-1-normal.svg';
import minimizeHoverIcon from '@/assets/macos-traffic-lights/2-minimize-2-hover.svg';
import maximizeNormalIcon from '@/assets/macos-traffic-lights/3-maximize-1-normal.svg';
import maximizeHoverIcon from '@/assets/macos-traffic-lights/3-maximize-2-hover.svg';
import titlebarLogo from '@/assets/titlebar-logo.png';

interface TitleBarProps {
  onExtensionsClick: () => void;
  onClipLibraryClick?: () => Promise<void> | void;
  onSettingsClick: () => void;
  onCloseRequest?: () => Promise<void> | void;
  showBackButton?: boolean;
  onBackClick?: () => void;
}

export function TitleBar({
  onExtensionsClick,
  onClipLibraryClick,
  onSettingsClick,
  onCloseRequest,
  showBackButton,
  onBackClick,
}: TitleBarProps) {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useThemeStore();
  const [runtimeVersion, setRuntimeVersion] = useState<string>('');
  const clipLibraryPointerArmedRef = useRef(false);

  const appWindow = getCurrentWindow();
  const isMac =
    typeof navigator !== 'undefined'
    && /(Mac|iPhone|iPad|iPod)/i.test(`${navigator.platform} ${navigator.userAgent}`);

  useEffect(() => {
    let mounted = true;

    const loadVersion = async () => {
      try {
        const version = await getVersion();
        if (mounted) {
          setRuntimeVersion(version);
        }
      } catch {
        if (mounted) {
          setRuntimeVersion('');
        }
      }
    };

    void loadVersion();
    return () => {
      mounted = false;
    };
  }, []);

  const handleMinimize = useCallback(async () => {
    await appWindow.minimize();
  }, [appWindow]);

  const handleMaximize = useCallback(async () => {
    const isMaximized = await appWindow.isMaximized();
    if (isMaximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  }, [appWindow]);

  const handleClose = useCallback(async () => {
    if (onCloseRequest) {
      await onCloseRequest();
      return;
    }

    try {
      await appWindow.close();
    } catch (error) {
      console.error('Failed to request window close', error);

      try {
        await appWindow.destroy();
      } catch (destroyError) {
        console.error('Failed to force destroy window from title bar', destroyError);
      }
    }
  }, [appWindow, onCloseRequest]);

  const handleWindowControlMouseDown = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      action: () => Promise<void>,
    ) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void action();
    },
    [],
  );

  const handleWindowControlClick = useCallback(
    (
      event: ReactMouseEvent<HTMLButtonElement>,
      action: () => Promise<void>,
    ) => {
      // Mouse interactions are handled on mousedown so the first click on an
      // inactive undecorated window still works. Keep click for keyboard use.
      if (event.detail !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void action();
    },
    [],
  );

  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('button') || target?.closest('[data-no-drag="true"]')) {
      return;
    }
    await appWindow.startDragging();
  }, [appWindow]);

  const handleLanguageClick = useCallback(() => {
    const newLang = i18n.language.startsWith('zh') ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
  }, [i18n]);

  const handleThemeClick = useCallback(() => {
    toggleTheme();
  }, [toggleTheme]);

  const handleClipLibraryMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      clipLibraryPointerArmedRef.current = false;
      return;
    }

    clipLibraryPointerArmedRef.current = true;
  }, []);

  const handleClipLibraryClick = useCallback(async (event: ReactMouseEvent<HTMLButtonElement>) => {
    const isKeyboardTrigger = event.detail === 0;
    const isPointerTrigger = clipLibraryPointerArmedRef.current;
    clipLibraryPointerArmedRef.current = false;

    if (!isKeyboardTrigger && !isPointerTrigger) {
      return;
    }

    if (!onClipLibraryClick) {
      return;
    }

    try {
      await onClipLibraryClick();
    } catch (error) {
      console.error('Failed to open clip library from title bar', error);
      window.alert(t('titleBar.clipLibraryOpenFailed'));
    }
  }, [onClipLibraryClick, t]);

  return (
    <div className="relative z-50 flex h-10 shrink-0 items-center justify-between border-b border-border-dark bg-surface-dark select-none">
      {isMac ? (
        <div className="group flex items-center h-full pl-3 pr-2 gap-2" data-no-drag="true">
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleClose}
            className="relative flex h-3 w-3 items-center justify-center"
            title={t('titleBar.close')}
            aria-label={t('titleBar.close')}
          >
            <img src={closeNormalIcon} alt="" className="h-3 w-3 pointer-events-none opacity-100 transition-opacity group-hover:opacity-0" />
            <img src={closeHoverIcon} alt="" className="absolute h-3 w-3 pointer-events-none opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleMinimize}
            className="relative flex h-3 w-3 items-center justify-center"
            title={t('titleBar.minimize')}
            aria-label={t('titleBar.minimize')}
          >
            <img src={minimizeNormalIcon} alt="" className="h-3 w-3 pointer-events-none opacity-100 transition-opacity group-hover:opacity-0" />
            <img src={minimizeHoverIcon} alt="" className="absolute h-3 w-3 pointer-events-none opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleMaximize}
            className="relative flex h-3 w-3 items-center justify-center"
            title={t('titleBar.maximize')}
            aria-label={t('titleBar.maximize')}
          >
            <img src={maximizeNormalIcon} alt="" className="h-3 w-3 pointer-events-none opacity-100 transition-opacity group-hover:opacity-0" />
            <img src={maximizeHoverIcon} alt="" className="absolute h-3 w-3 pointer-events-none opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        </div>
      ) : null}

      <div
        className="flex-1 h-full flex items-center px-4 cursor-move"
        onMouseDown={handleDragStart}
      >
        {showBackButton && onBackClick && (
          <button
            type="button"
            data-no-drag="true"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onBackClick();
            }}
            className="mr-3 p-1 hover:bg-bg-dark rounded transition-colors"
            title={t('titleBar.back')}
          >
            <ArrowLeft className="w-4 h-4 text-text-muted hover:text-text-dark" />
          </button>
        )}
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={titlebarLogo}
            alt=""
            className="h-5 w-auto shrink-0 object-contain select-none"
            draggable={false}
          />
          {runtimeVersion ? (
            <span className="text-xs font-medium text-text-muted">
              v{runtimeVersion}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center h-full">
        <button
          type="button"
          onClick={handleLanguageClick}
          className="h-full px-3 hover:bg-bg-dark transition-colors"
          title={i18n.language.startsWith('zh') ? t('titleBar.switchToEnglish') : t('titleBar.switchToChinese')}
        >
          <Languages className="w-4 h-4 text-text-muted" />
        </button>

        <button
          type="button"
          onClick={handleThemeClick}
          className="h-full px-3 hover:bg-bg-dark transition-colors"
          title={theme === 'dark' ? t('theme.light') : t('theme.dark')}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-text-muted" />
          ) : (
            <Moon className="w-4 h-4 text-text-muted" />
          )}
        </button>

        <button
          type="button"
          onClick={onExtensionsClick}
          className="h-full px-3 hover:bg-bg-dark transition-colors"
          title={t('titleBar.extensions')}
        >
          <PackageOpen className="w-4 h-4 text-text-muted" />
        </button>

        <button
          type="button"
          onMouseDown={handleClipLibraryMouseDown}
          onMouseLeave={() => {
            clipLibraryPointerArmedRef.current = false;
          }}
          onClick={(event) => void handleClipLibraryClick(event)}
          className="h-full px-3 hover:bg-bg-dark transition-colors"
          title={t('titleBar.clipLibrary')}
        >
          <Film className="w-4 h-4 text-text-muted" />
        </button>

        <button
          type="button"
          onClick={onSettingsClick}
          className="h-full px-3 hover:bg-bg-dark transition-colors"
          title={t('settings.title')}
        >
          <Settings className="w-4 h-4 text-text-muted" />
        </button>

        {!isMac ? (
          <>
            <div className="w-px h-4 bg-border-dark mx-1" />

            <button
              type="button"
              onMouseDown={(event) =>
                handleWindowControlMouseDown(event, handleMinimize)
              }
              onClick={(event) =>
                handleWindowControlClick(event, handleMinimize)
              }
              className="h-full px-3 hover:bg-bg-dark transition-colors"
              title={t('titleBar.minimize')}
            >
              <Minus className="w-4 h-4 text-text-muted hover:text-text-dark" />
            </button>

            <button
              type="button"
              onMouseDown={(event) =>
                handleWindowControlMouseDown(event, handleMaximize)
              }
              onClick={(event) =>
                handleWindowControlClick(event, handleMaximize)
              }
              className="h-full px-3 hover:bg-bg-dark transition-colors"
              title={t('titleBar.maximize')}
            >
              <Maximize2 className="w-4 h-4 text-text-muted hover:text-text-dark" />
            </button>

            <button
              type="button"
              onMouseDown={(event) =>
                handleWindowControlMouseDown(event, handleClose)
              }
              onClick={(event) => handleWindowControlClick(event, handleClose)}
              className="h-full px-3 hover:bg-red-500 transition-colors group"
              title={t('titleBar.close')}
            >
              <X className="w-4 h-4 text-text-muted group-hover:text-white" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
