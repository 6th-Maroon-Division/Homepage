// Filter PR template comments, not arbitrary HTML. Discord receives plain text.
export function stripHtmlComments(body) {
  if (typeof body !== 'string') return '';

  const visible = [];
  let depth = 0;
  let start = 0;
  for (const token of body.matchAll(/<!--|-->/g)) {
    if (token[0] === '<!--') {
      if (depth === 0) {
        // Keep a boundary so removal cannot join text into new comment markers
        // or new changelog headers/entries (for example fi<!-- hidden -->x:).
        visible.push(body.slice(start, token.index), '\n');
      }
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) start = token.index + token[0].length;
    }
  }
  // An unterminated comment hides the remainder of the description.
  if (depth === 0) visible.push(body.slice(start));
  return visible.join('');
}
