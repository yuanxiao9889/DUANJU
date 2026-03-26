import { useCallback, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, X, Maximize2, Settings, ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Languages } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { useProjectStore } from '@/stores/projectStore';
import { resolveErrorContent, showErrorDialog } from '@/features/canvas/application/errorDialog';
import { focusJimengChromeWorkspace } from '@/features/jimeng/application/jimengChromeWorkspace';
import closeNormalIcon from '@/assets/macos-traffic-lights/1-close-1-normal.svg';
import closeHoverIcon from '@/assets/macos-traffic-lights/2-close-2-hover.svg';
import minimizeNormalIcon from '@/assets/macos-traffic-lights/2-minimize-1-normal.svg';
import minimizeHoverIcon from '@/assets/macos-traffic-lights/2-minimize-2-hover.svg';
import maximizeNormalIcon from '@/assets/macos-traffic-lights/3-maximize-1-normal.svg';
import maximizeHoverIcon from '@/assets/macos-traffic-lights/3-maximize-2-hover.svg';

interface TitleBarProps {
  onSettingsClick: () => void;
  showBackButton?: boolean;
  onBackClick?: () => void;
}

export function TitleBar({
  onSettingsClick,
  showBackButton,
  onBackClick,
}: TitleBarProps) {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useThemeStore();
  const currentProjectName = useProjectStore((state) => state.currentProject?.name);
  const [runtimeVersion, setRuntimeVersion] = useState<string>('');
  const [isJimengBusy, setIsJimengBusy] = useState(false);
  const [hasOpenedJimengChrome, setHasOpenedJimengChrome] = useState(false);

  const appWindow = getCurrentWindow();
  const isZh = i18n.language.startsWith('zh');
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

  const appTitle = runtimeVersion ? `${t('app.title')} v${runtimeVersion}` : t('app.title');
  const titleText = currentProjectName ? `${currentProjectName} - ${appTitle}` : appTitle;

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
    await appWindow.close();
  }, [appWindow]);

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

  const handleOpenJimengChrome = useCallback(async () => {
    if (isJimengBusy) {
      return;
    }

    setIsJimengBusy(true);
    try {
      await focusJimengChromeWorkspace();
      setHasOpenedJimengChrome(true);
    } catch (error) {
      const content = resolveErrorContent(error, t('titleBar.jimengOpenFailed'));
      const isChromeMissing = content.message.includes('Chrome/Chromium was not found');

      await showErrorDialog(
        isChromeMissing ? t('titleBar.jimengChromeMissing') : content.message,
        t('common.error'),
        isChromeMissing ? content.message : content.details
      );
    } finally {
      setIsJimengBusy(false);
    }
  }, [isJimengBusy, t]);

  const jimengButtonTitle = isJimengBusy
    ? t('titleBar.jimengOpeningChrome')
    : t('titleBar.jimengOpenChrome');

  return (
    <div className="h-10 flex items-center justify-between bg-surface-dark border-b border-border-dark select-none z-50 relative">
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
        <span className="text-sm font-semibold text-text-dark">
          {titleText}
        </span>
        {!isZh && !currentProjectName ? (
          <span className="text-xs text-text-muted ml-2">{t('app.subtitle')}</span>
        ) : null}
      </div>

      {/* 右侧按钮区域 */}
      <div className="flex items-center h-full">
        <button
          type="button"
          onClick={() => {
            void handleOpenJimengChrome();
          }}
          disabled={isJimengBusy}
          className={`h-full px-3 transition-colors ${isJimengBusy ? 'cursor-wait opacity-70' : 'hover:bg-bg-dark'} ${hasOpenedJimengChrome ? 'bg-bg-dark/60' : ''}`}
          title={jimengButtonTitle}
          aria-label={jimengButtonTitle}
          aria-pressed={hasOpenedJimengChrome}
        >
          <span className="inline-flex items-center gap-2 text-xs font-medium text-text-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full transition-colors ${hasOpenedJimengChrome ? 'bg-[rgb(var(--accent-rgb))]' : 'bg-border-dark'}`}
              aria-hidden="true"
            />
            <span>{t('titleBar.jimengPanel')}</span>
          </span>
        </button>

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
              onClick={handleMinimize}
              className="h-full px-3 hover:bg-bg-dark transition-colors"
              title={t('titleBar.minimize')}
            >
              <Minus className="w-4 h-4 text-text-muted hover:text-text-dark" />
            </button>

            <button
              type="button"
              onClick={handleMaximize}
              className="h-full px-3 hover:bg-bg-dark transition-colors"
              title={t('titleBar.maximize')}
            >
              <Maximize2 className="w-4 h-4 text-text-muted hover:text-text-dark" />
            </button>

            <button
              type="button"
              onClick={handleClose}
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
