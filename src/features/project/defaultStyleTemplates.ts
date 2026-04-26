import characterThreeViewImage from '@/assets/style-templates/character-three-view.jpg';
import cinematicAtmosphereImage from '@/assets/style-templates/cinematic-atmosphere.jpg';
import mechaMaterialEnhanceImage from '@/assets/style-templates/mecha-material-enhance.jpg';
import panorama360Image from '@/assets/style-templates/panorama-360.jpg';
import {
  sortStyleTemplates,
  type StyleTemplate,
} from '@/features/project/styleTemplateUtils';

export const PANORAMA_STYLE_TEMPLATE_ID = 'builtin-panorama-360';
export const CINEMATIC_ATMOSPHERE_STYLE_TEMPLATE_ID =
  'builtin-cinematic-atmosphere';
export const CHARACTER_THREE_VIEW_STYLE_TEMPLATE_ID =
  'builtin-character-three-view';
export const MECHA_MATERIAL_STYLE_TEMPLATE_ID =
  'builtin-mecha-material-enhance';

export const PANORAMA_STYLE_TEMPLATE_NAME = '360 全景扩图';
export const PANORAMA_STYLE_TEMPLATE_PROMPT = `将输入图像扩展为360度VR全景图，等距柱状投影（equirectangular projection），完整环境补全，保持主体位置不变，向四周自然延展画面，生成无缝连接的全景空间，前后左右上下完整覆盖，空间结构合理，透视连续，光照统一，细节真实，沉浸式环境，真实空间深度，HDR，高动态范围，8K超高清，无明显拼接痕迹，无畸变断裂，环境逻辑合理，远近层次清晰，边缘无接缝，无拉伸，无重复纹理

负面提示词：接缝，拼接痕迹，画面断裂，透视错误，结构崩坏，物体重复，严重拉伸，边缘扭曲，模糊，低清晰度，畸变，不连续空间`;

export const CINEMATIC_ATMOSPHERE_STYLE_TEMPLATE_NAME = '电影氛围增强';
export const CINEMATIC_ATMOSPHERE_STYLE_TEMPLATE_PROMPT = `电影级画面氛围，cinematic lighting（电影布光），光影有戏而非平铺直叙，haze / 雾霾让空间柔和、有深度并带颗粒感，高反差（high contrast）让亮暗关系更清晰明了，sparks / 火花增加动感，volumetric smoke / fog（带体积感的烟雾/雾气）让光线有路径、空间有厚度，氛围感控制精准，每一个效果都有理由，整体沉浸、写实、专业、高清、适合影视大片级别画面`;

export const CHARACTER_THREE_VIEW_STYLE_TEMPLATE_NAME = '三视图';
export const CHARACTER_THREE_VIEW_STYLE_TEMPLATE_PROMPT = `写实风格，影视定妆照风格，白色背景，人物正面、侧面、背面三视图以及头像特写，展示完整身体比例和面部特征，光线柔和自然，衣着完整，发型发色清晰可见，面部表情自然，细节精致，高清质感，适合人物设定参考，突出头发、五官、衣服和身体轮廓，每个视角统一风格，清晰、精确、专业、可用于三视图设定`;

export const MECHA_MATERIAL_STYLE_TEMPLATE_NAME = '机甲材质加强';
export const MECHA_MATERIAL_STYLE_TEMPLATE_PROMPT = `PBR材质强化，真实金属装甲喷涂，带清漆层 clearcoat 反射和精确菲涅尔 Fresnel 效果，面板粗糙度符合物理逻辑（不均匀、面板与面板有差异），微观表面纹理精细（轻微橘皮感、细小划痕、淡淡擦拭痕迹），污垢与灰尘仅存在于缝隙与关节，边缘磨损沿现有边缘出现，增强缝隙环境遮蔽 AO 和接触阴影，改进全局光照 GI 与真实高光滚降（电影化 HDR / ACES 色调映射），细微胶片颗粒与轻微暈光 halation，保持写实风格，不进行风格化处理`;

interface BuiltinStyleTemplateDefinition {
  id: string;
  name: string;
  prompt: string;
  imageUrl: string | null;
  categoryId: string | null;
}

