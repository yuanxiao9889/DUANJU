import { useTranslation } from 'react-i18next';

import { UiButton, UiModal } from '@/components/ui';

const OOPII_URL = 'https://www.oopii.cc/';
const OOPII_QQ_GROUP_URL = 'https://qm.qq.com/q/TcWYG0Ri0w';
const OOPII_QQ_GROUP = '835213642';

interface ApiPlatformNoticeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAcknowledge: () => void;
}

export function ApiPlatformNoticeDialog({
  isOpen,
  onClose,
  onAcknowledge,
}: ApiPlatformNoticeDialogProps) {
  const { t } = useTranslation();

  return (
    <UiModal
      isOpen={isOpen}
      title={t('settings.apiPlatformNoticeTitle')}
      onClose={onClose}
      widthClassName="w-[760px]"
      draggable={false}
      bodyClassName="p-0"
      footer={(
        <>
          <UiButton variant="muted" size="sm" onClick={onClose}>
            {t('common.close')}
          </UiButton>
          <UiButton variant="primary" size="sm" onClick={onAcknowledge}>
            {t('settings.apiPlatformNoticeAcknowledge')}
          </UiButton>
        </>
      )}
    >
      <div className="ui-scrollbar max-h-[calc(100vh-180px)] overflow-y-auto px-5 py-5">
        <div className="space-y-4">
          <div className="space-y-2 text-[13px] leading-6 text-text-dark">
            <p className="whitespace-pre-line text-text-muted">
              {t('settings.apiPlatformNoticeBody', {
                oopiiUrl: OOPII_URL,
                qqGroup: OOPII_QQ_GROUP,
              })}
            </p>
          </div>

          <div className="rounded-lg border border-border-dark bg-bg-dark p-4">
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-text-muted">{t('settings.apiPlatformNoticeWebsiteLabel')}:</span>
                <a
                  href={OOPII_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-accent hover:underline"
                >
                  {OOPII_URL}
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-text-muted">{t('settings.apiPlatformNoticeQqLabel')}:</span>
                <span className="text-text-dark">{OOPII_QQ_GROUP}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-text-muted">{t('settings.apiPlatformNoticeJoinGroupLabel')}:</span>
                <a
                  href={OOPII_QQ_GROUP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-accent hover:underline"
                >
                  {t('settings.apiPlatformNoticeJoinGroupLinkText')}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </UiModal>
  );
}
