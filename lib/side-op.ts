export function isSideOpTemplateCategory(category: string | null | undefined): boolean {
  return category?.trim().toLowerCase().replace(/[\s_-]+/g, '') === 'sideop';
}
