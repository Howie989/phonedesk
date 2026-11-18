// Tests written around macOS tooling (sips, launchd plists, unix file modes, POSIX paths) are skipped on Windows;
// their Windows counterparts live in platform.test.ts.
export const WIN = process.platform === "win32";
export const MODE600 = WIN ? 0o666 : 0o600; // Windows reports no unix permission bits
export const MODE644 = WIN ? 0o666 : 0o644;
