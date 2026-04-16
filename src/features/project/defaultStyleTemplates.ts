import {
  sortStyleTemplates,
  type StyleTemplate,
} from '@/features/project/styleTemplateUtils';

export const PANORAMA_STYLE_TEMPLATE_ID = 'builtin-panorama-360';
export const PANORAMA_STYLE_TEMPLATE_NAME = '360 全景扩图';
export const PANORAMA_STYLE_TEMPLATE_PROMPT = `将输入图像扩展为360度VR全景图，等距柱状投影（equirectangular projection），完整环境补全，保持主体位置不变，向四周自然延展画面，生成无缝连接的全景空间，前后左右上下完整覆盖，空间结构合理，透视连续，光照统一，细节真实，沉浸式环境，真实空间深度，HDR，高动态范围，8K超高清，无明显拼接痕迹，无畸变断裂，环境逻辑合理，远近层次清晰，边缘无接缝，无拉伸，无重复纹理

负面提示词：接缝，拼接痕迹，画面断裂，透视错误，结构崩坏，物体重复，严重拉伸，边缘扭曲，模糊，低清晰度，畸变，不连续空间`;

interface PanoramaStyleTemplateSeedInput {
  styleTemplates: StyleTemplate[];
  hasInjectedPanoramaStyleTemplate: boolean;
  now?: number;
}

interface PanoramaStyleTemplateSeedResult {
  styleTemplates: StyleTemplate[];
  hasInjectedPanoramaStyleTemplate: boolean;
}

function matchesPanoramaTemplate(template: StyleTemplate): boolean {
  const normalizedName = template.name.trim();
  const normalizedPrompt = template.prompt.trim();

  return (
    template.id === PANORAMA_STYLE_TEMPLATE_ID
    || normalizedName === PANORAMA_STYLE_TEMPLATE_NAME
    || normalizedPrompt === PANORAMA_STYLE_TEMPLATE_PROMPT
  );
}

export function seedPanoramaStyleTemplate(
  input: PanoramaStyleTemplateSeedInput
): PanoramaStyleTemplateSeedResult {
  const { styleTemplates, hasInjectedPanoramaStyleTemplate } = input;
  if (hasInjectedPanoramaStyleTemplate) {
    return {
      styleTemplates,
      hasInjectedPanoramaStyleTemplate: true,
    };
  }

  if (styleTemplates.some(matchesPanoramaTemplate)) {
    return {
      styleTemplates,
      hasInjectedPanoramaStyleTemplate: true,
    };
  }

  const now = input.now ?? Date.now();
  const nextSortOrder = styleTemplates.reduce(
    (maxOrder, template) => Math.max(maxOrder, template.sortOrder),
    -1
  ) + 1;

  return {
    styleTemplates: sortStyleTemplates([
      ...styleTemplates,
      {
        id: PANORAMA_STYLE_TEMPLATE_ID,
        name: PANORAMA_STYLE_TEMPLATE_NAME,
        prompt: PANORAMA_STYLE_TEMPLATE_PROMPT,
        categoryId: null,
        sortOrder: nextSortOrder,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
      },
    ]),
    hasInjectedPanoramaStyleTemplate: true,
  };
}
