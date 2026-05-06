import { splitImageSource } from '@/commands/image';
import { createCurrentProjectMediaContext } from '@/features/canvas/application/mediaPersistenceContext';

import type { ImageSplitGateway } from '../application/ports';

export const tauriImageSplitGateway: ImageSplitGateway = {
  split: (imageSource, rows, cols, lineThickness, colRatios, rowRatios) =>
    splitImageSource(
      imageSource,
      rows,
      cols,
      lineThickness,
      colRatios,
      rowRatios,
      createCurrentProjectMediaContext('image')
    ),
};
