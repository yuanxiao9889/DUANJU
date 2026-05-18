import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

function supportsModernMarkdownRegex(): boolean {
  try {
    new RegExp('(?<=\\s)test');
    new RegExp('\\p{P}', 'u');
    return true;
  } catch {
    return false;
  }
}

// Older Safari / WebKit builds used by some macOS users do not support the
// regex features used by remark-gfm's autolink parser.
export const markdownRemarkPlugins = supportsModernMarkdownRegex()
  ? [remarkGfm, remarkBreaks]
  : [remarkBreaks];