interface BundledBuiltinStyleTemplateInput {
  id: string;
  name: string;
  prompt: string;
  imageAssetUrl: string;
  categoryId?: string | null;
}

// New system-recommended templates should:
// 1. import their preview from '@/assets/style-templates/...'
// 2. add that import to BUILTIN_STYLE_TEMPLATE_IMAGE_ASSETS
// 3. register through defineBundledBuiltinStyleTemplate(...)
//
// This keeps preview images in the Vite module graph so Tauri installers
// always include them on new machines.
const BUILTIN_STYLE_TEMPLATE_IMAGE_ASSETS = {
  panorama360: panorama360Image,
  cinematicAtmosphere: cinematicAtmosphereImage,
  characterThreeView: characterThreeViewImage,
  mechaMaterialEnhance: mechaMaterialEnhanceImage,
} as const;
const BUILTIN_STYLE_TEMPLATE_IMAGE_PREFIXES = [
  '/assets/',
  './assets/',
  'assets/',
  '/src/assets/',
  './src/assets/',
  'src/assets/',
  '/style-templates/',
  './style-templates/',
  'style-templates/',
] as const;

function defineBundledBuiltinStyleTemplate(
  input: BundledBuiltinStyleTemplateInput
): BuiltinStyleTemplateDefinition {
  return {
    id: input.id,
    name: input.name,
    prompt: input.prompt,
    imageUrl: input.imageAssetUrl,
    categoryId: input.categoryId ?? null,
  };
}

const BUILTIN_STYLE_TEMPLATE_DEFINITIONS: readonly BuiltinStyleTemplateDefinition[] = [
  defineBundledBuiltinStyleTemplate({
    id: PANORAMA_STYLE_TEMPLATE_ID,
    name: PANORAMA_STYLE_TEMPLATE_NAME,
    prompt: PANORAMA_STYLE_TEMPLATE_PROMPT,
    imageAssetUrl: BUILTIN_STYLE_TEMPLATE_IMAGE_ASSETS.panorama360,
  }),
  defineBundledBuiltinStyleTemplate({
    id: CINEMATIC_ATMOSPHERE_STYLE_TEMPLATE_ID,
    name: CINEMATIC_ATMOSPHERE_STYLE_TEMPLATE_NAME,
    prompt: CINEMATIC_ATMOSPHERE_STYLE_TEMPLATE_PROMPT,
    imageAssetUrl: BUILTIN_STYLE_TEMPLATE_IMAGE_ASSETS.cinematicAtmosphere,
  }),
  defineBundledBuiltinStyleTemplate({
    id: CHARACTER_THREE_VIEW_STYLE_TEMPLATE_ID,
    name: CHARACTER_THREE_VIEW_STYLE_TEMPLATE_NAME,
    prompt: CHARACTER_THREE_VIEW_STYLE_TEMPLATE_PROMPT,
    imageAssetUrl: BUILTIN_STYLE_TEMPLATE_IMAGE_ASSETS.characterThreeView,
  }),
  defineBundledBuiltinStyleTemplate({
    id: MECHA_MATERIAL_STYLE_TEMPLATE_ID,
    name: MECHA_MATERIAL_STYLE_TEMPLATE_NAME,
    prompt: MECHA_MATERIAL_STYLE_TEMPLATE_PROMPT,
    imageAssetUrl: BUILTIN_STYLE_TEMPLATE_IMAGE_ASSETS.mechaMaterialEnhance,
  }),
];

interface BuiltinStyleTemplateSeedInput {
  styleTemplates: StyleTemplate[];
  hasInjectedPanoramaStyleTemplate: boolean;
  now?: number;
}

interface BuiltinStyleTemplateSeedResult {
  styleTemplates: StyleTemplate[];
  hasInjectedPanoramaStyleTemplate: boolean;
}

function normalizeTemplateImageUrl(imageUrl: string | null | undefined): string | null {
  if (typeof imageUrl !== 'string') {
    return null;
  }

  const trimmedImageUrl = imageUrl.trim();
  return trimmedImageUrl.length > 0 ? trimmedImageUrl : null;
}

