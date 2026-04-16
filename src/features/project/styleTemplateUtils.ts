export const STYLE_TEMPLATE_ALL_CATEGORY_ID = "__all__";
export const STYLE_TEMPLATE_RECENT_CATEGORY_ID = "__recent__";
export const STYLE_TEMPLATE_UNGROUPED_CATEGORY_ID = "__ungrouped__";

export interface StyleTemplateCategory {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface StyleTemplate {
  id: string;
  name: string;
  prompt: string;
  categoryId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sortStyleTemplateCategories(
  categories: StyleTemplateCategory[],
): StyleTemplateCategory[] {
  return [...categories].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt;
    }

    return left.createdAt - right.createdAt;
  });
}

export function sortStyleTemplates(
  templates: StyleTemplate[],
): StyleTemplate[] {
  return [...templates].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt;
    }

    return left.createdAt - right.createdAt;
  });
}

export function normalizeStyleTemplateCategories(
  value: unknown,
): StyleTemplateCategory[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Partial<StyleTemplateCategory>;
      const id =
        typeof candidate.id === "string" ? candidate.id.trim() : "";
      const name =
        typeof candidate.name === "string" ? candidate.name.trim() : "";

      if (!id || !name || seenIds.has(id)) {
        return null;
      }

      seenIds.add(id);
      const createdAt =
        typeof candidate.createdAt === "number" &&
        Number.isFinite(candidate.createdAt)
          ? candidate.createdAt
          : Date.now() + index;
      const updatedAt =
        typeof candidate.updatedAt === "number" &&
        Number.isFinite(candidate.updatedAt)
          ? candidate.updatedAt
          : createdAt;
      const sortOrder =
        typeof candidate.sortOrder === "number" &&
        Number.isFinite(candidate.sortOrder)
          ? candidate.sortOrder
          : index;

      return {
        id,
        name,
        sortOrder,
        createdAt,
        updatedAt,
      } satisfies StyleTemplateCategory;
    })
    .filter((item): item is StyleTemplateCategory => item !== null);
}

export function normalizeStyleTemplates(
  value: unknown,
  validCategoryIds?: Set<string>,
): StyleTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Partial<StyleTemplate> & {
        createdAt?: number;
      };
      const id =
        typeof candidate.id === "string" ? candidate.id.trim() : "";
      const name =
        typeof candidate.name === "string" ? candidate.name.trim() : "";
      const prompt =
        typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";

      if (!id || !name || !prompt || seenIds.has(id)) {
        return null;
      }

      seenIds.add(id);
      const createdAt =
        typeof candidate.createdAt === "number" &&
        Number.isFinite(candidate.createdAt)
          ? candidate.createdAt
          : Date.now() + index;
      const updatedAt =
        typeof candidate.updatedAt === "number" &&
        Number.isFinite(candidate.updatedAt)
          ? candidate.updatedAt
          : createdAt;
      const sortOrder =
        typeof candidate.sortOrder === "number" &&
        Number.isFinite(candidate.sortOrder)
          ? candidate.sortOrder
          : index;
      const categoryId =
        typeof candidate.categoryId === "string" &&
        candidate.categoryId.trim().length > 0 &&
        (!validCategoryIds || validCategoryIds.has(candidate.categoryId.trim()))
          ? candidate.categoryId.trim()
          : null;
      const lastUsedAt =
        typeof candidate.lastUsedAt === "number" &&
        Number.isFinite(candidate.lastUsedAt)
          ? candidate.lastUsedAt
          : null;

      return {
        id,
        name,
        prompt,
        categoryId,
        sortOrder,
        createdAt,
        updatedAt,
        lastUsedAt,
      } satisfies StyleTemplate;
    })
    .filter((item): item is StyleTemplate => item !== null);
}

export function removeStyleTemplatePrompt(
  currentPrompt: string,
  templatePrompt: string,
): string {
  const normalizedPrompt = currentPrompt.trim();
  const normalizedTemplatePrompt = templatePrompt.trim();

  if (!normalizedPrompt || !normalizedTemplatePrompt) {
    return normalizedPrompt;
  }

  return normalizedPrompt
    .replace(
      new RegExp(`(?:,\\s*)?${escapeRegExp(normalizedTemplatePrompt)}\\s*$`),
      "",
    )
    .replace(/[，,]\s*$/, "")
    .trim();
}

export function applyStyleTemplatePrompt(
  currentPrompt: string,
  previousTemplatePrompt: string,
  nextTemplatePrompt: string,
): string {
  const basePrompt = removeStyleTemplatePrompt(
    currentPrompt,
    previousTemplatePrompt,
  );
  const normalizedNextTemplate = nextTemplatePrompt.trim();

  if (!normalizedNextTemplate) {
    return basePrompt;
  }

  if (
    basePrompt &&
    new RegExp(
      `(?:^|,\\s*)${escapeRegExp(normalizedNextTemplate)}\\s*$`,
    ).test(basePrompt)
  ) {
    return basePrompt;
  }

  return basePrompt
    ? `${basePrompt}, ${normalizedNextTemplate}`
    : normalizedNextTemplate;
}
