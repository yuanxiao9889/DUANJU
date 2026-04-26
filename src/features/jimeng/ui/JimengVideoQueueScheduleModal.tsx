import { useEffect, useMemo, useState } from "react";
import { Clock3, TimerReset } from "lucide-react";
import { useTranslation } from "react-i18next";

import { UiButton, UiInput, UiModal, UiSelect } from "@/components/ui";

interface JimengVideoQueueScheduleModalProps {
  isOpen: boolean;
  title: string;
  initialScheduledAt: number | null;
  onClose: () => void;
  onConfirm: (scheduledAt: number | null) => void;
  confirmLabel?: string;
}

const MIN_DELAY_MS = 60_000;
const NOW_TICK_MS = 30_000;
const TIME_STEP_MINUTES = 5;

function padDateTimeSegment(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    padDateTimeSegment(date.getMonth() + 1),
    padDateTimeSegment(date.getDate()),
  ].join("-");
}

function toHourInputValue(timestamp: number): string {
  return padDateTimeSegment(new Date(timestamp).getHours());
}

function toMinuteInputValue(timestamp: number): string {
  return padDateTimeSegment(new Date(timestamp).getMinutes());
}

function mergeDateAndTime(
  dateValue: string,
  hourValue: string,
  minuteValue: string,
): number | null {
  if (!dateValue.trim() || !hourValue.trim() || !minuteValue.trim()) {
    return null;
  }

  const timestamp = new Date(
    `${dateValue}T${hourValue}:${minuteValue}:00`,
  ).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function roundUpTimestamp(timestamp: number): number {
  const stepMs = TIME_STEP_MINUTES * 60_000;
  return Math.ceil(timestamp / stepMs) * stepMs;
}

function addMinutes(base: number, minutes: number): number {
  return roundUpTimestamp(base + minutes * 60_000);
}

function resolveNextTimestampAtTime(
  baseTimestamp: number,
  hour: number,
  minute = 0,
): number {
  const candidate = new Date(baseTimestamp);
  candidate.setHours(hour, minute, 0, 0);

  if (candidate.getTime() <= baseTimestamp + MIN_DELAY_MS) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.getTime();
}

function resolveTomorrowTimestamp(
  baseTimestamp: number,
  hour: number,
  minute = 0,
): number {
  const candidate = new Date(baseTimestamp);
  candidate.setDate(candidate.getDate() + 1);
  candidate.setHours(hour, minute, 0, 0);
  return candidate.getTime();
}

function formatSummaryTimestamp(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).format(new Date(timestamp));
}

function formatDelayText(
  delayMs: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const delayMinutes = Math.max(1, Math.ceil(delayMs / 60_000));
  if (delayMinutes < 60) {
    return t("jimengQueue.schedule.delayMinutes", {
      count: delayMinutes,
    });
  }

  const hours = Math.floor(delayMinutes / 60);
  const minutes = delayMinutes % 60;
  if (minutes === 0) {
    return t("jimengQueue.schedule.delayHours", { count: hours });
  }

  return t("jimengQueue.schedule.delayHoursMinutes", {
    hours,
    minutes,
  });
}