function isBundledStyleTemplatePreviewUrl(imageUrl: string): boolean {
  const trimmedImageUrl = imageUrl.trim();
  if (!trimmedImageUrl) {
    return false;
  }

  const normalizedPathCandidate = (() => {
    try {
      return new URL(trimmedImageUrl).pathname;
    } catch {
      return trimmedImageUrl;
    }
  })();

  return BUILTIN_STYLE_TEMPLATE_IMAGE_PREFIXES.some((prefix) =>
    normalizedPathCandidate.startsWith(prefix)
  );
}

function resolveBuiltinTemplateImageUrl(
  builtinTemplate: BuiltinStyleTemplateDefinition,
  matchedTemplate: StyleTemplate | null
): string | null {
  const matchedImageUrl = normalizeTemplateImageUrl(matchedTemplate?.imageUrl);
  if (!matchedImageUrl) {
    return normalizeTemplateImageUrl(builtinTemplate.imageUrl);
  }

  // Upgrade previously persisted bundled SVG placeholders to the current
  // bundled raster previews while still preserving real user-local images.
  if (isBundledStyleTemplatePreviewUrl(matchedImageUrl)) {
    return normalizeTemplateImageUrl(builtinTemplate.imageUrl);
  }

  return matchedImageUrl;
}

function getBuiltinStyleTemplateMatchScore(
  template: StyleTemplate,
  builtinTemplate: BuiltinStyleTemplateDefinition
): number {
  if (template.id === builtinTemplate.id) {
    return 3;
  }

  if (template.prompt.trim() === builtinTemplate.prompt) {
    return 2;
  }

  if (template.name.trim() === builtinTemplate.name) {
    return 1;
  }

  return 0;
}

function findBuiltinStyleTemplateMatch(
  styleTemplates: StyleTemplate[],
  builtinTemplate: BuiltinStyleTemplateDefinition,
  consumedTemplateIds: Set<string>
): StyleTemplate | null {
  let bestMatch: StyleTemplate | null = null;
  let bestScore = 0;

  for (const template of styleTemplates) {
    if (consumedTemplateIds.has(template.id)) {
      continue;
    }

    const score = getBuiltinStyleTemplateMatchScore(template, builtinTemplate);
    if (score > bestScore) {
      bestMatch = template;
      bestScore = score;
      if (score === 3) {
        break;
      }
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

function createBuiltinStyleTemplate(
  builtinTemplate: BuiltinStyleTemplateDefinition,
  matchedTemplate: StyleTemplate | null,
  fallbackSortOrder: number
): StyleTemplate {
  const createdAt = matchedTemplate?.createdAt ?? fallbackSortOrder;
  const updatedAt = matchedTemplate?.updatedAt ?? createdAt;

  return {
    id: builtinTemplate.id,
    name: matchedTemplate?.name.trim() || builtinTemplate.name,
    prompt: matchedTemplate?.prompt.trim() || builtinTemplate.prompt,
    imageUrl: resolveBuiltinTemplateImageUrl(builtinTemplate, matchedTemplate),
    categoryId: matchedTemplate?.categoryId ?? builtinTemplate.categoryId,
    sortOrder: matchedTemplate?.sortOrder ?? fallbackSortOrder,
    createdAt,
    updatedAt,
    lastUsedAt: matchedTemplate?.lastUsedAt ?? null,
  };
}

export function seedBuiltinStyleTemplates(
  input: BuiltinStyleTemplateSeedInput
): BuiltinStyleTemplateSeedResult {
  const consumedTemplateIds = new Set<string>();

  const builtinTemplates = BUILTIN_STYLE_TEMPLATE_DEFINITIONS.map(
    (builtinTemplate, index) => {
      const matchedTemplate = findBuiltinStyleTemplateMatch(
        input.styleTemplates,
        builtinTemplate,
        consumedTemplateIds
      );

      if (matchedTemplate) {
        consumedTemplateIds.add(matchedTemplate.id);
      }

      return createBuiltinStyleTemplate(
        builtinTemplate,
        matchedTemplate,
        index
      );
    }
  );

  const remainingTemplates = input.styleTemplates.filter(
    (template) => !consumedTemplateIds.has(template.id)
  );

  return {
    styleTemplates: sortStyleTemplates([...builtinTemplates, ...remainingTemplates]),
    hasInjectedPanoramaStyleTemplate: true,
  };
}
