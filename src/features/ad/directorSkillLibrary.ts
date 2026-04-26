import {
  sortAdDirectorSkillCategories,
  sortAdDirectorSkillTemplates,
  type AdDirectorSkillCategory,
  type AdDirectorSkillImportSummary,
  type AdDirectorSkillPackageData,
  type AdDirectorSkillTemplate,
} from './types';

interface MergeAdDirectorSkillPackageInput {
  currentCategories: AdDirectorSkillCategory[];
  currentTemplates: AdDirectorSkillTemplate[];
  importedCategories: AdDirectorSkillCategory[];
  importedTemplates: AdDirectorSkillTemplate[];
}

function normalizeNameKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

function buildTemplateMatchKey(template: Pick<AdDirectorSkillTemplate, 'name'>): string {
  return normalizeNameKey(template.name);
}

function isImportedCategoryNewer(
  importedCategory: AdDirectorSkillCategory,
  currentCategory: AdDirectorSkillCategory
): boolean {
  return importedCategory.updatedAt > currentCategory.updatedAt;
}

function isImportedTemplateNewer(
  importedTemplate: AdDirectorSkillTemplate,
  currentTemplate: AdDirectorSkillTemplate
): boolean {
  return importedTemplate.updatedAt > currentTemplate.updatedAt;
}

export function buildAdDirectorSkillPackageData(
  categories: AdDirectorSkillCategory[],
  templates: AdDirectorSkillTemplate[]
): AdDirectorSkillPackageData {
  return {
    categories: sortAdDirectorSkillCategories(categories),
    templates: sortAdDirectorSkillTemplates(templates),
  };
}

export function mergeImportedAdDirectorSkillPackageData(
  input: MergeAdDirectorSkillPackageInput
): {
  categories: AdDirectorSkillCategory[];
  templates: AdDirectorSkillTemplate[];
  summary: AdDirectorSkillImportSummary;
} {
  const summary: AdDirectorSkillImportSummary = {
    added: 0,
    updated: 0,
    skipped: 0,
    addedCategories: 0,
    updatedCategories: 0,
    skippedCategories: 0,
    addedTemplates: 0,
    updatedTemplates: 0,
    skippedTemplates: 0,
  };

  const nextCategories = sortAdDirectorSkillCategories(
    input.currentCategories.map((category) => ({ ...category }))
  );
  const nextTemplates = sortAdDirectorSkillTemplates(
    input.currentTemplates.map((template) => ({ ...template }))
  );

  let nextCategorySortOrder = nextCategories.reduce(
    (maxSortOrder, category) => Math.max(maxSortOrder, category.sortOrder),
    -1
  );
  let nextTemplateSortOrder = nextTemplates.reduce(
    (maxSortOrder, template) => Math.max(maxSortOrder, template.sortOrder),
    -1
  );

  const categoryIdToIndex = new Map(
    nextCategories.map((category, index) => [category.id, index] as const)
  );
  const categoryNameToId = new Map<string, string>();
  nextCategories.forEach((category) => {
    const key = normalizeNameKey(category.name);
    if (key && !categoryNameToId.has(key)) {
      categoryNameToId.set(key, category.id);
    }
  });

  const importedCategoryIdToLocalId = new Map<string, string>();
  const importedCategories = sortAdDirectorSkillCategories(input.importedCategories);

  for (const importedCategory of importedCategories) {
    const normalizedName = importedCategory.name.trim();
    const matchedCategoryId =
      categoryIdToIndex.has(importedCategory.id)
        ? importedCategory.id
        : categoryNameToId.get(normalizeNameKey(normalizedName)) ?? null;

    if (matchedCategoryId) {
      importedCategoryIdToLocalId.set(importedCategory.id, matchedCategoryId);
      const matchedCategoryIndex = categoryIdToIndex.get(matchedCategoryId);
      if (typeof matchedCategoryIndex !== 'number') {
        continue;
      }

      const matchedCategory = nextCategories[matchedCategoryIndex];
      if (isImportedCategoryNewer(importedCategory, matchedCategory)) {
        nextCategories[matchedCategoryIndex] = {
          ...matchedCategory,
          name: normalizedName || matchedCategory.name,
          updatedAt: importedCategory.updatedAt,
        };
        summary.updated += 1;
        summary.updatedCategories += 1;
      } else {
        summary.skipped += 1;
        summary.skippedCategories += 1;
      }
      continue;
    }

    nextCategorySortOrder += 1;
    const nextCategory: AdDirectorSkillCategory = {
      ...importedCategory,
      id: importedCategory.id.trim() || crypto.randomUUID(),
      name: normalizedName,
      sortOrder: nextCategorySortOrder,
    };
    nextCategories.push(nextCategory);
    categoryIdToIndex.set(nextCategory.id, nextCategories.length - 1);
    importedCategoryIdToLocalId.set(importedCategory.id, nextCategory.id);
    categoryNameToId.set(normalizeNameKey(nextCategory.name), nextCategory.id);
    summary.added += 1;
    summary.addedCategories += 1;
  }

  const templateIdToIndex = new Map(
    nextTemplates.map((template, index) => [template.id, index] as const)
  );
  const templateKeyToId = new Map<string, string>();
  nextTemplates.forEach((template) => {
    const key = buildTemplateMatchKey(template);
    if (key && !templateKeyToId.has(key)) {
      templateKeyToId.set(key, template.id);
    }
  });

  const importedTemplates = sortAdDirectorSkillTemplates(input.importedTemplates);
  for (const importedTemplate of importedTemplates) {
    const matchedTemplateId =
      templateIdToIndex.has(importedTemplate.id)
        ? importedTemplate.id
        : templateKeyToId.get(buildTemplateMatchKey(importedTemplate)) ?? null;
    const resolvedCategoryId =
      importedTemplate.categoryId
        ? importedCategoryIdToLocalId.get(importedTemplate.categoryId) ?? null
        : null;

    if (matchedTemplateId) {
      const matchedTemplateIndex = templateIdToIndex.get(matchedTemplateId);
      if (typeof matchedTemplateIndex !== 'number') {
        continue;
      }

      const matchedTemplate = nextTemplates[matchedTemplateIndex];
      if (isImportedTemplateNewer(importedTemplate, matchedTemplate)) {
        nextTemplates[matchedTemplateIndex] = {
          ...matchedTemplate,
          name: importedTemplate.name.trim() || matchedTemplate.name,
          categoryId: resolvedCategoryId,
          profile: importedTemplate.profile,
          updatedAt: importedTemplate.updatedAt,
        };
        summary.updated += 1;
        summary.updatedTemplates += 1;
      } else {
        summary.skipped += 1;
        summary.skippedTemplates += 1;
      }
      continue;
    }

    nextTemplateSortOrder += 1;
    const nextTemplate: AdDirectorSkillTemplate = {
      ...importedTemplate,
      id: importedTemplate.id.trim() || crypto.randomUUID(),
      name: importedTemplate.name.trim(),
      categoryId: resolvedCategoryId,
      sortOrder: nextTemplateSortOrder,
    };
    nextTemplates.push(nextTemplate);
    templateIdToIndex.set(nextTemplate.id, nextTemplates.length - 1);
    templateKeyToId.set(buildTemplateMatchKey(nextTemplate), nextTemplate.id);
    summary.added += 1;
    summary.addedTemplates += 1;
  }

  return {
    categories: sortAdDirectorSkillCategories(nextCategories),
    templates: sortAdDirectorSkillTemplates(nextTemplates),
    summary,
  };
}