export function JimengVideoQueueScheduleModal({
  isOpen,
  title,
  initialScheduledAt,
  onClose,
  onConfirm,
  confirmLabel,
}: JimengVideoQueueScheduleModalProps) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<"immediate" | "scheduled">("immediate");
  const [dateValue, setDateValue] = useState("");
  const [hourValue, setHourValue] = useState("");
  const [minuteValue, setMinuteValue] = useState("");
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const currentNow = Date.now();
    setNowTimestamp(currentNow);

    const minimumTimestamp = roundUpTimestamp(currentNow + MIN_DELAY_MS);
    const normalizedTimestamp =
      typeof initialScheduledAt === "number" &&
      Number.isFinite(initialScheduledAt) &&
      initialScheduledAt > currentNow
        ? roundUpTimestamp(initialScheduledAt)
        : minimumTimestamp;
    const hasScheduledTime =
      typeof initialScheduledAt === "number" &&
      Number.isFinite(initialScheduledAt) &&
      initialScheduledAt > currentNow;

    setMode(hasScheduledTime ? "scheduled" : "immediate");
    setDateValue(toDateInputValue(normalizedTimestamp));
    setHourValue(toHourInputValue(normalizedTimestamp));
    setMinuteValue(toMinuteInputValue(normalizedTimestamp));
  }, [initialScheduledAt, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const timerId = window.setInterval(() => {
      setNowTimestamp(Date.now());
    }, NOW_TICK_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [isOpen]);

  const minimumTimestamp = useMemo(
    () => roundUpTimestamp(nowTimestamp + MIN_DELAY_MS),
    [nowTimestamp],
  );
  const minimumDateValue = useMemo(
    () => toDateInputValue(minimumTimestamp),
    [minimumTimestamp],
  );
  const timezoneLabel = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const hourOptions = useMemo(
    () =>
      Array.from({ length: 24 }, (_, index) => {
        const value = padDateTimeSegment(index);
        return { value, label: value };
      }),
    [],
  );
  const minuteOptions = useMemo(
    () =>
      Array.from({ length: 60 / TIME_STEP_MINUTES }, (_, index) => {
        const value = padDateTimeSegment(index * TIME_STEP_MINUTES);
        return { value, label: value };
      }),
    [],
  );

  const parsedScheduledAt = useMemo(
    () => mergeDateAndTime(dateValue, hourValue, minuteValue),
    [dateValue, hourValue, minuteValue],
  );
  const isScheduleInvalid =
    mode === "scheduled" &&
    (!parsedScheduledAt || parsedScheduledAt < minimumTimestamp);
  const summaryText =
    parsedScheduledAt && parsedScheduledAt >= minimumTimestamp
      ? formatSummaryTimestamp(parsedScheduledAt, i18n.language)
      : null;
  const minimumSummaryText = useMemo(
    () => formatSummaryTimestamp(minimumTimestamp, i18n.language),
    [i18n.language, minimumTimestamp],
  );
  const relativeDelayText =
    parsedScheduledAt && parsedScheduledAt >= minimumTimestamp
      ? formatDelayText(parsedScheduledAt - nowTimestamp, t)
      : null;

  const applyScheduledTimestamp = (timestamp: number) => {
    const resolvedTimestamp = roundUpTimestamp(
      Math.max(timestamp, minimumTimestamp),
    );
    setMode("scheduled");
    setDateValue(toDateInputValue(resolvedTimestamp));
    setHourValue(toHourInputValue(resolvedTimestamp));
    setMinuteValue(toMinuteInputValue(resolvedTimestamp));
  };

  const adjustScheduledTimestamp = (deltaMinutes: number) => {
    const baseTimestamp =
      parsedScheduledAt && parsedScheduledAt >= minimumTimestamp
        ? parsedScheduledAt
        : minimumTimestamp;
    applyScheduledTimestamp(baseTimestamp + deltaMinutes * 60_000);
  };

  const quickActions = useMemo(
    () => [
      {
        key: "10m",
        label: t("jimengQueue.schedule.quick.in10Minutes"),
        timestamp: addMinutes(nowTimestamp, 10),
      },
      {
        key: "30m",
        label: t("jimengQueue.schedule.quick.in30Minutes"),
        timestamp: addMinutes(nowTimestamp, 30),
      },
      {
        key: "60m",
        label: t("jimengQueue.schedule.quick.in1Hour"),
        timestamp: addMinutes(nowTimestamp, 60),
      },
      {
        key: "tonight",
        label: t("jimengQueue.schedule.quick.tonight"),
        timestamp: resolveNextTimestampAtTime(nowTimestamp, 20, 0),
      },
      {
        key: "night2am",
        label: t("jimengQueue.schedule.quick.tonight2am"),
        timestamp: resolveNextTimestampAtTime(nowTimestamp, 2, 0),
      },
      {
        key: "night3am",
        label: t("jimengQueue.schedule.quick.tonight3am"),
        timestamp: resolveNextTimestampAtTime(nowTimestamp, 3, 0),
      },
      {
        key: "tomorrowMorning",
        label: t("jimengQueue.schedule.quick.tomorrowMorning"),
        timestamp: resolveTomorrowTimestamp(nowTimestamp, 9, 0),
      },
      {
        key: "tomorrowNight",
        label: t("jimengQueue.schedule.quick.tomorrowNight"),
        timestamp: resolveTomorrowTimestamp(nowTimestamp, 20, 0),
      },
    ],
    [nowTimestamp, t],
  );

  return (
    <UiModal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      widthClassName="w-[calc(100vw-32px)] max-w-[560px]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <UiButton type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            disabled={isScheduleInvalid}
            onClick={() =>
              onConfirm(mode === "scheduled" ? parsedScheduledAt : null)
            }
          >
            {confirmLabel ?? t("common.confirm")}
          </UiButton>
        </div>
      }
    >
      <div className="ui-scrollbar max-h-[72vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`rounded-xl border px-3 py-3 text-left transition-colors ${
              mode === "immediate"
                ? "border-accent/40 bg-accent/12 text-text-dark"
                : "border-white/10 bg-white/[0.03] text-text-muted hover:bg-white/[0.05]"
            }`}
            onClick={() => setMode("immediate")}
          >
            <div className="text-sm font-medium">
              {t("jimengQueue.schedule.immediateTitle")}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {t("jimengQueue.schedule.immediateDescription")}
            </div>
          </button>
          <button
            type="button"
            className={`rounded-xl border px-3 py-3 text-left transition-colors ${
              mode === "scheduled"
                ? "border-accent/40 bg-accent/12 text-text-dark"
                : "border-white/10 bg-white/[0.03] text-text-muted hover:bg-white/[0.05]"
            }`}
            onClick={() => setMode("scheduled")}
          >
            <div className="text-sm font-medium">
              {t("jimengQueue.schedule.scheduledTitle")}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {t("jimengQueue.schedule.scheduledDescription")}
            </div>
          </button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/10 p-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
            <TimerReset className="h-3.5 w-3.5" />
            {t("jimengQueue.schedule.quickTitle")}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <button
                key={action.key}
                type="button"
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-text-dark transition-colors hover:border-accent/30 hover:bg-accent/10"
                onClick={() => applyScheduledTimestamp(action.timestamp)}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
              {t("jimengQueue.schedule.adjustTitle")}
            </div>
            <div className="text-[11px] text-text-muted">
              {t("jimengQueue.schedule.minimumHint", {
                time: minimumSummaryText,
              })}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1.2fr_0.85fr_0.85fr]">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t("jimengQueue.schedule.dateLabel")}
              </label>
              <UiInput
                type="date"
                value={dateValue}
                disabled={mode !== "scheduled"}
                min={minimumDateValue}
                onChange={(event) => {
                  setMode("scheduled");
                  setDateValue(event.target.value);
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t("jimengQueue.schedule.hourLabel")}
              </label>
              <UiSelect
                value={hourValue}
                disabled={mode !== "scheduled"}
                onChange={(event) => {
                  setMode("scheduled");
                  setHourValue(event.target.value);
                }}
              >
                {hourOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </UiSelect>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t("jimengQueue.schedule.minuteLabel")}
              </label>
              <UiSelect
                value={minuteValue}
                disabled={mode !== "scheduled"}
                onChange={(event) => {
                  setMode("scheduled");
                  setMinuteValue(event.target.value);
                }}
              >
                {minuteOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </UiSelect>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <UiButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={mode !== "scheduled"}
              onClick={() => adjustScheduledTimestamp(-15)}
            >
              {t("jimengQueue.schedule.minus15Minutes")}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="ghost"
              disabled={mode !== "scheduled"}
              onClick={() => adjustScheduledTimestamp(15)}
            >
              {t("jimengQueue.schedule.plus15Minutes")}
            </UiButton>
            <UiButton
              type="button"
              size="sm"
              variant="muted"
              onClick={() => applyScheduledTimestamp(minimumTimestamp)}
            >
              {t("jimengQueue.schedule.useEarliest")}
            </UiButton>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-text-dark">
            <Clock3 className="h-4 w-4 text-text-muted" />
            {mode === "scheduled"
              ? t("jimengQueue.schedule.summaryTitle")
              : t("jimengQueue.schedule.immediateTitle")}
          </div>

          <div className="mt-2 text-sm text-text-muted">
            {mode === "scheduled"
              ? summaryText
                ? t("jimengQueue.schedule.summaryValue", {
                    time: summaryText,
                    timezone: timezoneLabel,
                  })
                : t("jimengQueue.schedule.timeInvalid")
              : t("jimengQueue.schedule.immediateHint")}
          </div>

          {mode === "scheduled" ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-muted">
              {relativeDelayText ? (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                  {relativeDelayText}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                {timezoneLabel}
              </span>
            </div>
          ) : null}
        </div>

        <p className="text-xs text-text-muted">
          {mode === "scheduled"
            ? isScheduleInvalid
              ? t("jimengQueue.schedule.timeInvalid")
              : t("jimengQueue.schedule.timeHint")
            : t("jimengQueue.schedule.immediateHint")}
        </p>
      </div>
    </UiModal>
  );
}
