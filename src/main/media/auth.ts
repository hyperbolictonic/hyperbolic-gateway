/**
 * Auth-failure classification, kept free of Electron imports so it is testable
 * under plain Node and usable from the job runner.
 */

/**
 * Does yt-dlp's output say the site wants a signed-in session?
 *
 * Deliberately narrow: a 403 alone is not enough (many sites return it for
 * other reasons), and the word "cookies" appears in unrelated warnings.
 */
export function needsLogin(text: string): boolean {
  const patterns = [
    /sign in to confirm/iu,
    /log in to confirm|login to confirm/iu,
    /requires? (?:a )?(?:sign[- ]?in|login|authentication)/iu,
    /authentication required|login required|sign[- ]?in required/iu,
    /this (?:video|content|post) is private|private (?:video|content)/iu,
    /members[- ]only|join this channel/iu,
    /age[- ]restricted|confirm your age/iu,
    /confirm you(?:'| a)?re not a bot|not a bot/iu,
    /HTTP Error 401\b/u,
  ];
  return patterns.some((pattern) => pattern.test(text));
}
