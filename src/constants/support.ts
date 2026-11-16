// Public business contact approved by the owner for support and deletion.
export const supportEmail = 'rafayetq@gmail.com';

// `as const` keeps the `mailto:` scheme in the type, which typed routes need to
// accept this as an external href.
export const supportMailto = (deletion = false) =>
  `mailto:${supportEmail}?subject=${encodeURIComponent(deletion ? 'Guardians account deletion request' : 'Guardians support request')}` as const;
