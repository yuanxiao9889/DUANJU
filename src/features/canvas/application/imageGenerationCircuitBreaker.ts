import i18n from "@/i18n";

const IMAGE_GENERATION_SUBMIT_WINDOW_MS = 5_000;
const IMAGE_GENERATION_SUBMIT_LIMIT = 20;
const IMAGE_GENERATION_BREAKER_COOLDOWN_MS = 30_000;

let submitTimestamps: number[] = [];
let breakerOpenUntil = 0;

function formatSeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1000));
}

export function assertCanSubmitImageGenerationJob(now = Date.now()): void {
  if (breakerOpenUntil > now) {
    throw new Error(
      i18n.t("errorLog.circuitBreakerOpen", {
        seconds: formatSeconds(breakerOpenUntil - now),
      }),
    );
  }

  submitTimestamps = submitTimestamps.filter(
    (timestamp) => now - timestamp <= IMAGE_GENERATION_SUBMIT_WINDOW_MS,
  );

  if (submitTimestamps.length >= IMAGE_GENERATION_SUBMIT_LIMIT) {
    breakerOpenUntil = now + IMAGE_GENERATION_BREAKER_COOLDOWN_MS;
    submitTimestamps = [];
    throw new Error(
      i18n.t("errorLog.circuitBreakerOpen", {
        seconds: formatSeconds(IMAGE_GENERATION_BREAKER_COOLDOWN_MS),
      }),
    );
  }

  submitTimestamps.push(now);
}
