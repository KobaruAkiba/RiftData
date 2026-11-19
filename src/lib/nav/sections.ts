export interface NavItem {
  label: string;
  /** `null` = section not available yet. */
  href: string | null;
}

export function buildNav(featuredYear: number): NavItem[] {
  return [
    { label: `Worlds ${featuredYear}`, href: "/" },
    { label: "Leagues", href: null },
    { label: "Teams", href: null },
    { label: "Worlds History", href: null },
  ];
}
