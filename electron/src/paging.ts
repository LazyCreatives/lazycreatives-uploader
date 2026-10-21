// Long lists draw the first SHOW_PAGE rows and more on asking ("Show 200 more"), so a
// library of thousands doesn't freeze the window while every row is made. Used by the
// Columns view in Your tracks and by the Upload list.
export const SHOW_PAGE = 200;

// What the "Show N more" button under a list says, or null when everything is shown.
export function moreToShow(total: number, shown: number, page: number = SHOW_PAGE): { next: number; left: number } | null {
  const left = total - shown;
  return left > 0 ? { next: Math.min(page, left), left } : null;
}
