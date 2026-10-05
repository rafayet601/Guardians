/** Private document references must stay inside the applicant's own folder. */
export function screeningDocPaths(value: unknown, userId: string): string[] | null {
  if (!Array.isArray(value) || value.length > 4) return null;
  if (
    value.some((path) => {
      if (typeof path !== 'string' || path.length > 1024 || !path.startsWith(`${userId}/`)) {
        return true;
      }
      // Do not allow another decoding/normalization layer to change the path.
      // deno-lint-ignore no-control-regex
      if (/[\\%?#\u0000-\u0020\u007f]/.test(path)) return true;
      return path.split('/').some((segment) => !segment || segment === '.' || segment === '..');
    })
  )
    return null;
  return value;
}

/** Session starts reference submitted evidence; only the questionnaire RPC changes it. */
export function matchesScreeningDocs(submitted: unknown, requested: string[]): boolean {
  return (
    Array.isArray(submitted) &&
    submitted.length === requested.length &&
    submitted.every((path, index) => path === requested[index])
  );
}
