export interface PanoramaImageDataSource {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PanoramaPerspectiveRenderOptions {
  yaw: number;
  pitch: number;
  fov: number;
  targetWidth: number;
  targetHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function floorModulo(value: number, divisor: number): number {
  const result = value % divisor;
  return result < 0 ? result + divisor : result;
}

function sampleChannel(
  source: PanoramaImageDataSource,
  x: number,
  y: number,
  channel: number
): number {
  const clampedY = clamp(y, 0, source.height - 1);
  const xFloor = Math.floor(x);
  const yFloor = Math.floor(clampedY);
  const x0 = floorModulo(xFloor, source.width);
  const x1 = floorModulo(xFloor + 1, source.width);
  const y0 = yFloor;
  const y1 = Math.min(source.height - 1, yFloor + 1);
  const dx = x - xFloor;
  const dy = clampedY - yFloor;

  const offsetA = (y0 * source.width + x0) * 4 + channel;
  const offsetB = (y0 * source.width + x1) * 4 + channel;
  const offsetC = (y1 * source.width + x0) * 4 + channel;
  const offsetD = (y1 * source.width + x1) * 4 + channel;

  const top = source.data[offsetA] * (1 - dx) + source.data[offsetB] * dx;
  const bottom = source.data[offsetC] * (1 - dx) + source.data[offsetD] * dx;
  return top * (1 - dy) + bottom * dy;
}

export function renderPanoramaPerspective(
  source: PanoramaImageDataSource,
  options: PanoramaPerspectiveRenderOptions
): ImageData {
  const targetWidth = Math.max(1, Math.round(options.targetWidth));
  const targetHeight = Math.max(1, Math.round(options.targetHeight));
  const yaw = clamp(options.yaw, -180, 180) * (Math.PI / 180);
  const pitch = clamp(options.pitch, -89, 89) * (Math.PI / 180);
  const fov = clamp(options.fov, 30, 120) * (Math.PI / 180);
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);

  const halfFov = fov / 2;
  const tanHalf = Math.tan(halfFov);
  const aspect = targetWidth / targetHeight;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  let offset = 0;
  for (let py = 0; py < targetHeight; py += 1) {
    const normalizedY = 1 - ((py + 0.5) / targetHeight) * 2;
    for (let px = 0; px < targetWidth; px += 1) {
      const normalizedX = (((px + 0.5) / targetWidth) * 2 - 1) * aspect;

      let dirX = normalizedX * tanHalf;
      let dirY = normalizedY * tanHalf;
      let dirZ = 1;

      const length = Math.hypot(dirX, dirY, dirZ) || 1;
      dirX /= length;
      dirY /= length;
      dirZ /= length;

      const yawX = dirX * cosYaw + dirZ * sinYaw;
      const yawZ = -dirX * sinYaw + dirZ * cosYaw;

      const pitchY = dirY * cosPitch - yawZ * sinPitch;
      const pitchZ = dirY * sinPitch + yawZ * cosPitch;

      const lon = Math.atan2(yawX, pitchZ);
      const lat = Math.asin(clamp(pitchY, -1, 1));

      const sourceX = ((lon / (2 * Math.PI)) + 0.5) * (source.width - 1);
      const sourceY = (0.5 - lat / Math.PI) * (source.height - 1);

      output[offset] = Math.round(sampleChannel(source, sourceX, sourceY, 0));
      output[offset + 1] = Math.round(sampleChannel(source, sourceX, sourceY, 1));
      output[offset + 2] = Math.round(sampleChannel(source, sourceX, sourceY, 2));
      output[offset + 3] = Math.round(sampleChannel(source, sourceX, sourceY, 3));
      offset += 4;
    }
  }

  return new ImageData(output, targetWidth, targetHeight);
}
