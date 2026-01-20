export const getPathSeparator = (path: string): string => {
  if (!path) return '';
  return path.includes('\\') ? '\\' : '/';
};
