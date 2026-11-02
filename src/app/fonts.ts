import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  IBM_Plex_Mono,
  Inter,
  JetBrains_Mono,
  Public_Sans,
  Source_Code_Pro,
  Source_Sans_3,
} from "next/font/google";

/**
 * The web fonts of the themes (#286), self-hosted by `next/font` at build time (nothing is requested from Google
 * by the browser). Register, the default theme, uses the system faces and has none.
 *
 * Each font defines a CSS variable (`--font-<name>`) that `design-tokens.css` puts first in the theme's
 * `--rg-font-sans` / `--rg-font-mono`, followed by the system faces. The variable classes sit on <html> so any
 * theme can use them, but `preload: false` means no font file is preloaded, and a browser downloads a face only
 * when text is set in it: a page loads the selected theme's fonts and nothing else. `adjustFontFallback` (the
 * default) adds a size-adjusted local fallback so text does not reflow when the web font arrives.
 *
 * The options must be written out as literals for each call: `next/font` reads them at build time.
 */
const atkinsonSans = Atkinson_Hyperlegible_Next({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-atkinson-sans" });
const atkinsonMono = Atkinson_Hyperlegible_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-atkinson-mono" });
const sourceSans = Source_Sans_3({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-source-sans" });
const sourceCode = Source_Code_Pro({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-source-code" });
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-jetbrains-mono" });
const publicSans = Public_Sans({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-public-sans" });
const plexMono = IBM_Plex_Mono({ weight: ["400", "500", "600", "700"], subsets: ["latin"], display: "swap", preload: false, variable: "--font-plex-mono" });

/** The class names that define the font variables, for the <html> element. */
export const FONT_VARIABLE_CLASSES = [atkinsonSans, atkinsonMono, sourceSans, sourceCode, inter, jetbrainsMono, publicSans, plexMono]
  .map((font) => font.variable)
  .join(" ");
