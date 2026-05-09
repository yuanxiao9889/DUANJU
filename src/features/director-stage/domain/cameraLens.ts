export const DIRECTOR_STAGE_FOCAL_LENGTH_MIN = 18;
export const DIRECTOR_STAGE_FOCAL_LENGTH_MAX = 135;
export const DIRECTOR_STAGE_DEFAULT_FOCAL_LENGTH = 50;
export const DIRECTOR_STAGE_FOCAL_LENGTH_PRESETS = [18, 24, 35, 50, 85, 135] as const;

const DIRECTOR_STAGE_FOV_MIN = 18;
const DIRECTOR_STAGE_FOV_MAX = 90;

const FOCAL_LENGTH_FOV_POINTS = [
  { focalLengthMm: 18, fov: 78 },
  { focalLengthMm: 24, fov: 66 },
  { focalLengthMm: 35, fov: 50 },
  { focalLengthMm: 50, fov: 38 },
  { focalLengthMm: 85, fov: 24 },
  { focalLengthMm: 135, fov: 18 },
] as const;

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  const numericValue = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numericValue));
}

function roundToPrecision(value: number, precision = 100): number {
  return Math.round(value * precision) / precision;
}

export function clampDirectorStageFocalLength(
  value: number,
  fallback = DIRECTOR_STAGE_DEFAULT_FOCAL_LENGTH
): number {
  return Math.round(
    clampNumber(value, DIRECTOR_STAGE_FOCAL_LENGTH_MIN, DIRECTOR_STAGE_FOCAL_LENGTH_MAX, fallback)
  );
}

export function focalLengthToFov(value: number): number {
  const focalLength = clampDirectorStageFocalLength(value);
  for (let index = 0; index < FOCAL_LENGTH_FOV_POINTS.length - 1; index += 1) {
    const left = FOCAL_LENGTH_FOV_POINTS[index];
    const right = FOCAL_LENGTH_FOV_POINTS[index + 1];
    if (focalLength >= left.focalLengthMm && focalLength <= right.focalLengthMm) {
      const ratio = (focalLength - left.focalLengthMm) / (right.focalLengthMm - left.focalLengthMm);
      return roundToPrecision(left.fov + (right.fov - left.fov) * ratio);
    }
  }
  return FOCAL_LENGTH_FOV_POINTS[FOCAL_LENGTH_FOV_POINTS.length - 1].fov;
}

export function fovToFocalLength(value: number): number {
  const fov = clampNumber(value, DIRECTOR_STAGE_FOV_MIN, DIRECTOR_STAGE_FOV_MAX, focalLengthToFov(DIRECTOR_STAGE_DEFAULT_FOCAL_LENGTH));
  if (fov >= FOCAL_LENGTH_FOV_POINTS[0].fov) {
    return FOCAL_LENGTH_FOV_POINTS[0].focalLengthMm;
  }
  const lastPoint = FOCAL_LENGTH_FOV_POINTS[FOCAL_LENGTH_FOV_POINTS.length - 1];
  if (fov <= lastPoint.fov) {
    return lastPoint.focalLengthMm;
  }

  for (let index = 0; index < FOCAL_LENGTH_FOV_POINTS.length - 1; index += 1) {
    const left = FOCAL_LENGTH_FOV_POINTS[index];
    const right = FOCAL_LENGTH_FOV_POINTS[index + 1];
    if (fov <= left.fov && fov >= right.fov) {
      const ratio = (left.fov - fov) / (left.fov - right.fov);
      return clampDirectorStageFocalLength(
        left.focalLengthMm + (right.focalLengthMm - left.focalLengthMm) * ratio
      );
    }
  }

  return DIRECTOR_STAGE_DEFAULT_FOCAL_LENGTH;
}

export function normalizeCameraShotLens(value: {
  fov?: unknown;
  focalLengthMm?: unknown;
}): { fov: number; focalLengthMm: number } {
  const rawFov = typeof value.fov === 'number' && Number.isFinite(value.fov) ? value.fov : 42;
  if (typeof value.focalLengthMm === 'number' && Number.isFinite(value.focalLengthMm)) {
    const focalLengthMm = clampDirectorStageFocalLength(value.focalLengthMm);
    return {
      focalLengthMm,
      fov: focalLengthToFov(focalLengthMm),
    };
  }

  const fov = roundToPrecision(clampNumber(rawFov, DIRECTOR_STAGE_FOV_MIN, DIRECTOR_STAGE_FOV_MAX, 42));
  return {
    fov,
    focalLengthMm: fovToFocalLength(fov),
  };
}
